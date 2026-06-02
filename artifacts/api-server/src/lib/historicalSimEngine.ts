/**
 * Historical Simulation Engine
 *
 * Replays every daily candle in the ohlcv_history table for every ticker
 * in the scanner universe.  At each bar the engine computes the same
 * indicators the live bot uses, applies the entry-gate logic, and records
 * what would have happened at the 5D / 10D / 20D horizons — all with
 * strict point-in-time data (no look-ahead).
 *
 * Results land in the `sim_trades` table (one row per ticker × date).
 * The aggregate queries below let the UI show which score ranges / RSI
 * zones / gate conditions historically produced the best outcomes.
 */

import { db, ohlcvHistoryTable, simTradesTable, botConfigTable } from "@workspace/db";
import { eq, asc, sql } from "drizzle-orm";
import { type OHLCVBar } from "./marketData.js";
import {
  calcTrend,
  calcMomentum,
  calcVolume,
  calcVolatility,
  calcOptions,
  calcRelativeStrength,
  calcRegimeIndicators,
  calcExhaustion,
  type ExhaustionResult,
} from "./indicators.js";
import { calcAtlasScore } from "./scoring.js";
import { SCANNER_UNIVERSE } from "./scannerUniverse.js";
import { logger } from "./logger.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const MIN_BARS    = 210;  // same as backtestEngine — need SMA200
const MAX_HORIZON = 20;   // bars looked forward for outcome measurement

// ── State ─────────────────────────────────────────────────────────────────────

export interface SimJobState {
  status:            "idle" | "running" | "complete" | "error";
  tickersProcessed:  number;
  totalTickers:      number;
  tradesRecorded:    number;
  currentTicker:     string | null;
  startedAt:         string | null;
  completedAt:       string | null;
  durationMs:        number | null;
  error?:            string;
}

const state: SimJobState = {
  status:           "idle",
  tickersProcessed: 0,
  totalTickers:     0,
  tradesRecorded:   0,
  currentTicker:    null,
  startedAt:        null,
  completedAt:      null,
  durationMs:       null,
};

export function getSimStatus(): SimJobState {
  return { ...state };
}

/**
 * Call once on server startup — restores state from DB so results survive restarts.
 */
export async function initSimState(): Promise<void> {
  if (state.status !== "idle") return; // already set (e.g. mid-run)
  const res = await db.execute(sql`
    SELECT COUNT(*) AS n, MAX(sim_date) AS last_date FROM sim_trades
  `);
  const row = res.rows[0] as Record<string, unknown>;
  const n = Number(row?.n ?? 0);
  if (n > 0) {
    Object.assign(state, {
      status:          "complete",
      tradesRecorded:  n,
      completedAt:     String(row?.last_date ?? new Date().toISOString()),
    });
    logger.info({ rows: n }, "Sim state restored from DB");
  }
}

export function startSimJob(): void {
  if (state.status === "running") {
    logger.warn("Historical sim already running — ignoring duplicate start");
    return;
  }
  runHistoricalSim().catch(err => {
    state.status = "error";
    state.error  = String(err);
    logger.error({ err }, "Historical simulation failed");
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

type DbBar = typeof ohlcvHistoryTable.$inferSelect;

/**
 * Unified bar type: extends OHLCVBar (which indicator functions expect via `time`)
 * while also carrying the original `date` field for DB writes and outcome lookup.
 */
type SimBar = OHLCVBar & { date: string };

function toSimBars(rows: DbBar[]): SimBar[] {
  return rows.map(b => ({
    time:   b.date,
    date:   b.date,
    open:   b.open,
    high:   b.high,
    low:    b.low,
    close:  b.close,
    volume: b.volume,
  }));
}

function scoreBucketLabel(score: number): string {
  if (score >= 75) return "STRONG";
  if (score >= 60) return "ELEVATED";
  if (score >= 45) return "NEUTRAL";
  return "WEAK";
}

function rsiZoneLabel(rsi: number): string {
  if (rsi < 40) return "oversold";
  if (rsi > 60) return "overbought";
  return "neutral";
}

/**
 * Compute recent-candle metrics from a bar slice — equivalent to the
 * `recentCandles` block in analysisEngine without requiring a full
 * AnalysisResult object.
 */
function calcRecentCandlesSim(bars: SimBar[]) {
  const last10  = bars.slice(-10);
  const last20  = bars.slice(-20);
  const last5   = bars.slice(-5);
  const avgVol  = last20.reduce((s, b) => s + b.volume, 0) / last20.length;
  const close   = bars[bars.length - 1].close;

  // Consecutive red days (close < open, counting back from most recent)
  let consecutiveRedDays = 0;
  for (let i = last10.length - 1; i >= 0; i--) {
    if (last10[i]!.close < last10[i]!.open) consecutiveRedDays++;
    else break;
  }

  // Price extension above 20-bar SMA
  const sma20 = last20.reduce((s, b) => s + b.close, 0) / last20.length;
  const priceExtensionPct = ((close - sma20) / sma20) * 100;

  // Distribution candles: wick rejection on a down bar (last 5)
  const distributionCandles = last5.filter(b =>
    b.close < b.open && (b.high - b.open) > (b.open - b.close) * 0.5
  ).length;

  // Down-day vs up-day volume ratio (last 10 bars)
  const downBars = last10.filter(b => b.close < b.open);
  const upBars   = last10.filter(b => b.close >= b.open);
  const downVol  = downBars.length
    ? downBars.reduce((s, b) => s + b.volume, 0) / downBars.length
    : 0;
  const upVol = upBars.length
    ? upBars.reduce((s, b) => s + b.volume, 0) / upBars.length
    : avgVol;
  const downDayVolumeRatio = upVol > 0 ? downVol / upVol : 1;

  // Climax bars: high-volume green bars (volume > 1.5× avg)
  const climaxBars = last10.filter(
    b => b.close > b.open && b.volume > avgVol * 1.5
  ).length;

  return {
    consecutiveRedDays,
    priceExtensionPct,
    distributionCandles,
    downDayVolumeRatio,
    climaxBars,
  };
}

/**
 * Sim-time entry gate — mirrors smartEntryGate (entryGate.ts) but
 * accepts raw computed values instead of a full AnalysisResult.
 */
function simEntryGate(
  exhaustion:          ExhaustionResult,
  priceExtensionPct:   number,
  consecutiveRedDays:  number,
  distributionCandles: number,
  downDayVolumeRatio:  number,
  climaxBars:          number,
): { enter: boolean; reason: string } {
  if (exhaustion.distributionTop) {
    return { enter: false, reason: "distribution_top" };
  }
  if (exhaustion.parabolicRise && consecutiveRedDays >= 2) {
    return { enter: false, reason: "parabolic_rollover" };
  }
  if (exhaustion.exhaustionSignal !== "none" && priceExtensionPct > 15) {
    return { enter: false, reason: "exhaustion_extended" };
  }
  if (distributionCandles >= 2 && downDayVolumeRatio > 1.2) {
    return { enter: false, reason: "distribution_candles" };
  }
  if (priceExtensionPct > 25) {
    return { enter: false, reason: "overextended" };
  }
  if (climaxBars >= 1 && consecutiveRedDays >= 2) {
    return { enter: false, reason: "climax_distribution" };
  }
  return { enter: true, reason: "clean" };
}

// ── Main simulation ───────────────────────────────────────────────────────────

export async function runHistoricalSim(): Promise<void> {
  const tickers = SCANNER_UNIVERSE;

  Object.assign(state, {
    status:           "running",
    tickersProcessed: 0,
    totalTickers:     tickers.length,
    tradesRecorded:   0,
    currentTicker:    null,
    startedAt:        new Date().toISOString(),
    completedAt:      null,
    durationMs:       null,
    error:            undefined,
  });

  const t0 = Date.now();
  logger.info({ tickers: tickers.length }, "Historical simulation started");

  // ── Load all daily bars in one query ────────────────────────────────────
  // Group by ticker in memory — avoids 605 individual SELECT calls.
  logger.info("Sim: loading OHLCV from DB…");
  const allBars = await db
    .select()
    .from(ohlcvHistoryTable)
    .where(eq(ohlcvHistoryTable.interval, "1d"))
    .orderBy(asc(ohlcvHistoryTable.ticker), asc(ohlcvHistoryTable.date));

  const rawByTicker = new Map<string, DbBar[]>();
  for (const bar of allBars) {
    let arr = rawByTicker.get(bar.ticker);
    if (!arr) { arr = []; rawByTicker.set(bar.ticker, arr); }
    arr.push(bar);
  }

  // Pre-convert all DB rows to SimBar (adds `time` field required by OHLCVBar)
  const barsByTicker = new Map<string, SimBar[]>();
  for (const [tkr, rows] of rawByTicker) {
    barsByTicker.set(tkr, toSimBars(rows));
  }

  const spyBars = barsByTicker.get("SPY") ?? [];
  const qqqBars = barsByTicker.get("QQQ") ?? [];
  const iwmBars = barsByTicker.get("IWM") ?? [];

  logger.info({ tickers: barsByTicker.size }, "Sim: OHLCV loaded — starting candle walk");

  // ── Ticker loop ──────────────────────────────────────────────────────────
  for (const ticker of tickers) {
    state.currentTicker = ticker;
    const bars = barsByTicker.get(ticker);

    if (!bars || bars.length < MIN_BARS + MAX_HORIZON) {
      state.tickersProcessed++;
      continue;
    }

    try {
      const rows: (typeof simTradesTable.$inferInsert)[] = [];

      for (let i = MIN_BARS; i < bars.length - MAX_HORIZON; i++) {
        const slice    = bars.slice(0, i + 1);
        const spySlice = spyBars.slice(0, Math.min(i + 1, spyBars.length));
        const qqqSlice = qqqBars.slice(0, Math.min(i + 1, qqqBars.length));
        const iwmSlice = iwmBars.slice(0, Math.min(i + 1, iwmBars.length));

        const price  = slice[slice.length - 1]!.close;
        const avgVol = slice.slice(-20).reduce((s, b) => s + b.volume, 0) / 20;

        const trend      = calcTrend(slice, price);
        const momentum   = calcMomentum(slice);
        const volume     = calcVolume(slice, avgVol);
        const volatility = calcVolatility(slice, price);
        const options    = calcOptions(momentum, volume, volatility, price);
        const rs         = calcRelativeStrength(ticker, slice, spySlice, qqqSlice, iwmSlice, null);
        const spyPrice   = spySlice[spySlice.length - 1]?.close ?? 500;
        const spyTrend   = calcTrend(spySlice, spyPrice);
        const regime     = calcRegimeIndicators(spySlice, spyTrend);
        const exhaustion = calcExhaustion(slice, momentum, volume, trend, volatility);
        const atlas      = calcAtlasScore(
          trend, momentum, volume, options, rs,
          regime.regimeScore, volatility.expectedMovePercent, exhaustion,
        );

        // Recent-candle proxy (gate inputs)
        const rc   = calcRecentCandlesSim(slice);
        const gate = simEntryGate(
          exhaustion,
          rc.priceExtensionPct,
          rc.consecutiveRedDays,
          rc.distributionCandles,
          rc.downDayVolumeRatio,
          rc.climaxBars,
        );

        // ATR-based stop and target
        const entryPrice  = bars[i]!.close;
        const atrPct      = volatility.atrPercent;          // % of price
        const stopPrice   = entryPrice * (1 - 2 * atrPct / 100);
        const targetPrice = entryPrice * (1 + 3 * atrPct / 100);

        // Forward returns
        const fwd5  = bars[i + 5]  ? (bars[i + 5]!.close  / entryPrice - 1) * 100 : null;
        const fwd10 = bars[i + 10] ? (bars[i + 10]!.close / entryPrice - 1) * 100 : null;
        const fwd20 = bars[i + 20] ? (bars[i + 20]!.close / entryPrice - 1) * 100 : null;

        // Stop-out check within 20-day window
        let stoppedOut   = false;
        let maxAdvExc    = 0;
        for (let j = i + 1; j <= Math.min(i + MAX_HORIZON, bars.length - 1); j++) {
          const mae = (entryPrice - bars[j]!.low) / entryPrice * 100;
          if (mae > maxAdvExc) maxAdvExc = mae;
          if (bars[j]!.low < stopPrice) { stoppedOut = true; break; }
        }

        rows.push({
          ticker,
          simDate:          bars[i]!.date,
          entryPrice,
          atlasScore:       atlas.overall,
          scoreBucket:      scoreBucketLabel(atlas.overall),
          trendScore:       atlas.trendScore,
          momentumScore:    atlas.momentumScore,
          volumeScore:      atlas.volumeScore,
          rsScore:          atlas.relativeStrengthScore,
          regimeScore:      atlas.marketRegimeScore,
          exhaustionScore:  exhaustion.exhaustionScore,
          rsi:              momentum.rsi,
          rsiZone:          rsiZoneLabel(momentum.rsi),
          rvol:             volume.relativeVolume,
          atrPct,
          macdHist:         momentum.macdHistogram,
          distributionTop:  exhaustion.distributionTop,
          parabolicRise:    exhaustion.parabolicRise,
          exhaustionSignal: exhaustion.exhaustionSignal,
          gateEnter:        gate.enter,
          gateReason:       gate.reason,
          stopPrice,
          targetPrice,
          pnl5d:            fwd5,
          pnl10d:           fwd10,
          pnl20d:           fwd20,
          stoppedOut,
          maxAdverseExc:    maxAdvExc > 0 ? maxAdvExc : null,
        });
      }

      // Batch upsert — chunks of 500 to keep SQL size manageable
      for (let k = 0; k < rows.length; k += 500) {
        await db
          .insert(simTradesTable)
          .values(rows.slice(k, k + 500))
          .onConflictDoNothing();
      }
      state.tradesRecorded += rows.length;

    } catch (err) {
      logger.warn({ ticker, err }, "Sim: ticker failed, skipping");
    }

    state.tickersProcessed++;

    // Log progress every 50 tickers
    if (state.tickersProcessed % 50 === 0) {
      logger.info(
        { processed: state.tickersProcessed, total: tickers.length, recorded: state.tradesRecorded },
        "Sim: progress"
      );
    }
  }

  const durationMs = Date.now() - t0;
  Object.assign(state, {
    status:       "complete",
    completedAt:  new Date().toISOString(),
    durationMs,
    currentTicker: null,
  });

  logger.info(
    { tickersProcessed: state.tickersProcessed, tradesRecorded: state.tradesRecorded, durationMs },
    "Historical simulation complete"
  );
}

// ── Result queries ────────────────────────────────────────────────────────────

const BUCKET_ORDER = ["STRONG", "ELEVATED", "NEUTRAL", "WEAK"];

export async function getSimResults() {
  // Always query the DB — state.status may be "idle" after a server restart
  // even though sim_trades is populated.

  // Read current bot config to apply the same entry criteria the live bot uses
  const configRows = await db.select().from(botConfigTable).limit(1);
  const cfg = configRows[0];

  // Extract RSI min/max and score min from entry criteria
  type Criterion = { field: string; operator: string; value?: number; value2?: number };
  const criteria: Criterion[] = Array.isArray(cfg?.entryCriteria) ? (cfg.entryCriteria as Criterion[]) : [];
  const rsiCrit   = criteria.find(c => c.field === "rsi"   && c.operator === "between");
  const scoreCrit = criteria.find(c => c.field === "score" && c.operator === "gte");

  const rsiMin   = rsiCrit?.value   ?? 0;
  const rsiMax   = rsiCrit?.value2  ?? 100;
  const scoreMin = scoreCrit?.value ?? 0;

  const configFilter = { rsiMin, rsiMax, scoreMin };

  const [bucketRes, rsiRes, totalsRes] = await Promise.all([
    db.execute(sql`
      SELECT
        score_bucket,
        COUNT(*)                                                                                              AS n,
        SUM(CASE WHEN gate_enter AND rsi BETWEEN ${rsiMin} AND ${rsiMax} AND atlas_score >= ${scoreMin} THEN 1 ELSE 0 END) AS n_entered,
        ROUND(AVG(CASE WHEN gate_enter AND rsi BETWEEN ${rsiMin} AND ${rsiMax} AND atlas_score >= ${scoreMin} AND pnl_5d  IS NOT NULL THEN pnl_5d  END)::numeric, 2) AS avg_5d,
        ROUND(AVG(CASE WHEN gate_enter AND rsi BETWEEN ${rsiMin} AND ${rsiMax} AND atlas_score >= ${scoreMin} AND pnl_10d IS NOT NULL THEN pnl_10d END)::numeric, 2) AS avg_10d,
        ROUND(AVG(CASE WHEN gate_enter AND rsi BETWEEN ${rsiMin} AND ${rsiMax} AND atlas_score >= ${scoreMin} AND pnl_20d IS NOT NULL THEN pnl_20d END)::numeric, 2) AS avg_20d,
        ROUND(
          100.0 * SUM(CASE WHEN gate_enter AND rsi BETWEEN ${rsiMin} AND ${rsiMax} AND atlas_score >= ${scoreMin} AND pnl_5d > 0 THEN 1 ELSE 0 END)
                / NULLIF(SUM(CASE WHEN gate_enter AND rsi BETWEEN ${rsiMin} AND ${rsiMax} AND atlas_score >= ${scoreMin} AND pnl_5d IS NOT NULL THEN 1 ELSE 0 END), 0), 1
        ) AS hit_rate_5d,
        ROUND(
          100.0 * SUM(CASE WHEN gate_enter AND rsi BETWEEN ${rsiMin} AND ${rsiMax} AND atlas_score >= ${scoreMin} AND pnl_10d > 0 THEN 1 ELSE 0 END)
                / NULLIF(SUM(CASE WHEN gate_enter AND rsi BETWEEN ${rsiMin} AND ${rsiMax} AND atlas_score >= ${scoreMin} AND pnl_10d IS NOT NULL THEN 1 ELSE 0 END), 0), 1
        ) AS hit_rate_10d,
        ROUND(
          100.0 * SUM(CASE WHEN gate_enter AND rsi BETWEEN ${rsiMin} AND ${rsiMax} AND atlas_score >= ${scoreMin} AND pnl_20d > 0 THEN 1 ELSE 0 END)
                / NULLIF(SUM(CASE WHEN gate_enter AND rsi BETWEEN ${rsiMin} AND ${rsiMax} AND atlas_score >= ${scoreMin} AND pnl_20d IS NOT NULL THEN 1 ELSE 0 END), 0), 1
        ) AS hit_rate_20d,
        ROUND(
          100.0 * SUM(CASE WHEN gate_enter AND rsi BETWEEN ${rsiMin} AND ${rsiMax} AND atlas_score >= ${scoreMin} AND stopped_out THEN 1 ELSE 0 END)
                / NULLIF(SUM(CASE WHEN gate_enter AND rsi BETWEEN ${rsiMin} AND ${rsiMax} AND atlas_score >= ${scoreMin} THEN 1 ELSE 0 END), 0), 1
        ) AS stopped_out_rate
      FROM sim_trades
      GROUP BY score_bucket
    `),
    db.execute(sql`
      SELECT
        rsi_zone,
        COUNT(*)                                                                                              AS n,
        SUM(CASE WHEN gate_enter AND rsi BETWEEN ${rsiMin} AND ${rsiMax} AND atlas_score >= ${scoreMin} THEN 1 ELSE 0 END) AS n_entered,
        ROUND(AVG(CASE WHEN gate_enter AND rsi BETWEEN ${rsiMin} AND ${rsiMax} AND atlas_score >= ${scoreMin} AND pnl_5d  IS NOT NULL THEN pnl_5d  END)::numeric, 2) AS avg_5d,
        ROUND(AVG(CASE WHEN gate_enter AND rsi BETWEEN ${rsiMin} AND ${rsiMax} AND atlas_score >= ${scoreMin} AND pnl_10d IS NOT NULL THEN pnl_10d END)::numeric, 2) AS avg_10d,
        ROUND(AVG(CASE WHEN gate_enter AND rsi BETWEEN ${rsiMin} AND ${rsiMax} AND atlas_score >= ${scoreMin} AND pnl_20d IS NOT NULL THEN pnl_20d END)::numeric, 2) AS avg_20d,
        ROUND(
          100.0 * SUM(CASE WHEN gate_enter AND rsi BETWEEN ${rsiMin} AND ${rsiMax} AND atlas_score >= ${scoreMin} AND pnl_5d > 0 THEN 1 ELSE 0 END)
                / NULLIF(SUM(CASE WHEN gate_enter AND rsi BETWEEN ${rsiMin} AND ${rsiMax} AND atlas_score >= ${scoreMin} AND pnl_5d IS NOT NULL THEN 1 ELSE 0 END), 0), 1
        ) AS hit_rate_5d,
        ROUND(
          100.0 * SUM(CASE WHEN gate_enter AND rsi BETWEEN ${rsiMin} AND ${rsiMax} AND atlas_score >= ${scoreMin} AND pnl_10d > 0 THEN 1 ELSE 0 END)
                / NULLIF(SUM(CASE WHEN gate_enter AND rsi BETWEEN ${rsiMin} AND ${rsiMax} AND atlas_score >= ${scoreMin} AND pnl_10d IS NOT NULL THEN 1 ELSE 0 END), 0), 1
        ) AS hit_rate_10d,
        ROUND(
          100.0 * SUM(CASE WHEN gate_enter AND rsi BETWEEN ${rsiMin} AND ${rsiMax} AND atlas_score >= ${scoreMin} AND pnl_20d > 0 THEN 1 ELSE 0 END)
                / NULLIF(SUM(CASE WHEN gate_enter AND rsi BETWEEN ${rsiMin} AND ${rsiMax} AND atlas_score >= ${scoreMin} AND pnl_20d IS NOT NULL THEN 1 ELSE 0 END), 0), 1
        ) AS hit_rate_20d
      FROM sim_trades
      WHERE rsi_zone IS NOT NULL
      GROUP BY rsi_zone
    `),
    db.execute(sql`
      SELECT
        COUNT(*)                                              AS total_bars,
        SUM(CASE WHEN gate_enter AND rsi BETWEEN ${rsiMin} AND ${rsiMax} AND atlas_score >= ${scoreMin} THEN 1 ELSE 0 END) AS total_entered
      FROM sim_trades
    `),
  ]);

  const totalBars    = Number((totalsRes.rows[0] as Record<string, unknown>)?.total_bars    ?? 0);
  const totalEntered = Number((totalsRes.rows[0] as Record<string, unknown>)?.total_entered ?? 0);

  // Sort buckets strongest → weakest
  const byScoreBucket = [...bucketRes.rows].sort(
    (a, b) =>
      BUCKET_ORDER.indexOf((a as Record<string, unknown>).score_bucket as string) -
      BUCKET_ORDER.indexOf((b as Record<string, unknown>).score_bucket as string)
  );

  // Derive optimal entry threshold: highest-scoring bucket with positive avg_20d (best predictor)
  let optimalScoreThreshold: number | null = null;
  for (const bucket of ["STRONG", "ELEVATED", "NEUTRAL"] as const) {
    const row = byScoreBucket.find(r => (r as Record<string, unknown>).score_bucket === bucket);
    if (row && Number((row as Record<string, unknown>).avg_20d ?? -1) > 0) {
      optimalScoreThreshold = bucket === "STRONG" ? 75 : bucket === "ELEVATED" ? 60 : 45;
      break;
    }
  }

  // Derive status from live state OR from DB data (survives server restarts)
  const effectiveStatus = state.status !== "idle" ? state.status : totalBars > 0 ? "complete" : "idle";

  return {
    status:               effectiveStatus,
    totalBars,
    totalEntered,
    pctEntered:           totalBars > 0 ? Math.round((totalEntered / totalBars) * 100) : 0,
    byScoreBucket,
    byRsiZone:            rsiRes.rows,
    optimalScoreThreshold,
    lastRunAt:            state.completedAt,
    configFilter,
  };
}

export async function getSimTrades(limit = 100, offset = 0, gateOnly = true) {
  const rows = await db.execute(sql`
    SELECT
      ticker, sim_date, atlas_score, score_bucket, rsi, rsi_zone,
      rvol, gate_enter, gate_reason,
      pnl_5d, pnl_10d, pnl_20d, stopped_out, max_adverse_exc
    FROM sim_trades
    ${gateOnly ? sql`WHERE gate_enter = true` : sql``}
    ORDER BY sim_date DESC, ticker
    LIMIT ${limit} OFFSET ${offset}
  `);
  return rows.rows;
}

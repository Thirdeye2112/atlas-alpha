/**
 * Bot Intelligence Layer
 *
 * Five knowledge gates that run every cycle:
 *   1. Market regime gate  — blocks new entries during RISK OFF / weak breadth
 *   2. Sim gate            — requires >= 50% historical 5D win rate for this score/RSI bucket
 *   3. Calibration gate    — requires P(positive 5D) >= 52% from walk-forward model
 *   4. Scanner categories  — classifies setup type; adjusts position size + stop width
 *   5. Self-learning       — auto-adjusts score entry threshold based on actual vs expected win rate
 *
 * Background loop (every 5 min):
 *   - Builds calibration for uncalibrated top-scoring tickers
 *   - Refreshes sim gate cache
 *   - Runs self-learning check hourly
 */

import { db, paperTradesTable, botAdaptationLogTable, botConfigTable } from "@workspace/db";
import { desc, eq, sql as drizzleSql } from "drizzle-orm";
import { calibrationStore }  from "./calibrationStore.js";
import { marketCache }        from "./cache.js";
import { logger }             from "./logger.js";
import type { AnalysisResult } from "./analysisEngine.js";

// ── Types ──────────────────────────────────────────────────────────────────────

/**
 * Granular bot-trading regime derived from ADX, VIX, breadth, and the broader
 * market regime.  Used to route strategy types and block setups inappropriate
 * for current market structure.
 *
 * trend_up   — ADX > 25, risk-on: momentum/breakout setups have highest edge
 * neutral    — ADX 20–25 or mixed signals: normal operation, all setups allowed
 * chop       — ADX < 20: trending setups fail; mean-reversion preferred
 * high_vol   — VIX > 22: volatility elevated; block speculative plays
 * risk_off   — regime score < 40 or VIX > 30: halt new long entries
 */
export type BotRegime = "trend_up" | "neutral" | "chop" | "high_vol" | "risk_off";

// Scanner categories blocked in each bot regime
const CHOP_BLOCKED_CATS     = ["breakout", "gap_setup_long", "gap_setup_short"];
const HIGH_VOL_BLOCKED_CATS = ["gamma_squeeze", "short_squeeze"];

export interface MarketContext {
  regime:            "risk_on" | "neutral" | "risk_off";
  botRegime:         BotRegime;
  regimeScore:       number;
  breadthPct50:      number | null;
  breadthPct200:     number | null;
  vix:               number | null;
  adx:               number | null;
  minScoreOverride:  number | null;
  allowNewEntries:   boolean;
  /** Scanner categories that should be skipped in the current regime. */
  blockedCategories: string[];
  reason:            string;
}

export interface SimGateResult {
  allow:         boolean;
  hitRate5d:     number | null;
  expectedPnl5d: number | null;
  n:             number;
  reason:        string;
}

export interface CalibGateResult {
  allow:        boolean;
  probPositive: number | null;
  signalMode:   "momentum" | "contrarian" | "none";
  rankIC:       number | null;
  reason:       string;
}

export interface ScannerInfo {
  categories:          string[];
  positionMultiplier:  number;
  stopMultiplier:      number;
}

export interface IntelligenceVerdict {
  simGate:      SimGateResult;
  calibGate:    CalibGateResult;
  scannerInfo:  ScannerInfo;
  overallAllow: boolean;
  blockedBy:    string | null;
}

export interface AdaptationResult {
  adapted:          boolean;
  oldScoreMin:      number;
  newScoreMin:      number;
  actualWinRate:    number;
  expectedWinRate:  number;
  tradesAnalyzed:   number;
  reason:           string;
}

interface IntelligenceState {
  lastMarketContext:    MarketContext | null;
  lastAdaptation:      AdaptationResult | null;
  lastAdaptedAt:       string | null;
  backgroundRunCount:  number;
  calibrationsPending: number;
  simCacheBuckets:     number;
  simCacheAgeMin:      number | null;
}

const state: IntelligenceState = {
  lastMarketContext:    null,
  lastAdaptation:      null,
  lastAdaptedAt:       null,
  backgroundRunCount:  0,
  calibrationsPending: 0,
  simCacheBuckets:     0,
  simCacheAgeMin:      null,
};

export function getIntelligenceState(): IntelligenceState {
  if (simGateCacheAt > 0) {
    state.simCacheAgeMin = Math.round((Date.now() - simGateCacheAt) / 60000);
  }
  return { ...state };
}

// ── 1. Market regime gate ─────────────────────────────────────────────────────

export function getMarketContext(): MarketContext {
  const overview = marketCache.get<Record<string, unknown>>("overview");

  if (!overview) {
    const ctx: MarketContext = {
      regime: "neutral", botRegime: "neutral", regimeScore: 50,
      breadthPct50: null, breadthPct200: null, vix: null, adx: null,
      minScoreOverride: null, allowNewEntries: true, blockedCategories: [],
      reason: "market data not yet loaded — proceeding with caution",
    };
    state.lastMarketContext = ctx;
    return ctx;
  }

  const regime       = (overview.marketRegime as string ?? "neutral") as MarketContext["regime"];
  const regimeScore  = (overview.marketRegimeScore as number) ?? 50;
  const breadthPct50 = overview.pctAboveSma50  as number | null ?? null;
  const breadthPct200= overview.pctAboveSma200 as number | null ?? null;
  const vix          = (overview.vix as { price?: number } | null)?.price ?? null;
  const adx          = overview.adx  as number | null ?? null;

  let allowNewEntries   = true;
  let minScoreOverride: number | null = null;
  let reason            = "market conditions normal — full operation";

  if (regime === "risk_off") {
    allowNewEntries = false;
    reason = `RISK OFF (regime ${regimeScore}, VIX ${vix?.toFixed(1) ?? "?"}) — pausing new entries`;
  } else if (breadthPct50 !== null && breadthPct50 < 35) {
    minScoreOverride = 78;
    reason = `weak breadth (${breadthPct50}% above SMA50) — raising entry threshold to 78`;
  } else if (breadthPct50 !== null && breadthPct50 < 50) {
    minScoreOverride = 72;
    reason = `moderate breadth (${breadthPct50}% above SMA50) — raising threshold to 72`;
  } else if (regime === "risk_on" && (breadthPct50 ?? 0) > 70) {
    reason = `RISK ON + strong breadth (${breadthPct50}% above SMA50) — full operation`;
  }

  // ── Regime classifier ───────────────────────────────────────────────────────
  // Classifies current market structure into one of five bot-trading regimes
  // to route setup types appropriately (breakouts fail in chop, etc.)
  let botRegime: BotRegime;
  let blockedCategories: string[] = [];

  if (regime === "risk_off") {
    botRegime = "risk_off";
    // allowNewEntries already false above
  } else if (vix !== null && vix > 22) {
    botRegime = "high_vol";
    blockedCategories = HIGH_VOL_BLOCKED_CATS;
    reason = reason === "market conditions normal — full operation"
      ? `elevated VIX (${vix.toFixed(1)}) — blocking speculative plays (gamma/short squeeze)`
      : reason + `; VIX ${vix.toFixed(1)} blocking speculative entries`;
  } else if (adx !== null && adx < 20) {
    botRegime = "chop";
    blockedCategories = CHOP_BLOCKED_CATS;
    reason = reason === "market conditions normal — full operation"
      ? `choppy market (ADX ${adx.toFixed(1)} < 20) — blocking breakout/gap setups`
      : reason + `; ADX ${adx.toFixed(1)} choppy — breakouts blocked`;
  } else if (adx !== null && adx > 25 && regime === "risk_on") {
    botRegime = "trend_up";
  } else {
    botRegime = "neutral";
  }

  const ctx: MarketContext = {
    regime, botRegime, regimeScore, breadthPct50, breadthPct200, vix, adx,
    minScoreOverride, allowNewEntries, blockedCategories, reason,
  };
  state.lastMarketContext = ctx;
  return ctx;
}

// ── 2. Sim gate ───────────────────────────────────────────────────────────────

interface SimBucket { hitRate5d: number; avgPnl5d: number; n: number }
let simGateCache: Map<string, SimBucket> | null = null;
let simGateCacheAt = 0;
const SIM_GATE_TTL  = 30 * 60 * 1000;

async function loadSimGateCache(): Promise<void> {
  if (simGateCache && Date.now() - simGateCacheAt < SIM_GATE_TTL) return;
  try {
    const rows = await db.execute(drizzleSql`
      SELECT
        score_bucket,
        rsi_zone,
        COUNT(*) FILTER (WHERE pnl_5d IS NOT NULL)                                                              AS n,
        ROUND(100.0 * COUNT(*) FILTER (WHERE pnl_5d > 0)
              / NULLIF(COUNT(*) FILTER (WHERE pnl_5d IS NOT NULL), 0), 1)                                       AS hit_rate_5d,
        ROUND(AVG(pnl_5d) FILTER (WHERE pnl_5d IS NOT NULL)::numeric, 2)                                        AS avg_pnl_5d
      FROM sim_trades
      WHERE gate_enter = true
      GROUP BY score_bucket, rsi_zone
    `);
    simGateCache = new Map();
    for (const row of rows.rows as Record<string, unknown>[]) {
      const key = `${row.score_bucket ?? ""}:${row.rsi_zone ?? ""}`;
      simGateCache.set(key, {
        hitRate5d: Number(row.hit_rate_5d ?? 50),
        avgPnl5d:  Number(row.avg_pnl_5d  ?? 0),
        n:         Number(row.n           ?? 0),
      });
    }
    simGateCacheAt        = Date.now();
    state.simCacheBuckets = simGateCache.size;
    logger.debug({ buckets: simGateCache.size }, "Intelligence: sim gate cache refreshed");
  } catch (err) {
    logger.warn({ err }, "Intelligence: sim gate cache load failed");
  }
}

function rsiToZone(rsi: number): string {
  if (rsi <= 30) return "oversold";
  if (rsi <= 45) return "low_neutral";
  if (rsi <= 55) return "neutral";
  if (rsi <= 65) return "high_neutral";
  if (rsi <= 75) return "elevated";
  return "extended";
}

function scoreTosBucket(score: number): string {
  if (score >= 75) return "STRONG";
  if (score >= 60) return "ELEVATED";
  if (score >= 45) return "NEUTRAL";
  return "WEAK";
}

export async function getSimGate(score: number, rsi: number): Promise<SimGateResult> {
  await loadSimGateCache();

  if (!simGateCache || simGateCache.size === 0) {
    return { allow: true, hitRate5d: null, expectedPnl5d: null, n: 0, reason: "sim not run yet — skipping gate" };
  }

  const bucket = scoreTosBucket(score);
  const zone   = rsiToZone(rsi);
  const key    = `${bucket}:${zone}`;
  const exact  = simGateCache.get(key);

  // Prefer exact bucket+zone match; fall back to bucket average if < 10 samples
  let data: SimBucket | null = (exact && exact.n >= 10) ? exact : null;
  if (!data) {
    const bucketEntries = [...simGateCache.entries()].filter(([k]) => k.startsWith(bucket + ":"));
    if (bucketEntries.length === 0) {
      return { allow: true, hitRate5d: null, expectedPnl5d: null, n: 0, reason: `no sim data for ${bucket} bucket — allowing` };
    }
    const totalN  = bucketEntries.reduce((s, [, v]) => s + v.n, 0);
    if (totalN < 20) {
      return { allow: true, hitRate5d: null, expectedPnl5d: null, n: totalN, reason: `insufficient sim data (${totalN} samples) — allowing` };
    }
    // Weighted average across RSI zones
    const wHit = bucketEntries.reduce((s, [, v]) => s + v.hitRate5d * v.n, 0) / totalN;
    const wPnl = bucketEntries.reduce((s, [, v]) => s + v.avgPnl5d  * v.n, 0) / totalN;
    data = { hitRate5d: wHit, avgPnl5d: wPnl, n: totalN };
  }

  const allow = data.hitRate5d >= 50;
  return {
    allow,
    hitRate5d:     data.hitRate5d,
    expectedPnl5d: data.avgPnl5d,
    n:             data.n,
    reason: allow
      ? `${bucket}+${zone}: ${data.hitRate5d.toFixed(0)}% sim hit rate — allow`
      : `${bucket}+${zone}: ${data.hitRate5d.toFixed(0)}% sim hit rate < 50% — blocking`,
  };
}

// ── 3. Calibration gate ───────────────────────────────────────────────────────

export function getCalibGate(ticker: string, score: number): CalibGateResult {
  const fitted = calibrationStore.getFitted(ticker, 10);

  if (!fitted) {
    return { allow: true, probPositive: null, signalMode: "none", rankIC: null, reason: "no calibration data — allowing" };
  }

  const probPositive = fitted.calibratedProbability(score);
  const rankIC       = fitted.rankIC;
  const signalMode   = rankIC >= 0 ? "momentum" : "contrarian";

  let allow  = true;
  let reason: string;

  // probPositive is 0–100 (calibratedProbability multiplies sigmoid output by 100)
  if (signalMode === "contrarian") {
    // High score on a contrarian ticker = bearish signal for a long entry
    if (probPositive < 48) {
      allow  = false;
      reason = `contrarian IC=${rankIC.toFixed(3)}: P(+)=${probPositive.toFixed(0)}% — blocking long`;
    } else {
      reason = `contrarian IC=${rankIC.toFixed(3)}: P(+)=${probPositive.toFixed(0)}% marginal — allowing with caution`;
    }
  } else {
    if (probPositive < 52) {
      allow  = false;
      reason = `momentum IC=${rankIC.toFixed(3)}: P(+)=${probPositive.toFixed(0)}% < 52% — blocking`;
    } else {
      reason = `momentum IC=${rankIC.toFixed(3)}: P(+)=${probPositive.toFixed(0)}% — allow`;
    }
  }

  return { allow, probPositive, signalMode, rankIC, reason };
}

// ── 4. Scanner category detection + position/stop sizing ─────────────────────

const POS_MULT: Record<string, number> = {
  high_prob_long:      1.0,
  institutional_accum: 1.0,
  breakout:            0.85,
  gap_setup_long:      0.85,
  mean_reversion:      0.75,
  gamma_squeeze:       0.60,
  short_squeeze:       0.60,
};

const STOP_MULT: Record<string, number> = {
  breakout:       1.25,
  gamma_squeeze:  1.50,
  short_squeeze:  1.50,
  mean_reversion: 0.90,
};

export function detectScannerCategories(a: AnalysisResult): ScannerInfo {
  const categories: string[] = [];
  const score         = a.atlasScore.overall;
  const rsi           = a.momentum.rsi;
  const rvol          = a.volume.relativeVolume;
  const direction     = a.atlasScore.direction;
  const bullProb      = a.atlasScore.bullishProbability;
  const momentumScore = a.atlasScore.momentumScore;
  const trendScore    = a.atlasScore.trendScore;
  const volumeScore   = a.atlasScore.volumeScore;
  const optionsScore  = a.atlasScore.optionsScore;
  const gapProb       = a.volatility.atrPercent >= 2.5 && a.atlasScore.bullishProbability >= 58 ? 0.4 : 0;
  const priceVsSma20  = a.trend.priceVsSma20;

  if (score >= 75 && direction === "bullish" && bullProb >= 62)
    categories.push("high_prob_long");

  if (momentumScore >= 68 && trendScore >= 65 && rvol >= 1.5 && priceVsSma20 > 2)
    categories.push("breakout");

  if (gapProb >= 0.35 && score >= 65 && direction === "bullish")
    categories.push("gap_setup_long");

  if (optionsScore >= 68 && rvol >= 2.0)
    categories.push("gamma_squeeze");

  if (rsi <= 38 && rvol >= 2.0 && direction === "bullish")
    categories.push("short_squeeze");

  if (volumeScore >= 65 && trendScore >= 65 && rvol >= 1.1 && rvol < 2.5 && rsi >= 40 && rsi <= 62)
    categories.push("institutional_accum");

  if (rsi <= 42 && score >= 60 && priceVsSma20 < -3)
    categories.push("mean_reversion");

  // Most conservative position mult; widest stop mult across all categories
  const posMult  = categories.reduce((m, c) => Math.min(m, POS_MULT[c]  ?? 1.0), 1.0);
  const stopMult = categories.reduce((m, c) => Math.max(m, STOP_MULT[c] ?? 1.0), 1.0);

  return { categories, positionMultiplier: posMult, stopMultiplier: stopMult };
}

// ── Full per-ticker verdict ───────────────────────────────────────────────────

export async function getIntelligenceVerdict(
  a: AnalysisResult,
  marketCtx: MarketContext,
): Promise<IntelligenceVerdict> {
  const ticker = a.quote.ticker as string;
  const score  = a.atlasScore.overall;
  const rsi    = a.momentum.rsi;

  const [simGate] = await Promise.all([getSimGate(score, rsi)]);
  const calibGate  = getCalibGate(ticker, score);
  const scannerInfo = detectScannerCategories(a);

  let overallAllow = marketCtx.allowNewEntries;
  let blockedBy: string | null = null;

  if (!overallAllow) {
    blockedBy = "market_regime";
  } else if (!simGate.allow) {
    overallAllow = false;
    blockedBy    = "sim_gate";
  } else if (!calibGate.allow) {
    overallAllow = false;
    blockedBy    = "calibration_gate";
  }

  return { simGate, calibGate, scannerInfo, overallAllow, blockedBy };
}

// ── 5. Self-learning adaptation ───────────────────────────────────────────────
// Anti-overfitting guardrails:
//   • MIN_TRADES_TO_ADAPT  — minimum closed trades in the recent window
//   • RECENT_WINDOW_DAYS   — only trades from the last N days count
//   • FROZEN_BASELINE      — the original production-calibrated score floor
//   • HARD_FLOOR / HARD_CEILING — absolute limits self-learning cannot cross
//   • Rollback check — if the last adaptation raised the threshold but win
//     rate is still degrading, revert rather than compounding the mistake
//   • Per-cycle step limits (±3 up / ±2 down) prevent large one-shot drifts

const FROZEN_BASELINE     = 65;   // production-calibrated reference
const HARD_FLOOR          = 57;   // FROZEN_BASELINE − 8: never relax below this
const HARD_CEILING        = 77;   // FROZEN_BASELINE + 12: never tighten above this
const MIN_TRADES_TO_ADAPT = 20;   // raised from 10 — need statistical significance
const RECENT_WINDOW_DAYS  = 90;   // ignore trades older than 90 days

let selfLearningRunning = false;

export async function runSelfLearning(): Promise<AdaptationResult | null> {
  if (selfLearningRunning) return null;
  selfLearningRunning = true;
  try {
    const windowStart = new Date(Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const allClosed = await db
      .select()
      .from(paperTradesTable)
      .where(eq(paperTradesTable.status, "closed"))
      .orderBy(desc(paperTradesTable.exitAt))
      .limit(50);

    // Only count trades closed within the recent window for adaptation decisions
    const closed = allClosed.filter(t => t.exitAt && t.exitAt >= windowStart);

    if (closed.length < MIN_TRADES_TO_ADAPT) {
      logger.info(
        { recentTrades: closed.length, required: MIN_TRADES_TO_ADAPT, windowDays: RECENT_WINDOW_DAYS },
        "Bot self-learning: insufficient recent trades — skipping adaptation"
      );
      return null;
    }

    const winners       = closed.filter(t => (t.pnlPercent ?? 0) > 0).length;
    const actualWinRate = (winners / closed.length) * 100;

    // Compute expected win rate from sim data for the same score-bucket mix
    await loadSimGateCache();
    let expectedWinRate = 55; // fallback prior
    if (simGateCache && simGateCache.size > 0) {
      let totalWeight = 0, weightedSum = 0;
      for (const trade of closed) {
        const bucket  = scoreTosBucket(trade.entryScore);
        const entries = [...simGateCache.entries()].filter(([k]) => k.startsWith(bucket + ":"));
        if (entries.length > 0) {
          const totalN = entries.reduce((s, [, v]) => s + v.n, 0);
          const wavg   = entries.reduce((s, [, v]) => s + v.hitRate5d * v.n, 0) / (totalN || 1);
          weightedSum += wavg;
          totalWeight++;
        }
      }
      if (totalWeight > 0) expectedWinRate = weightedSum / totalWeight;
    }

    const [config] = await db.select().from(botConfigTable).limit(1);
    if (!config) return null;

    type Crit = { field: string; operator: string; value?: number; value2?: number };
    const criteria   = (config.entryCriteria ?? []) as Crit[];
    const scoreCrit  = criteria.find(c => c.field === "score" && c.operator === "gte");
    const currentMin = scoreCrit?.value ?? FROZEN_BASELINE;
    const gap        = expectedWinRate - actualWinRate;

    // ── Rollback guard ─────────────────────────────────────────────────────
    // Check the last adaptation: if it raised the threshold and the win rate
    // is *still* below expected by the same gap, that raise didn't help.
    // Roll back instead of raising further (avoid compounding the error).
    const lastAdaptations = await db
      .select()
      .from(botAdaptationLogTable)
      .orderBy(desc(botAdaptationLogTable.adaptedAt))
      .limit(2);

    const lastAdapt = lastAdaptations[0];
    const shouldRollback =
      lastAdapt &&
      lastAdapt.newScoreMin > lastAdapt.oldScoreMin &&  // last move raised threshold
      gap > 10 &&                                        // still underperforming
      currentMin > FROZEN_BASELINE;                     // already above baseline

    if (shouldRollback) {
      const rollbackTarget = Math.max(FROZEN_BASELINE, currentMin - 3);
      const rollbackCriteria: Crit[] = scoreCrit
        ? criteria.map(c =>
            c.field === "score" && c.operator === "gte" ? { ...c, value: rollbackTarget } : c)
        : [...criteria, { field: "score", operator: "gte", value: rollbackTarget }];

      await db.update(botConfigTable)
        .set({ entryCriteria: rollbackCriteria as unknown as Record<string, unknown>[], updatedAt: new Date() })
        .where(eq(botConfigTable.id, config.id));

      const rollbackReason = `raised threshold last cycle (${lastAdapt.oldScoreMin}→${lastAdapt.newScoreMin}) but performance still degrading (${actualWinRate.toFixed(0)}% vs expected ${expectedWinRate.toFixed(0)}%) — rolling back`;
      await db.insert(botAdaptationLogTable).values({
        trigger: "self_learning_rollback", oldScoreMin: currentMin, newScoreMin: rollbackTarget,
        actualWinRate, expectedWinRate, tradesAnalyzed: closed.length, notes: rollbackReason,
      });

      const result: AdaptationResult = {
        adapted: true, oldScoreMin: currentMin, newScoreMin: rollbackTarget,
        actualWinRate, expectedWinRate, tradesAnalyzed: closed.length, reason: rollbackReason,
      };
      state.lastAdaptation = result;
      state.lastAdaptedAt  = new Date().toISOString();
      logger.info({ currentMin, rollbackTarget, actualWinRate, expectedWinRate }, "Bot intelligence: rolling back — last raise didn't improve performance");
      return result;
    }

    // ── Standard adaptation ────────────────────────────────────────────────
    let newScoreMin = currentMin;
    let reason:     string;

    if (gap > 12) {
      // Underperforming — raise threshold (hard ceiling enforced)
      newScoreMin = Math.min(currentMin + 3, HARD_CEILING);
      reason = `actual ${actualWinRate.toFixed(0)}% vs sim-expected ${expectedWinRate.toFixed(0)}% — raising score threshold`;
    } else if (gap < -8 && actualWinRate > 62) {
      // Outperforming — relax threshold slightly (hard floor enforced)
      newScoreMin = Math.max(currentMin - 2, HARD_FLOOR);
      reason = `outperforming sim (${actualWinRate.toFixed(0)}% vs ${expectedWinRate.toFixed(0)}%) — relaxing threshold slightly`;
    } else {
      return null;
    }

    if (newScoreMin === currentMin) return null;

    // Update existing criterion or inject a new one so the change actually takes effect
    const updatedCriteria: Crit[] = scoreCrit
      ? criteria.map(c =>
          c.field === "score" && c.operator === "gte" ? { ...c, value: newScoreMin } : c)
      : [...criteria, { field: "score", operator: "gte", value: newScoreMin }];

    await db.update(botConfigTable)
      .set({ entryCriteria: updatedCriteria as unknown as Record<string, unknown>[], updatedAt: new Date() })
      .where(eq(botConfigTable.id, config.id));

    await db.insert(botAdaptationLogTable).values({
      trigger:         "self_learning",
      oldScoreMin:     currentMin,
      newScoreMin,
      actualWinRate,
      expectedWinRate,
      tradesAnalyzed:  closed.length,
      notes:           reason,
    });

    const result: AdaptationResult = {
      adapted: true, oldScoreMin: currentMin, newScoreMin,
      actualWinRate, expectedWinRate, tradesAnalyzed: closed.length, reason,
    };
    state.lastAdaptation = result;
    state.lastAdaptedAt  = new Date().toISOString();

    logger.info({ oldScoreMin: currentMin, newScoreMin, actualWinRate, expectedWinRate, frozenBaseline: FROZEN_BASELINE }, "Bot intelligence: self-learning adaptation applied");
    return result;
  } catch (err) {
    logger.error({ err }, "Bot intelligence: self-learning failed");
    return null;
  } finally {
    selfLearningRunning = false;
  }
}

// ── Background enhancement loop ───────────────────────────────────────────────

const BG_INTERVAL_MS        = 5  * 60 * 1000;
const SELF_LEARNING_EVERY_MS = 60 * 60 * 1000;
let lastSelfLearning = 0;
let bgStarted        = false;

export function startBackgroundEnhancement(): void {
  if (bgStarted) return;
  bgStarted = true;

  setInterval(async () => {
    state.backgroundRunCount++;
    try {
      // 1. Self-learning check every hour
      if (Date.now() - lastSelfLearning > SELF_LEARNING_EVERY_MS) {
        lastSelfLearning = Date.now();
        const r = await runSelfLearning();
        if (r?.adapted) logger.info(r, "Background: self-learning adapted config");
      }

      // 2. Refresh sim gate cache if stale
      if (!simGateCache || Date.now() - simGateCacheAt > SIM_GATE_TTL) {
        await loadSimGateCache();
      }

      // 3. Build calibrations for top-scoring uncalibrated tickers (5 per tick)
      const { getOrStartScanJob }      = await import("./scanJob.js");
      const { runCalibrationBackground } = await import("./backtestEngine.js");

      const job          = getOrStartScanJob();
      const uncalibrated = job.analyses
        .filter(a => {
          const s = calibrationStore.status(a.quote.ticker as string, 10);
          return s === "cold-start" || s === "error";
        })
        .sort((a, b) => b.atlasScore.overall - a.atlasScore.overall)
        .slice(0, 5);

      state.calibrationsPending = uncalibrated.length;

      for (const a of uncalibrated) {
        const ticker = a.quote.ticker as string;
        if (calibrationStore.markPending(ticker, 10)) {
          runCalibrationBackground(ticker).catch(err =>
            logger.warn({ ticker, err }, "Background calibration failed")
          );
        }
      }
    } catch (err) {
      logger.error({ err }, "Background enhancement tick error");
    }
  }, BG_INTERVAL_MS);

  // Kickoff: load sim gate cache 10s after server starts
  setTimeout(() => { void loadSimGateCache(); }, 10_000);

  logger.info("Bot background enhancement loop started (5-min interval)");
}

// ── Adaptation log query ──────────────────────────────────────────────────────

export async function getAdaptationLog(limit = 20) {
  return db
    .select()
    .from(botAdaptationLogTable)
    .orderBy(desc(botAdaptationLogTable.adaptedAt))
    .limit(limit);
}

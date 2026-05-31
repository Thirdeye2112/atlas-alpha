import { Router, type IRouter } from "express";
import { runBacktest, spearmanIC } from "../lib/backtestEngine.js";
import { fetchOHLCV } from "../lib/marketData.js";
import { signalLogTable } from "@workspace/db";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import NodeCache from "node-cache";

const backtestCache = new NodeCache({ stdTTL: 3600 });
const router: IRouter = Router();

function r3(n: number) { return Math.round(n * 1000) / 1000; }

router.get("/backtest/ic", async (req, res): Promise<void> => {
  const ticker  = String(req.query.ticker ?? "SPY").toUpperCase();
  const horizon = Math.max(1, Math.min(60, Number(req.query.horizon ?? 10)));
  const cacheKey = `backtest:${ticker}:${horizon}`;

  const cached = backtestCache.get(cacheKey);
  if (cached) { res.json(cached); return; }

  try {
    const result = await runBacktest(ticker, horizon);
    backtestCache.set(cacheKey, result);
    res.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: msg });
  }
});

// Multi-horizon batch: runs 1D, 5D, 10D, 20D in parallel and returns IC progression
router.get("/backtest/multi", async (req, res): Promise<void> => {
  const ticker = String(req.query.ticker ?? "SPY").toUpperCase();
  const horizons = [1, 5, 10, 20];
  try {
    const results = await Promise.all(
      horizons.map(async h => {
        const cacheKey = `backtest:${ticker}:${h}`;
        const cached = backtestCache.get<object>(cacheKey);
        if (cached) return cached;
        const r = await runBacktest(ticker, h);
        backtestCache.set(cacheKey, r);
        return r;
      })
    );
    const horizonRows = results.map((r: any) => ({
      horizon: r.horizon,
      rankIC: r.rankIC,
      rankICRating: r.rankICRating,
      icTStat: r.icTStat,
      categoryIC: r.categoryIC,
      optimalWeights: r.optimalWeights,
      totalObservations: r.totalObservations,
    }));
    const bestRow = horizonRows.reduce((best, r) =>
      Math.abs(r.rankIC) > Math.abs(best.rankIC) ? r : best, horizonRows[0]!);
    res.json({ ticker, horizons: horizonRows, optimalHorizon: bestRow?.horizon ?? null });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: msg });
  }
});

// ── Cross-sectional IC ────────────────────────────────────────────────────────
// Computes the rank IC across all tickers in signal_log for each scan date.
// Each cross-section is one scanner run: scores at time T vs forward returns T→T+horizon.
// Forward prices are fetched from the daily OHLCV cache (or newly fetched if not cached).
// Results are cached for 1 hour.
router.get("/backtest/cross-sectional", async (req, res): Promise<void> => {
  const horizon = Math.max(1, Math.min(20, Number(req.query.horizon ?? 5)));
  const csKey = `cross-sectional:${horizon}`;

  const cachedResult = backtestCache.get(csKey);
  if (cachedResult) { res.json(cachedResult); return; }

  try {
    // ── Step 1: Get signal_log entries grouped by scan date ──────────────────
    const qr = await db.execute<{ scan_date: string; ticker: string; score: number }>(sql`
      SELECT
        DATE(logged_at AT TIME ZONE 'UTC')::text AS scan_date,
        ticker,
        score
      FROM signal_log
      ORDER BY scan_date, ticker
    `);
    const rows = (qr as unknown as { rows: Array<{ scan_date: string; ticker: string; score: number }> }).rows;

    if (rows.length === 0) {
      res.json({ status: "accumulating", snapshotCount: 0, needed: 10, horizon, meanCrossIC: null, icTimeSeries: [] });
      return;
    }

    // Group by scan date
    const byDate = new Map<string, Array<{ ticker: string; score: number }>>();
    for (const row of rows) {
      const d = row.scan_date;
      if (!byDate.has(d)) byDate.set(d, []);
      byDate.get(d)!.push({ ticker: row.ticker, score: row.score });
    }

    // Only use dates where we can compute forward returns:
    // need at least (horizon × 1.5) calendar days of forward data
    const cutoffMs = Date.now() - (horizon + 7) * 24 * 60 * 60 * 1000;
    const eligibleDates = [...byDate.keys()]
      .filter(d => new Date(d).getTime() <= cutoffMs)
      .sort();

    if (eligibleDates.length < 5) {
      const total = byDate.size;
      res.json({
        status: "accumulating",
        snapshotCount: total,
        needed: 10,
        horizon,
        note: `${total} scan date(s) captured; need 5+ dates with ${horizon + 7}+ calendar days of forward data. Check back after ${Math.max(0, 5 - eligibleDates.length)} more scan(s) have aged past the horizon.`,
        meanCrossIC: null,
        icTimeSeries: [],
      });
      return;
    }

    // ── Step 2: Fetch 1y daily OHLCV for all unique tickers ─────────────────
    // We batch these so the ohlcvCache is warm; subsequent calls are instant.
    const uniqueTickers = [...new Set(rows.map(r => r.ticker))];
    const priceMap = new Map<string, Map<string, number>>();   // ticker → date → close
    const BATCH = 20;

    for (let i = 0; i < uniqueTickers.length; i += BATCH) {
      const batch = uniqueTickers.slice(i, i + BATCH);
      await Promise.all(batch.map(async ticker => {
        try {
          const bars = await fetchOHLCV(ticker, "1y", "1d");
          const dm = new Map<string, number>();
          for (const bar of bars) dm.set(bar.time as string, bar.close as number);
          priceMap.set(ticker, dm);
        } catch {
          // skip — ticker may be delisted or rate-limited
        }
      }));
    }

    // Sorted trading dates for each ticker (used to find T+horizon)
    const sortedDatesMap = new Map<string, string[]>();
    for (const [ticker, dm] of priceMap) {
      sortedDatesMap.set(ticker, [...dm.keys()].sort());
    }

    // ── Step 3: Compute Spearman IC per eligible scan date ───────────────────
    const icTimeSeries: Array<{ date: string; ic: number; n: number }> = [];

    for (const scanDate of eligibleDates) {
      const crossSection = byDate.get(scanDate)!;
      const pairs: Array<{ score: number; fwdReturn: number }> = [];

      for (const { ticker, score } of crossSection) {
        const dm = priceMap.get(ticker);
        if (!dm) continue;
        const dates = sortedDatesMap.get(ticker)!;

        const startPrice = dm.get(scanDate);
        if (!startPrice) continue;

        // Find the trading date exactly `horizon` bars after scanDate
        const startIdx = dates.indexOf(scanDate);
        if (startIdx === -1 || startIdx + horizon >= dates.length) continue;
        const endDate = dates[startIdx + horizon];
        const endPrice = dm.get(endDate);
        if (!endPrice) continue;

        const fwdReturn = (endPrice - startPrice) / startPrice;
        pairs.push({ score, fwdReturn });
      }

      if (pairs.length < 10) continue;

      const scores  = pairs.map(p => p.score);
      const returns = pairs.map(p => p.fwdReturn);
      const ic = spearmanIC(scores, returns);
      icTimeSeries.push({ date: scanDate, ic: r3(ic), n: pairs.length });
    }

    // ── Step 4: Aggregate ────────────────────────────────────────────────────
    const ics = icTimeSeries.map(d => d.ic);
    const meanCrossIC = ics.length
      ? r3(ics.reduce((s, v) => s + v, 0) / ics.length)
      : null;

    const tStat: number | null = (() => {
      if (ics.length < 3 || meanCrossIC === null) return null;
      const variance = ics.reduce((s, v) => s + (v - meanCrossIC) ** 2, 0) / (ics.length - 1);
      const std = Math.sqrt(variance);
      return std > 0 ? r3(meanCrossIC / (std / Math.sqrt(ics.length))) : null;
    })();

    const positive = ics.filter(v => v > 0).length;

    const result = {
      status:         ics.length >= 5 ? "complete" : "partial",
      horizon,
      snapshotCount:  byDate.size,
      periodsWithIC:  ics.length,
      meanCrossIC,
      tStat,
      positiveRate:   ics.length ? Math.round(positive / ics.length * 100) : null,
      note:           ics.length < 5
        ? `Only ${ics.length} cross-sections could be computed (need price data for both sides of the horizon). Run more backtests to warm the OHLCV cache.`
        : undefined,
      icTimeSeries,
    };

    backtestCache.set(csKey, result);
    res.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err: msg }, "cross-sectional IC error");
    res.status(500).json({ error: msg });
  }
});

export default router;

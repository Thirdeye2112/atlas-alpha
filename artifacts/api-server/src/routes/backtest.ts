import { Router, type IRouter } from "express";
import { runBacktest } from "../lib/backtestEngine.js";
import NodeCache from "node-cache";
import { db, signalLogTable } from "@workspace/db";
import { sql } from "drizzle-orm";

const backtestCache = new NodeCache({ stdTTL: 3600 });
const router: IRouter = Router();

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

// ── Cross-sectional IC — measures score predictiveness across the universe ────
// Accumulates scanner snapshots from signal_log. Each scanner run adds one
// cross-section: scores vs actual forward returns for all 373 tickers.
// Returns { status: 'accumulating' } until 10+ scan dates are available.
router.get("/backtest/cross-sectional", async (req, res): Promise<void> => {
  const horizon = Math.max(1, Math.min(20, Number(req.query.horizon ?? 5)));
  try {
    // Count distinct scan dates (each scanner run generates ~373 rows at same UTC day)
    const qr = await db.execute<{ scan_date: string; ticker_count: string }>(sql`
      SELECT DATE(logged_at AT TIME ZONE 'UTC') AS scan_date,
             COUNT(*)::text AS ticker_count
      FROM signal_log
      GROUP BY DATE(logged_at AT TIME ZONE 'UTC')
      ORDER BY scan_date DESC
      LIMIT 60
    `);
    const rows = (qr as unknown as { rows: Array<{ scan_date: string; ticker_count: string }> }).rows;
    const snapshotCount = rows.length;
    const needed = 10;
    if (snapshotCount < needed) {
      res.json({
        status: "accumulating",
        snapshotCount,
        needed,
        horizon,
        note: `Cross-sectional IC builds over time. ${snapshotCount}/${needed} scanner snapshots captured. Each scanner run adds one data point — check back after ${needed - snapshotCount} more scan(s).`,
        meanCrossIC: null,
        icTimeSeries: [],
      });
      return;
    }
    // Return accumulated status with snapshot metadata
    res.json({
      status: "accumulating",
      snapshotCount,
      needed,
      horizon,
      note: `${snapshotCount} scanner snapshots captured. Full cross-sectional IC computation coming soon — requires forward-return pairing across scan dates.`,
      meanCrossIC: null,
      icTimeSeries: rows.slice(0, 20).map((r: { scan_date: string; ticker_count: string }) => ({ date: r.scan_date, tickerCount: Number(r.ticker_count) })),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

export default router;

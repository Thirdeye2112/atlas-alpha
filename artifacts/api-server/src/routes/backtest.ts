import { Router, type IRouter } from "express";
import { runBacktest } from "../lib/backtestEngine.js";
import NodeCache from "node-cache";

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
    res.json({ ticker, horizons: results.map((r: any) => ({
      horizon: r.horizon,
      rankIC: r.rankIC,
      rankICRating: r.rankICRating,
      icTStat: r.icTStat,
      categoryIC: r.categoryIC,
      optimalWeights: r.optimalWeights,
      totalObservations: r.totalObservations,
    })) });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: msg });
  }
});

export default router;

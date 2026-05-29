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

export default router;

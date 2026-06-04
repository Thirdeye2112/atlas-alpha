import { Router } from "express";
import { runGapAnalysis } from "../lib/gapAnalysis.js";
import { runDynamicsAnalysis } from "../lib/runDynamicsEngine.js";
import { runMarketTendencies } from "../lib/marketTendencies.js";

const router = Router();

/**
 * GET /research/gap-analysis?threshold=5
 *
 * Runs a historical gap analysis across the scanner universe.
 * Results are cached for 6 hours — first call may take 20–60s.
 */
router.get("/research/gap-analysis", async (req, res) => {
  const raw = req.query["threshold"];
  const threshold = raw ? Math.max(1, Math.min(20, Number(raw))) : 5;
  if (isNaN(threshold)) {
    res.status(400).json({ error: "threshold must be a number between 1 and 20" });
    return;
  }
  const result = await runGapAnalysis(threshold);
  res.json(result);
});

/**
 * GET /research/run-dynamics?ticker=NVDA&period=2y&interval=1h
 *
 * Analyses directional price runs on a configurable timeframe:
 * detects momentum runs, measures velocity / distance / retrace time,
 * and computes correlations to determine whether this asset is a
 * momentum or mean-reversion vehicle at that timeframe.
 *
 * Yahoo Finance data limits (hard ceiling):
 *   1m  → max 7 days
 *   5m, 15m, 30m → max 60 days
 *   1h  → max 2 years
 *   1d  → max 10 years
 *
 * Results are cached 15 min (matches OHLCV cache).
 */
router.get("/research/run-dynamics", async (req, res) => {
  const ticker = typeof req.query["ticker"] === "string"
    ? req.query["ticker"].toUpperCase().trim()
    : null;

  if (!ticker || ticker.length < 1 || ticker.length > 10) {
    res.status(400).json({ error: "ticker is required (1–10 chars)" });
    return;
  }

  // Enforce Yahoo Finance limits: map interval → allowed periods
  const PERIOD_LIMITS: Record<string, string[]> = {
    "1m":  ["1d", "5d", "7d"],
    "5m":  ["1d", "5d", "1mo", "2mo"],
    "15m": ["5d", "1mo", "2mo"],
    "30m": ["5d", "1mo", "2mo"],
    "1h":  ["1mo", "3mo", "6mo", "1y", "2y"],
    "1d":  ["3mo", "6mo", "1y", "2y", "5y"],
  };

  const VALID_INTERVALS = Object.keys(PERIOD_LIMITS);

  const interval = typeof req.query["interval"] === "string" && VALID_INTERVALS.includes(req.query["interval"])
    ? req.query["interval"]
    : "1h";

  const allowedPeriods = PERIOD_LIMITS[interval];
  const rawPeriod = typeof req.query["period"] === "string" ? req.query["period"] : "";
  const period = allowedPeriods.includes(rawPeriod) ? rawPeriod : allowedPeriods[allowedPeriods.length - 1];

  try {
    const result = await runDynamicsAnalysis(ticker, period, interval);
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.warn({ ticker, period, interval, err: msg }, "run-dynamics error");
    res.status(500).json({ error: msg });
  }
});

/**
 * GET /research/market-tendencies
 *
 * OMNI-style directional signals + consecutive-day streak statistics
 * for SPY, QQQ, IWM, DIA. Also computes market "rules" (5-day rule,
 * pre-holiday drift, new-highs-beget-new-highs, VIX reversion, etc.)
 * Results cached 5 minutes.
 */
router.get("/research/market-tendencies", async (req, res) => {
  try {
    const result = await runMarketTendencies();
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.warn({ err: msg }, "market-tendencies error");
    res.status(500).json({ error: msg });
  }
});

export default router;

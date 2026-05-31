import { Router } from "express";
import { runGapAnalysis } from "../lib/gapAnalysis.js";
import { runDynamicsAnalysis } from "../lib/runDynamicsEngine.js";

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
 * GET /research/run-dynamics?ticker=NVDA&period=5d&interval=5m
 *
 * Analyses intraday directional runs on a 5-min (or custom) chart:
 * detects momentum runs, measures velocity / distance / retrace time,
 * and computes correlations to determine whether this asset is a
 * momentum or mean-reversion vehicle at the intraday level.
 * Results are cached 15 min (matches OHLCV cache).
 */
router.get("/research/run-dynamics", async (req, res) => {
  const ticker = typeof req.query["ticker"] === "string"
    ? req.query["ticker"].toUpperCase().trim()
    : null;

  if (!ticker || ticker.length < 1 || ticker.length > 8) {
    res.status(400).json({ error: "ticker is required (1–8 chars)" });
    return;
  }

  const VALID_PERIODS   = new Set(["1d", "5d", "1mo", "3mo"]);
  const VALID_INTERVALS = new Set(["1m", "5m", "15m", "30m", "60m"]);

  const period   = typeof req.query["period"]   === "string" && VALID_PERIODS.has(req.query["period"])
    ? req.query["period"] : "5d";
  const interval = typeof req.query["interval"] === "string" && VALID_INTERVALS.has(req.query["interval"])
    ? req.query["interval"] : "5m";

  try {
    const result = await runDynamicsAnalysis(ticker, period, interval);
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.warn({ ticker, err: msg }, "run-dynamics error");
    res.status(500).json({ error: msg });
  }
});

export default router;

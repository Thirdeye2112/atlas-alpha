import { Router } from "express";
import { runGapAnalysis } from "../lib/gapAnalysis.js";

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

export default router;

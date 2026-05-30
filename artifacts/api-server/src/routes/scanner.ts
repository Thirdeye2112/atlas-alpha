import { Router, type IRouter } from "express";
import { getOrStartScanJob } from "../lib/scanJob.js";
import { calcScannerResult } from "../lib/scoring.js";
import { logger } from "../lib/logger.js";
import type { AnalysisResult } from "../lib/analysisEngine.js";

const router: IRouter = Router();

function getGapPercent(a: AnalysisResult): number {
  const open = a.quote.open as number;
  const prevClose = a.quote.previousClose as number;
  if (!prevClose) return 0;
  return Math.round(((open - prevClose) / prevClose) * 10000) / 100;
}

function toRow(a: AnalysisResult) {
  return calcScannerResult(
    a.quote.ticker as string,
    a.quote.name as string,
    a.quote.price as number,
    a.quote.change as number,
    a.quote.changePercent as number,
    a.atlasScore,
    a.volume,
    a.momentum,
    a.trend,
    (a.quote.sector as string | null) ?? null,
    a.quote.volume as number,
    getGapPercent(a)
  );
}

type Filter = (a: AnalysisResult) => boolean;
type Sorter = (a: AnalysisResult, b: AnalysisResult) => number;

function scanResponse(filter: Filter, sort: Sorter, limit: number) {
  const job = getOrStartScanJob();
  const rows = job.analyses
    .filter(filter)
    .sort(sort)
    .slice(0, limit)
    .map(toRow);

  return {
    results: rows,
    progress: { done: job.done, total: job.total },
    complete: job.complete,
  };
}

// ── Routes ────────────────────────────────────────────────────────────────────

router.get("/scanner/top-longs", (req, res): void => {
  const limit = Math.min(Number(req.query.limit) || 25, 50);
  try {
    res.json(scanResponse(
      a => a.atlasScore.bullishProbability > 65 && a.atlasScore.confidenceScore > 60,
      (a, b) => b.atlasScore.overall - a.atlasScore.overall,
      limit
    ));
  } catch (err) {
    logger.error({ err }, "Scanner top-longs failed");
    res.json({ results: [], progress: { done: 0, total: 0 }, complete: true });
  }
});

router.get("/scanner/top-shorts", (req, res): void => {
  const limit = Math.min(Number(req.query.limit) || 25, 50);
  try {
    res.json(scanResponse(
      a => a.atlasScore.bearishProbability > 65 && a.atlasScore.confidenceScore > 60,
      (a, b) => a.atlasScore.overall - b.atlasScore.overall,
      limit
    ));
  } catch (err) {
    logger.error({ err }, "Scanner top-shorts failed");
    res.json({ results: [], progress: { done: 0, total: 0 }, complete: true });
  }
});

router.get("/scanner/breakouts", (req, res): void => {
  const limit = Math.min(Number(req.query.limit) || 25, 50);
  try {
    res.json(scanResponse(
      a => {
        const nearResistance = a.volatility.bollingerUpper > 0 &&
          (a.quote.price as number) >= a.volatility.bollingerUpper * 0.98;
        return a.atlasScore.direction === "bullish" && a.volume.volumeSpike && nearResistance;
      },
      (a, b) => b.volume.relativeVolume - a.volume.relativeVolume,
      limit
    ));
  } catch (err) {
    logger.error({ err }, "Scanner breakouts failed");
    res.json({ results: [], progress: { done: 0, total: 0 }, complete: true });
  }
});

router.get("/scanner/breakdowns", (req, res): void => {
  const limit = Math.min(Number(req.query.limit) || 25, 50);
  try {
    res.json(scanResponse(
      a => {
        const nearSupport = a.volatility.bollingerLower > 0 &&
          (a.quote.price as number) <= a.volatility.bollingerLower * 1.02;
        return a.atlasScore.direction === "bearish" && a.volume.volumeSpike && nearSupport;
      },
      (a, b) => a.atlasScore.overall - b.atlasScore.overall,
      limit
    ));
  } catch (err) {
    logger.error({ err }, "Scanner breakdowns failed");
    res.json({ results: [], progress: { done: 0, total: 0 }, complete: true });
  }
});

router.get("/scanner/gamma-squeeze", (req, res): void => {
  const limit = Math.min(Number(req.query.limit) || 25, 50);
  try {
    res.json(scanResponse(
      a => a.volume.relativeVolume > 2 && a.atlasScore.bullishProbability > 60 && a.options.unusualActivity,
      (a, b) => b.volume.relativeVolume - a.volume.relativeVolume,
      limit
    ));
  } catch (err) {
    logger.error({ err }, "Scanner gamma-squeeze failed");
    res.json({ results: [], progress: { done: 0, total: 0 }, complete: true });
  }
});

router.get("/scanner/short-squeeze", (req, res): void => {
  const limit = Math.min(Number(req.query.limit) || 25, 50);
  try {
    res.json(scanResponse(
      a => a.volume.relativeVolume > 1.5 && a.atlasScore.bullishProbability > 55 &&
        a.momentum.rsi > 55 && a.trend.trendAlignmentScore > 55,
      (a, b) => b.atlasScore.overall - a.atlasScore.overall,
      limit
    ));
  } catch (err) {
    logger.error({ err }, "Scanner short-squeeze failed");
    res.json({ results: [], progress: { done: 0, total: 0 }, complete: true });
  }
});

router.get("/scanner/institutional-accumulation", (req, res): void => {
  const limit = Math.min(Number(req.query.limit) || 25, 50);
  try {
    res.json(scanResponse(
      a => a.volume.obvTrend === "rising" && a.volume.chaikinMoneyFlow > 0.05 &&
        a.atlasScore.volumeScore > 60,
      (a, b) => b.volume.chaikinMoneyFlow - a.volume.chaikinMoneyFlow,
      limit
    ));
  } catch (err) {
    logger.error({ err }, "Scanner institutional failed");
    res.json({ results: [], progress: { done: 0, total: 0 }, complete: true });
  }
});

router.get("/scanner/mean-reversion", (req, res): void => {
  const limit = Math.min(Number(req.query.limit) || 25, 50);
  try {
    res.json(scanResponse(
      a => (a.momentum.rsiSignal === "oversold" && a.atlasScore.direction !== "bearish") ||
        (a.momentum.rsiSignal === "overbought" && a.atlasScore.direction !== "bullish"),
      (a, b) => Math.abs(b.momentum.rsi - 50) - Math.abs(a.momentum.rsi - 50),
      limit
    ));
  } catch (err) {
    logger.error({ err }, "Scanner mean-reversion failed");
    res.json({ results: [], progress: { done: 0, total: 0 }, complete: true });
  }
});

router.get("/scanner/gap-up", (req, res): void => {
  const limit = Math.min(Number(req.query.limit) || 25, 50);
  try {
    res.json(scanResponse(
      a => {
        const gap = getGapPercent(a);
        return gap >= 2.0 && (a.quote.previousClose as number) > 0;
      },
      (a, b) => getGapPercent(b) - getGapPercent(a),
      limit
    ));
  } catch (err) {
    logger.error({ err }, "Scanner gap-up failed");
    res.json({ results: [], progress: { done: 0, total: 0 }, complete: true });
  }
});

router.get("/scanner/gap-down", (req, res): void => {
  const limit = Math.min(Number(req.query.limit) || 25, 50);
  try {
    res.json(scanResponse(
      a => {
        const gap = getGapPercent(a);
        return gap <= -2.0 && (a.quote.previousClose as number) > 0;
      },
      (a, b) => getGapPercent(a) - getGapPercent(b),
      limit
    ));
  } catch (err) {
    logger.error({ err }, "Scanner gap-down failed");
    res.json({ results: [], progress: { done: 0, total: 0 }, complete: true });
  }
});

export default router;

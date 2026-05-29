import { Router, type IRouter } from "express";
import { SCANNER_UNIVERSE } from "../lib/scannerUniverse.js";
import { runFullAnalysis, type AnalysisResult } from "../lib/analysisEngine.js";
import { scannerCache } from "../lib/cache.js";
import { calcScannerResult } from "../lib/scoring.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

type ScannerFilter = (analysis: AnalysisResult) => boolean;
type ScannerSort = (a: AnalysisResult, b: AnalysisResult) => number;

async function runScanner(
  cacheKey: string,
  filter: ScannerFilter,
  sort: ScannerSort,
  limit: number
) {
  const cached = scannerCache.get<object[]>(cacheKey);
  if (cached) return cached.slice(0, limit);

  const universe = SCANNER_UNIVERSE;
  const analyses: AnalysisResult[] = [];
  const batchSize = 20;

  for (let i = 0; i < universe.length; i += batchSize) {
    const batch = universe.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map(ticker => runFullAnalysis(ticker))
    );
    for (const r of results) {
      if (r.status === "fulfilled") analyses.push(r.value as AnalysisResult);
    }
  }

  const filtered = analyses.filter(filter).sort(sort);

  const results = filtered.map(a =>
    calcScannerResult(
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
      a.quote.volume as number
    )
  );

  scannerCache.set(cacheKey, results);
  return results.slice(0, limit);
}

router.get("/scanner/top-longs", async (req, res): Promise<void> => {
  const limit = Math.min(Number(req.query.limit) || 25, 50);
  try {
    const results = await runScanner(
      "scanner:top-longs",
      a => a.atlasScore.bullishProbability > 65 && a.atlasScore.confidenceScore > 60,
      (a, b) => b.atlasScore.overall - a.atlasScore.overall,
      limit
    );
    res.json(results);
  } catch (err) {
    logger.error({ err }, "Scanner top-longs failed");
    res.json([]);
  }
});

router.get("/scanner/top-shorts", async (req, res): Promise<void> => {
  const limit = Math.min(Number(req.query.limit) || 25, 50);
  try {
    const results = await runScanner(
      "scanner:top-shorts",
      a => a.atlasScore.bearishProbability > 65 && a.atlasScore.confidenceScore > 60,
      (a, b) => a.atlasScore.overall - b.atlasScore.overall,
      limit
    );
    res.json(results);
  } catch (err) {
    logger.error({ err }, "Scanner top-shorts failed");
    res.json([]);
  }
});

router.get("/scanner/breakouts", async (req, res): Promise<void> => {
  const limit = Math.min(Number(req.query.limit) || 25, 50);
  try {
    const results = await runScanner(
      "scanner:breakouts",
      a => {
        const nearResistance = a.volatility.bollingerUpper > 0 &&
          (a.quote.price as number) >= a.volatility.bollingerUpper * 0.98;
        return a.atlasScore.direction === "bullish" && a.volume.volumeSpike && nearResistance;
      },
      (a, b) => b.volume.relativeVolume - a.volume.relativeVolume,
      limit
    );
    res.json(results);
  } catch (err) {
    logger.error({ err }, "Scanner breakouts failed");
    res.json([]);
  }
});

router.get("/scanner/breakdowns", async (req, res): Promise<void> => {
  const limit = Math.min(Number(req.query.limit) || 25, 50);
  try {
    const results = await runScanner(
      "scanner:breakdowns",
      a => {
        const nearSupport = a.volatility.bollingerLower > 0 &&
          (a.quote.price as number) <= a.volatility.bollingerLower * 1.02;
        return a.atlasScore.direction === "bearish" && a.volume.volumeSpike && nearSupport;
      },
      (a, b) => a.atlasScore.overall - b.atlasScore.overall,
      limit
    );
    res.json(results);
  } catch (err) {
    logger.error({ err }, "Scanner breakdowns failed");
    res.json([]);
  }
});

router.get("/scanner/gamma-squeeze", async (req, res): Promise<void> => {
  const limit = Math.min(Number(req.query.limit) || 25, 50);
  try {
    const results = await runScanner(
      "scanner:gamma-squeeze",
      a => a.volume.relativeVolume > 2 && a.atlasScore.bullishProbability > 60 && a.options.unusualActivity,
      (a, b) => b.volume.relativeVolume - a.volume.relativeVolume,
      limit
    );
    res.json(results);
  } catch (err) {
    logger.error({ err }, "Scanner gamma-squeeze failed");
    res.json([]);
  }
});

router.get("/scanner/short-squeeze", async (req, res): Promise<void> => {
  const limit = Math.min(Number(req.query.limit) || 25, 50);
  try {
    const results = await runScanner(
      "scanner:short-squeeze",
      a => a.volume.relativeVolume > 1.5 && a.atlasScore.bullishProbability > 55 &&
        a.momentum.rsi > 55 && a.trend.trendAlignmentScore > 55,
      (a, b) => b.atlasScore.overall - a.atlasScore.overall,
      limit
    );
    res.json(results);
  } catch (err) {
    logger.error({ err }, "Scanner short-squeeze failed");
    res.json([]);
  }
});

router.get("/scanner/institutional-accumulation", async (req, res): Promise<void> => {
  const limit = Math.min(Number(req.query.limit) || 25, 50);
  try {
    const results = await runScanner(
      "scanner:institutional-accumulation",
      a => a.volume.obvTrend === "rising" && a.volume.chaikinMoneyFlow > 0.05 &&
        a.atlasScore.volumeScore > 60,
      (a, b) => b.volume.chaikinMoneyFlow - a.volume.chaikinMoneyFlow,
      limit
    );
    res.json(results);
  } catch (err) {
    logger.error({ err }, "Scanner institutional failed");
    res.json([]);
  }
});

router.get("/scanner/mean-reversion", async (req, res): Promise<void> => {
  const limit = Math.min(Number(req.query.limit) || 25, 50);
  try {
    const results = await runScanner(
      "scanner:mean-reversion",
      a => (a.momentum.rsiSignal === "oversold" && a.atlasScore.direction !== "bearish") ||
        (a.momentum.rsiSignal === "overbought" && a.atlasScore.direction !== "bullish"),
      (a, b) => Math.abs(b.momentum.rsi - 50) - Math.abs(a.momentum.rsi - 50),
      limit
    );
    res.json(results);
  } catch (err) {
    logger.error({ err }, "Scanner mean-reversion failed");
    res.json([]);
  }
});

export default router;

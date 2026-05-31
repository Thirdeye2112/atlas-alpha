import { Router, type IRouter } from "express";
import { getOrStartScanJob } from "../lib/scanJob.js";
import { calcScannerResult } from "../lib/scoring.js";
import { getAssetType, isStructurallyDistorted } from "../lib/scannerUniverse.js";
import { logger } from "../lib/logger.js";
import type { AnalysisResult } from "../lib/analysisEngine.js";

const router: IRouter = Router();

// ── Gap Probability Score ─────────────────────────────────────────────────────
// Weights mirror research effect sizes: ATR +1.40σ (40%), BB +1.14σ (35%), RVOL +0.72σ (25%)
// Score = 0 at filter threshold, 100 at the mean value observed on historical gap days
function clamp01(v: number): number { return Math.max(0, Math.min(100, v)); }
// gapPct: today's open vs prior close (%). If the session has already gapped ≥1.5%,
// the elevated ATR/BB/RVOL are post-gap aftermath — not a forward signal. Score → 0.
// Thresholds are calibrated from T=0 (gap-day) conditions; a future improvement would
// re-derive them from T-1 data to eliminate the gap-event's own inflation of these metrics.
function calcGapProbScore(atrPct: number, bbWidth: number, relVol: number, gapPct = 0): number {
  if (Math.abs(gapPct) >= 1.5) return 0; // gap already fired — conditions are aftermath
  const atrScore  = clamp01((atrPct - 3.2)  / (4.8  - 3.2)  * 100); // 0 at 3.2%, 100 at 4.8%
  const bbScore   = clamp01((bbWidth - 15)   / (23.7 - 15)   * 100); // 0 at 15%, 100 at 23.7%
  const rvolScore = clamp01((relVol - 1.2)   / (1.45 - 1.2)  * 100); // 0 at 1.2x, 100 at 1.45x
  return Math.round(0.40 * atrScore + 0.35 * bbScore + 0.25 * rvolScore);
}

// ── Gap setup row builder ─────────────────────────────────────────────────────
// Replaces the generic catalysts with specific condition strings + injects
// gapSetupScore and earningsDaysAway into the row object.
function toGapSetupRow(a: AnalysisResult, direction: "long" | "short"): object {
  const base = toRow(a) as Record<string, unknown>;
  const atrPct  = a.volatility.atrPercent;
  const bbWidth = a.volatility.bollingerWidth;
  const relVol  = a.volume.relativeVolume;
  const vs200   = a.trend.priceVsSma200;
  const gapPct  = getGapPercent(a);
  const gapSetupScore = calcGapProbScore(atrPct, bbWidth, relVol, gapPct);

  const conditions: string[] = [];

  // Earnings first (highest priority catalyst)
  const earningsTs = (a.quote as Record<string, unknown>).earningsTimestamp as number | null | undefined;
  let earningsDaysAway: number | null = null;
  if (earningsTs && earningsTs > 0) {
    const daysAway = Math.round((earningsTs * 1000 - Date.now()) / 86400000);
    if (daysAway >= 0 && daysAway <= 14) {
      earningsDaysAway = daysAway;
      conditions.push(`EARN ${daysAway}d`);
    }
  }

  conditions.push(`ATR ${atrPct.toFixed(1)}%`, `BB ${bbWidth.toFixed(0)}%`, `VOL ${relVol.toFixed(1)}x`);
  if (direction === "short" && vs200 > 5) conditions.push(`+${vs200.toFixed(0)}% SMA200`);

  return { ...base, catalysts: conditions, gapSetupScore, earningsDaysAway };
}

// ── Scan response with custom row builder ─────────────────────────────────────
function gapSetupScanResponse(
  filter: Filter,
  sort: Sorter,
  limit: number,
  direction: "long" | "short"
) {
  const job = getOrStartScanJob();
  const rows = job.analyses
    .filter(filter)
    .sort(sort)
    .slice(0, limit)
    .map(a => toGapSetupRow(a, direction));

  return {
    results: rows,
    progress: { done: job.done, total: job.total },
    complete: job.complete,
  };
}

function getGapPercent(a: AnalysisResult): number {
  const open = a.quote.open as number;
  const prevClose = a.quote.previousClose as number;
  if (!prevClose) return 0;
  return Math.round(((open - prevClose) / prevClose) * 10000) / 100;
}

function toRow(a: AnalysisResult) {
  const ticker = a.quote.ticker as string;
  return {
    ...calcScannerResult(
      ticker,
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
    ),
    assetType: getAssetType(ticker),
    isDistorted: isStructurallyDistorted(ticker),
  };
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

// ── Gap Setup (pre-gap precursor alert) ──────────────────────────────────────
// Based on research findings: ATR% and BB Width are the top predictors for both
// gap directions. Volume spike the prior day adds a strong second signal.
// Long setup: elevated volatility environment + volume + not overextended upside.
// Short setup: same volatility conditions + price extended above SMA200.

router.get("/scanner/gap-setup-long", (req, res): void => {
  const limit = Math.min(Number(req.query.limit) || 25, 50);
  try {
    res.json(gapSetupScanResponse(
      a => {
        const atrPct  = a.volatility.atrPercent;          // % of price, baseline 2.7%, gaps 4.8%
        const bbWidth = a.volatility.bollingerWidth;       // (upper-lower)/mid, baseline 12.6%, gaps 23.7%
        const relVol  = a.volume.relativeVolume;           // baseline 1.02x, gaps 1.45x
        const gap     = getGapPercent(a);                  // exclude stocks already gapping
        const rsi     = a.momentum.rsi;
        const vs200   = a.trend.priceVsSma200;             // not massively extended above SMA200
        return (
          atrPct  >= 3.2   &&   // elevated volatility (research: 3.5% mean at gap, threshold 3.2)
          bbWidth >= 15    &&   // wide bands (research: 23.7% mean at gap, threshold 15)
          relVol  >= 1.2   &&   // prior-day volume elevated (research: 1.45x mean at gap)
          gap < 2.0        &&   // not already gapping up
          gap > -5.0       &&   // not in a big gap-down right now
          rsi < 70         &&   // not overbought
          vs200 < 30       &&   // not massively extended above SMA200 (gap-down risk)
          a.atlasScore.direction !== "bearish"  // not in confirmed downtrend
        );
      },
      // Sort: composite of ATR% × relative volume — most "primed" stocks first
      (a, b) => (b.volatility.atrPercent * b.volume.relativeVolume) -
                (a.volatility.atrPercent * a.volume.relativeVolume),
      limit,
      "long"
    ));
  } catch (err) {
    logger.error({ err }, "Scanner gap-setup-long failed");
    res.json({ results: [], progress: { done: 0, total: 0 }, complete: true });
  }
});

router.get("/scanner/gap-setup-short", (req, res): void => {
  const limit = Math.min(Number(req.query.limit) || 25, 50);
  try {
    res.json(gapSetupScanResponse(
      a => {
        const atrPct  = a.volatility.atrPercent;
        const bbWidth = a.volatility.bollingerWidth;
        const relVol  = a.volume.relativeVolume;
        const gap     = getGapPercent(a);
        const vs200   = a.trend.priceVsSma200;             // +0.64σ effect: gap-downs come from extended stocks
        const rsi     = a.momentum.rsi;
        return (
          atrPct  >= 3.2   &&   // elevated volatility
          bbWidth >= 15    &&   // wide bands
          relVol  >= 1.2   &&   // volume elevation
          gap > -2.0       &&   // not already gapping down
          gap < 5.0        &&   // not in a big gap-up right now
          vs200 > 5        &&   // extended above SMA200 (research strongest directional predictor)
          rsi > 45         &&   // not already sold off
          a.atlasScore.direction !== "bullish"  // not in confirmed uptrend
        );
      },
      // Sort: most extended above SMA200 with highest ATR (most vulnerable to down-gap)
      (a, b) => (b.trend.priceVsSma200 * b.volatility.atrPercent) -
                (a.trend.priceVsSma200 * a.volatility.atrPercent),
      limit,
      "short"
    ));
  } catch (err) {
    logger.error({ err }, "Scanner gap-setup-short failed");
    res.json({ results: [], progress: { done: 0, total: 0 }, complete: true });
  }
});

// ── Key Levels helpers ────────────────────────────────────────────────────────
const KEY_LEVEL_PROX = 2.0; // % distance threshold

function pctDist(price: number, level: number): number {
  return Math.abs((price - level) / level) * 100;
}

interface NearbyLevel { label: string; level: number; dist: number; type: "support" | "resistance" }

function getNearbyLevels(a: AnalysisResult): NearbyLevel[] {
  const price = a.quote.price as number;
  const { sma50, sma200 } = a.trend;
  const { bollingerUpper, bollingerLower } = a.volatility;
  const { supportLevel, resistanceLevel } = a.patterns;

  const candidates: { label: string; level: number; type: "support" | "resistance" }[] = [
    { label: "SMA50",  level: sma50,          type: price < sma50  ? "resistance" : "support" },
    { label: "SMA200", level: sma200,          type: price < sma200 ? "resistance" : "support" },
    { label: "BB+",    level: bollingerUpper,  type: "resistance" },
    { label: "BB-",    level: bollingerLower,  type: "support"    },
  ];
  if (supportLevel    && supportLevel    > 0) candidates.push({ label: "SUP", level: supportLevel,    type: "support"    });
  if (resistanceLevel && resistanceLevel > 0) candidates.push({ label: "RES", level: resistanceLevel, type: "resistance" });

  return candidates
    .filter(c => c.level > 0)
    .map(c => ({ ...c, dist: pctDist(price, c.level) }))
    .filter(c => c.dist <= KEY_LEVEL_PROX)
    .sort((x, y) => x.dist - y.dist);
}

function toKeyLevelRow(a: AnalysisResult): object {
  const base = toRow(a) as Record<string, unknown>;
  const levels = getNearbyLevels(a);
  const keyLevelDist = levels.length > 0 ? Math.round(levels[0].dist * 100) / 100 : null;
  const catalysts = levels.map(l => `${l.label} ${l.dist.toFixed(1)}%`);
  return { ...base, catalysts, keyLevelDist };
}

router.get("/scanner/key-levels", (req, res): void => {
  const limit = Math.min(Number(req.query.limit) || 25, 50);
  try {
    const job = getOrStartScanJob();
    const rows = job.analyses
      .filter(a => getNearbyLevels(a).length > 0)
      .sort((a, b) => {
        const aLevels = getNearbyLevels(a);
        const bLevels = getNearbyLevels(b);
        const aDist = aLevels.length ? aLevels[0].dist : 99;
        const bDist = bLevels.length ? bLevels[0].dist : 99;
        return aDist - bDist;
      })
      .slice(0, limit)
      .map(toKeyLevelRow);

    res.json({
      results: rows,
      progress: { done: job.done, total: job.total },
      complete: job.complete,
    });
  } catch (err) {
    logger.error({ err }, "Scanner key-levels failed");
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

import { Router, type IRouter } from "express";
import { fetchQuote, fetchOHLCV } from "../lib/marketData.js";
import { runFullAnalysis, runHistoricalAnalysis } from "../lib/analysisEngine.js";
import { calibrationStore } from "../lib/calibrationStore.js";
import { GetStockQuoteParams, GetStockAnalysisParams, GetStockOhlcvParams } from "@workspace/api-zod";
import { checkAlertsForTicker } from "./alerts.js";
import { generateNarrative } from "../lib/narrative.js";
import { computeRetracementForecast } from "../lib/retracementEngine.js";
import { detectFormingPatterns } from "../lib/formingPatterns.js";
import { calcPatternOverlaysMultiTF } from "../lib/patternOverlays.js";
import { calcPullbackReversal } from "../lib/pullbackReversal.js";
import {
  calcTrend, calcMomentum, calcVolume, calcVolatility,
  calcPatterns, calcChartSignals, calcExhaustion, calcRecentCandleStructure,
} from "../lib/indicators.js";
import type { OHLCVBar } from "../lib/marketData.js";

const router: IRouter = Router();

// Effort-vs-result read (the NUAI "big candle then tiny-volume drift that fails the
// prior high" tell): compare the latest up-thrust's volume + whether it made a new
// high vs the prior thrust. Returns a signal that confirms/denies a continuation.
function readVolumeEffort(bars: OHLCVBar[], k = 6): {
  signal: "no_demand" | "demand_confirmed" | "neutral";
  detail: string;
  recentUpVol: number; priorUpVol: number; madeNewHigh: boolean;
} {
  const neutral = { signal: "neutral" as const, detail: "insufficient data", recentUpVol: 0, priorUpVol: 0, madeNewHigh: false };
  if (bars.length < 2 * k + 1) return neutral;
  const recent = bars.slice(-k);
  const prior  = bars.slice(-2 * k, -k);
  const upVol = (arr: OHLCVBar[]) => {
    const ups = arr.filter(b => b.close >= b.open);
    return ups.length ? ups.reduce((s, b) => s + (b.volume ?? 0), 0) / ups.length : 0;
  };
  const recentUpVol = upVol(recent), priorUpVol = upVol(prior);
  const recentHigh = Math.max(...recent.map(b => b.high));
  const priorHigh  = Math.max(...prior.map(b => b.high));
  const madeNewHigh = recentHigh > priorHigh * 1.001;
  const volFaded = priorUpVol > 0 && recentUpVol < priorUpVol * 0.8;

  if (!madeNewHigh && volFaded) {
    return { signal: "no_demand", recentUpVol, priorUpVol, madeNewHigh,
      detail: `Latest push failed the prior high on ${(recentUpVol / (priorUpVol || 1)).toFixed(2)}x the up-volume — no demand / distribution risk, favours a downside resolution.` };
  }
  if (madeNewHigh && recentUpVol >= priorUpVol) {
    return { signal: "demand_confirmed", recentUpVol, priorUpVol, madeNewHigh,
      detail: `New high made on rising up-volume — demand confirmed, continuation favoured.` };
  }
  return { signal: "neutral", recentUpVol, priorUpVol, madeNewHigh,
    detail: madeNewHigh ? "New high but on softer volume — watch for follow-through." : "No new high yet — consolidating." };
}

router.get("/stock/:ticker/quote", async (req, res): Promise<void> => {
  const params = GetStockQuoteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  try {
    const quote = await fetchQuote(params.data.ticker.toUpperCase());
    res.json(quote);
  } catch (err) {
    req.log.warn({ err, ticker: params.data.ticker }, "Quote fetch failed");
    res.status(404).json({ error: `Ticker not found: ${params.data.ticker}` });
  }
});

router.get("/stock/:ticker/analysis", async (req, res): Promise<void> => {
  const params = GetStockAnalysisParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  try {
    const analysis = await runFullAnalysis(params.data.ticker);
    const sym = params.data.ticker.toUpperCase();

    // Overlay calibration data fresh on every request (not cached — calibration
    // updates async and we want the UI to reflect it without requiring a cache flush)
    const calStatus = calibrationStore.status(sym, 10);
    const calEntry  = calibrationStore.getFitted(sym, 10);
    const calibratedProbability = calEntry
      ? calEntry.calibratedProbability(analysis.atlasScore.overall)
      : null;

    res.json({
      ...analysis,
      calibration: {
        status:              calStatus,
        calibratedProbability,
        slope:               calEntry?.slope           ?? null,
        intercept:           calEntry?.intercept        ?? null,
        observations:        calEntry?.observations     ?? null,
        horizon:             calEntry?.horizon          ?? null,
        rankIC:              calEntry?.rankIC           ?? null,
        icRating:            calEntry?.icRating         ?? null,
        fittedAt:            calEntry?.fittedAt         ?? null,
        isContrarian:        calEntry ? (calEntry.rankIC < -0.02 && calEntry.icRating !== "noise") : null,
        usingAdaptiveWeights:calEntry ? !!calEntry.optimalWeights : false,
        signalQuality:       calEntry?.icRating         ?? null,
      },
    });

    // Fire-and-forget: check if any score/direction/price alerts fire for this ticker
    checkAlertsForTicker(sym, analysis.atlasScore.overall, analysis.atlasScore.direction, analysis.quote.price as number)
      .catch(() => { /* non-critical */ });
  } catch (err) {
    req.log.warn({ err, ticker: params.data.ticker }, "Analysis failed");
    res.status(404).json({ error: `Could not analyze ticker: ${params.data.ticker}` });
  }
});

router.get("/stock/:ticker/historical-analysis", async (req, res): Promise<void> => {
  const ticker = (req.params.ticker as string).toUpperCase();
  const asOf   = typeof req.query.asOf === "string" ? req.query.asOf : "";
  if (!asOf || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    res.status(400).json({ error: "asOf query param required (YYYY-MM-DD)" });
    return;
  }
  try {
    const analysis = await runHistoricalAnalysis(ticker, asOf);
    // Historical analyses don't get calibration overlay (point-in-time replay)
    res.json({ ...analysis, calibration: null });
  } catch (err) {
    req.log.warn({ err, ticker, asOf }, "Historical analysis failed");
    res.status(404).json({ error: `Could not analyze ${ticker} as of ${asOf}` });
  }
});

router.get("/stock/:ticker/ohlcv", async (req, res): Promise<void> => {
  const params = GetStockOhlcvParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const period   = typeof req.query.period   === "string" ? req.query.period   : "3mo";
  const interval = typeof req.query.interval === "string" ? req.query.interval : "1d";
  try {
    const bars = await fetchOHLCV(params.data.ticker.toUpperCase(), period, interval);
    res.json(bars);
  } catch (err) {
    req.log.warn({ err, ticker: params.data.ticker }, "OHLCV fetch failed");
    res.status(404).json({ error: `No OHLCV data for ${params.data.ticker}` });
  }
});

// ── Intraday TA patterns — the FULL pattern suite on the chosen timeframe ──────
// Runs every pattern/structure detector the daily analysis uses, but on intraday
// bars, so the system "sees" what you trade on the 5m/15m tape:
//   * forming patterns  — rising/falling wedge, triangles, flags (direction +
//                         measured-move target + drawable trendlines)
//   * structural        — golden/death cross, BB breakout/breakdown, double top,
//                         support/resistance, market structure (calcPatterns)
//   * candlestick pins  — engulfing, hammer, doji, stars, etc. (calcChartSignals)
//   * exhaustion        — distribution top, capitulation, reversal bar, parabolic
//   * pullback-reversal + multi-TF pattern overlays + recent-candle structure
// Each directional pattern is annotated with the effort/result volume read.
// GET /api/stock/:ticker/intraday-patterns?interval=5m&period=5d
router.get("/stock/:ticker/intraday-patterns", async (req, res): Promise<void> => {
  const ticker   = (req.params.ticker as string).toUpperCase();
  const interval = typeof req.query.interval === "string" ? req.query.interval : "5m";
  const period   = typeof req.query.period   === "string" ? req.query.period   : "5d";
  try {
    const bars = await fetchOHLCV(ticker, period, interval);
    if (bars.length < 30) {
      res.json({ ticker, interval, period, count: 0, forming: [], patterns: [],
        signals: [], exhaustion: null, pullback: null, overlays: [], recentCandles: null,
        volume: null, note: "Not enough intraday bars to detect patterns." });
      return;
    }
    const price   = bars[bars.length - 1].close;
    const avgVol  = bars.reduce((s, b) => s + (b.volume ?? 0), 0) / bars.length;

    // shared building blocks (same as the daily analysis, computed on intraday bars)
    const trend      = calcTrend(bars, price);
    const momentum   = calcMomentum(bars);
    const volume     = calcVolume(bars, avgVol);
    const volatility = calcVolatility(bars, price);

    // every pattern detector
    const forming       = detectFormingPatterns(bars);
    const patternRes    = calcPatterns(bars, trend, volatility);
    const signals       = calcChartSignals(bars);
    const exhaustion    = calcExhaustion(bars, momentum, volume, trend, volatility);
    const pullback      = calcPullbackReversal(bars, trend, momentum, volume, exhaustion);
    const overlays      = calcPatternOverlaysMultiTF(bars, []);
    const recentCandles = calcRecentCandleStructure(bars);

    const vol = readVolumeEffort(bars);
    const annotate = <T extends { direction?: string }>(p: T) => {
      const bearish = p.direction === "short" || p.direction === "bearish" || p.direction === "bear";
      return {
        ...p,
        volumeConfirms:    (vol.signal === "no_demand" && bearish) || (vol.signal === "demand_confirmed" && !bearish),
        volumeContradicts: (vol.signal === "no_demand" && !bearish) || (vol.signal === "demand_confirmed" && bearish),
      };
    };

    const count = forming.length + patternRes.patterns.length + signals.length + overlays.length
      + (exhaustion?.exhaustionSignal && exhaustion.exhaustionSignal !== "none" ? 1 : 0);

    res.json({
      ticker, interval, period, count,
      forming:       forming.map(annotate),
      patterns:      patternRes.patterns,                 // structural pattern names
      marketStructure: patternRes.marketStructure,
      supportLevel:  patternRes.supportLevel,
      resistanceLevel: patternRes.resistanceLevel,
      signals:       signals.map(annotate),               // candlestick signal pins
      exhaustion,                                          // distribution/capitulation/reversal/parabolic
      pullback,                                            // pullback-reversal setup
      overlays:      overlays.map(annotate),               // multi-TF pattern overlays
      recentCandles,
      volume: vol,
    });
  } catch (err) {
    req.log.warn({ err, ticker }, "Intraday patterns failed");
    res.status(404).json({ error: `No intraday data for ${ticker}` });
  }
});

// ── AI Narrative (cached 5 min; requires ENABLE_AI_NARRATIVE=true) ────────────
router.get("/stock/:ticker/narrative", async (req, res): Promise<void> => {
  const ticker = (req.params.ticker as string).toUpperCase();
  try {
    const analysis = await runFullAnalysis(ticker);
    const calEntry  = calibrationStore.getFitted(ticker, 10);

    const narrative = await generateNarrative({
      ticker,
      score:              analysis.atlasScore.overall,
      direction:          analysis.atlasScore.direction,
      timeHorizon:        analysis.atlasScore.timeHorizon,
      bullishProbability: analysis.atlasScore.bullishProbability ?? 50,
      rsi14:              analysis.momentum.rsi ?? 50,
      macdSignal:         analysis.momentum.macdCrossover ?? "neutral",
      priceAboveSma20:    (analysis.trend.priceVsSma20  ?? 0) > 0,
      priceAboveSma50:    (analysis.trend.priceVsSma50  ?? 0) > 0,
      priceAboveSma200:   (analysis.trend.priceVsSma200 ?? 0) > 0,
      relativeVolume:     analysis.volume.relativeVolume ?? 1,
      vwapDistancePct:    analysis.volume.vwap > 0
                            ? ((analysis.quote as { price: number }).price - analysis.volume.vwap) / analysis.volume.vwap * 100
                            : 0,
      atr14Pct:           analysis.volatility.atrPercent ?? 2,
      bbWidth:            analysis.volatility.bollingerWidth ?? 15,
      rankIC:             calEntry?.rankIC ?? undefined,
    });

    if (!narrative) {
      res.status(503).json({ error: "AI narrative unavailable. Set ENABLE_AI_NARRATIVE=true and provision the OpenAI integration." });
      return;
    }
    res.json({ ticker, narrative });
  } catch (err) {
    req.log.warn({ err, ticker }, "Narrative generation failed");
    res.status(500).json({ error: "Narrative generation failed" });
  }
});

// ── Retracement Forecast ──────────────────────────────────────────────────────
router.get("/stock/:ticker/retracement", async (req, res): Promise<void> => {
  const ticker   = (req.params.ticker as string).toUpperCase();
  const interval = typeof req.query.interval === "string" ? req.query.interval : "1d";
  const allowed  = ["1h", "1d", "1wk"];
  if (!allowed.includes(interval)) {
    res.status(400).json({ error: `interval must be one of: ${allowed.join(", ")}` });
    return;
  }
  try {
    const forecast = await computeRetracementForecast(ticker, interval);
    req.log.info({ ticker, interval, movePct: forecast.currentMove.movePct }, "retracement: served");
    res.json(forecast);
  } catch (err) {
    req.log.warn({ err, ticker, interval }, "Retracement forecast failed");
    res.status(500).json({ error: "Retracement forecast failed" });
  }
});

export default router;

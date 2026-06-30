import { fetchQuote, fetchOHLCV, type OHLCVBar } from "./marketData.js";
import {
  calcTrend, calcMomentum, calcVolume, calcVolatility, calcOptions,
  calcPatterns, calcRelativeStrength, calcChartSignals, calcRegimeIndicators,
  calcExhaustion, calcFibLevels, calcVolumeProfile, calcWeeklyContext, calcMarketCycle,
  calcRecentCandleStructure,
  type TrendResult, type MomentumResult, type VolumeResult,
  type VolatilityResult, type OptionsResult, type PatternResult,
  type RelativeStrengthResult, type ChartSignal, type RegimeIndicators,
  type ExhaustionResult, type FibLevelsResult, type VolumeProfileResult,
  type WeeklyContextResult, type MarketCycleResult, type RecentCandleStructure,
} from "./indicators.js";
import { calcAtlasScore, type AtlasAlphaScore } from "./scoring.js";
import { calcPatternOverlaysMultiTF, type PatternOverlay } from "./patternOverlays.js";
import { detectFormingPatterns, type FormingPattern } from "./formingPatterns.js";
import { calcPullbackReversal, type PullbackReversalResult } from "./pullbackReversal.js";
import { readVolumeEffort, annotateWithVolume, type VolumeEffortRead } from "./volumeEffort.js";
import { analysisCache } from "./cache.js";
import { getUniverse } from "./scannerUniverse.js";
import { calibrationStore } from "./calibrationStore.js";
import { predictionStore } from "./predictionStore.js";
import { runCalibrationBackground } from "./backtestEngine.js";
import { logger } from "./logger.js";

export interface AnalysisResult {
  quote: Record<string, unknown>;
  atlasScore: AtlasAlphaScore;
  trend: TrendResult;
  momentum: MomentumResult;
  volume: VolumeResult;
  volatility: VolatilityResult;
  options: OptionsResult;
  patterns: PatternResult;
  relativeStrength: RelativeStrengthResult;
  regimeIndicators: RegimeIndicators;
  exhaustion: ExhaustionResult;
  chartSignals: ChartSignal[];
  patternOverlays: PatternOverlay[];
  formingPatterns: FormingPattern[];
  fibLevels: FibLevelsResult | null;
  volumeProfile: VolumeProfileResult | null;
  weeklyContext: WeeklyContextResult | null;
  marketCycle: MarketCycleResult | null;
  pullbackSetup: PullbackReversalResult | null;
  recentCandles: RecentCandleStructure | null;
  /** Effort-vs-result volume read; forming patterns below are tagged confirmed/
   *  contradicted by it (parity with the intraday-patterns endpoint). */
  volumeEffort: VolumeEffortRead;
  historicalDate?: string;
  cachedAt: string;
}

function buildResult(
  sym: string,
  price: number,
  bars: OHLCVBar[],
  spyBars: OHLCVBar[],
  qqqBars: OHLCVBar[],
  iwmBars: OHLCVBar[],
  quoteOverride: Record<string, unknown>,
  historicalDate?: string,
  /** Skip display-only signals (chart pins, structural patterns) — for scanner/warmup paths */
  lightMode = false,
  weeklyBars: OHLCVBar[] = [],
): AnalysisResult {
  const trend          = calcTrend(bars, price);
  const momentum       = calcMomentum(bars);
  const volume         = calcVolume(bars, (quoteOverride.avgVolume as number) ?? 0);
  const volatility     = calcVolatility(bars, price);
  const options        = calcOptions(momentum, volume, volatility, price, bars);
  const rs             = calcRelativeStrength(sym, bars, spyBars, qqqBars, iwmBars, (quoteOverride.sector as string | null) ?? null);
  const spyTrend       = calcTrend(spyBars, spyBars[spyBars.length - 1]?.close ?? 500);
  const regimeIndicators = calcRegimeIndicators(spyBars, spyTrend);
  const exhaustion     = calcExhaustion(bars, momentum, volume, trend, volatility);
  const calEntry       = calibrationStore.getFitted(sym, 10);
  const mlScore        = predictionStore.getMlScore(sym);   // V4 model rank (all 47 features), or null
  const atlasScore     = calcAtlasScore(
    trend, momentum, volume, options, rs,
    regimeIndicators.regimeScore, volatility.expectedMovePercent, exhaustion,
    { weights: calEntry?.optimalWeights ?? null, rankIC: calEntry?.rankIC, icRating: calEntry?.icRating, mlScore }
  );

  // calcPatterns runs on already-fetched daily bars (fast, ~0.1ms per ticker);
  // always computed so pattern labels surface in scanner rows.
  // calcChartSignals / patternOverlays remain skipped in light-mode (expensive).
  const patterns     = calcPatterns(bars, trend, volatility);
  const chartSignals = lightMode ? [] : calcChartSignals(bars);
  const patternOverlays  = lightMode ? [] : calcPatternOverlaysMultiTF(bars, weeklyBars);
  // Effort-vs-result volume read; forming patterns are tagged confirmed/contradicted
  // by it (same as the intraday-patterns endpoint, so both timeframes match).
  const volumeEffort     = readVolumeEffort(bars);
  // Forming (not-yet-broken-out) patterns on the right edge, projected to fulfilment.
  const formingPatterns  = lightMode ? [] : detectFormingPatterns(bars).map(p => annotateWithVolume(p, volumeEffort));

  // TA overlays — always computed (fast, ≤1ms each); omitted from scanner light-mode paths
  const fibLevels     = lightMode ? null : calcFibLevels(bars);
  const volumeProfile = lightMode ? null : calcVolumeProfile(bars);
  const weeklyContext = lightMode ? null : calcWeeklyContext(weeklyBars);
  const marketCycle   = lightMode ? null : calcMarketCycle(weeklyBars);
  const pullbackSetup  = calcPullbackReversal(bars, trend, momentum, volume, exhaustion);
  const recentCandles  = calcRecentCandleStructure(bars);

  return {
    quote: quoteOverride,
    atlasScore,
    trend,
    momentum,
    volume,
    volatility,
    options,
    patterns,
    relativeStrength: rs,
    regimeIndicators,
    exhaustion,
    chartSignals,
    patternOverlays,
    formingPatterns,
    fibLevels,
    volumeProfile,
    weeklyContext,
    marketCycle,
    pullbackSetup,
    recentCandles,
    volumeEffort,
    ...(historicalDate ? { historicalDate } : {}),
    cachedAt: new Date().toISOString(),
  };
}

/** Trigger a background calibration for `ticker` if not already tracked.
 *  Fire-and-forget — never awaited by the caller. */
function maybeCalibrate(sym: string): void {
  const marked = calibrationStore.markPending(sym, 10);
  if (!marked) return; // already fitted, pending, or concurrency limit hit
  setImmediate(() => {
    runCalibrationBackground(sym).catch(() => {
      // markError already handled inside runCalibrationBackground
    });
  });
}

/**
 * Run a full analysis for a ticker.
 *
 * @param lightMode  When true (used by scanner/warmup passes) skips the two
 *                   display-only computations — `calcChartSignals` (35 pattern
 *                   detectors × 90 bars) and `calcPatterns` (12 structural
 *                   patterns).  Results are stored under a separate
 *                   `scan:${sym}` cache key so dashboard requests always get
 *                   the fully-annotated result.
 */
export async function runFullAnalysis(ticker: string, lightMode = false): Promise<AnalysisResult> {
  const sym      = ticker.toUpperCase();
  // Light-mode results go to a separate namespace so they never evict a full result.
  const cacheKey = lightMode ? `scan:${sym}` : `analysis:${sym}`;
  const cached   = analysisCache.get<AnalysisResult>(cacheKey);
  if (cached) {
    maybeCalibrate(sym);
    return cached;
  }

  const [quote, bars, spyBars, qqqBars, iwmBars, weeklyBars] = await Promise.all([
    fetchQuote(sym),
    fetchOHLCV(sym, "1y", "1d"),
    fetchOHLCV("SPY", "1y", "1d"),
    fetchOHLCV("QQQ", "1y", "1d"),
    fetchOHLCV("IWM", "1y", "1d"),
    lightMode ? Promise.resolve([]) : fetchOHLCV(sym, "2y", "1wk"),
  ]);

  if (bars.length < 30) throw new Error(`Insufficient historical data for ${sym}`);

  const result = buildResult(sym, quote.price, bars, spyBars, qqqBars, iwmBars, quote as unknown as Record<string, unknown>, undefined, lightMode, weeklyBars);

  analysisCache.set(cacheKey, result);
  logger.info({ ticker: sym, atlasScore: result.atlasScore.overall }, "Analysis complete");

  maybeCalibrate(sym);
  return result;
}

export async function runHistoricalAnalysis(ticker: string, asOf: string): Promise<AnalysisResult> {
  const sym      = ticker.toUpperCase();
  const cacheKey = `historical:${sym}:${asOf}`;
  const cached   = analysisCache.get<AnalysisResult>(cacheKey);
  if (cached) return cached;

  const [allBars, allSpyBars, allQqqBars, allIwmBars] = await Promise.all([
    fetchOHLCV(sym, "2y", "1d"),
    fetchOHLCV("SPY", "2y", "1d"),
    fetchOHLCV("QQQ", "2y", "1d"),
    fetchOHLCV("IWM", "2y", "1d"),
  ]);

  const bars    = allBars.filter(b    => b.time <= asOf);
  const spyBars = allSpyBars.filter(b => b.time <= asOf);
  const qqqBars = allQqqBars.filter(b => b.time <= asOf);
  const iwmBars = allIwmBars.filter(b => b.time <= asOf);

  if (bars.length < 30) throw new Error(`Insufficient data for ${sym} as of ${asOf}`);

  const lastBar = bars[bars.length - 1];
  const prevBar = bars[bars.length - 2];
  const price   = lastBar.close;
  const change  = prevBar ? price - prevBar.close : 0;
  const changePercent = prevBar && prevBar.close > 0 ? (change / prevBar.close) * 100 : 0;
  const recentBars    = bars.slice(-30);
  const avgVolume     = recentBars.reduce((s, b) => s + b.volume, 0) / recentBars.length;
  const historicalBars252 = bars.slice(-252);

  const syntheticQuote = {
    ticker: sym, name: sym, price,
    change, changePercent,
    open: lastBar.open, high: lastBar.high, low: lastBar.low,
    previousClose: prevBar?.close ?? price,
    volume: lastBar.volume, avgVolume,
    marketCap: null,
    week52High: Math.max(...historicalBars252.map(b => b.high)),
    week52Low:  Math.min(...historicalBars252.map(b => b.low)),
    beta: null, pe: null, eps: null, sector: null, industry: null,
    timestamp: new Date(asOf).toISOString(),
  };

  const result = buildResult(sym, price, bars, spyBars, qqqBars, iwmBars, syntheticQuote as unknown as Record<string, unknown>, asOf);

  analysisCache.set(cacheKey, result);
  logger.info({ ticker: sym, asOf, atlasScore: result.atlasScore.overall }, "Historical analysis complete");
  return result;
}

/** Compute breadth from currently cached analyses across the scanner universe.
 *  Returns null percentages if fewer than 20 tickers are cached (scanner hasn't run yet). */
export function getCachedBreadth(): { total: number; pctAboveSma50: number | null; pctAboveSma200: number | null } {
  let aboveSma50 = 0, aboveSma200 = 0, total = 0;

  for (const ticker of getUniverse()) {
    // Check full-mode cache first; fall back to scanner light-mode cache
    const cached = analysisCache.get<AnalysisResult>(`analysis:${ticker}`)
                ?? analysisCache.get<AnalysisResult>(`scan:${ticker}`);
    if (!cached) continue;
    total++;
    const price = cached.quote.price as number;
    if (cached.trend.sma50  > 0 && price > cached.trend.sma50)  aboveSma50++;
    if (cached.trend.sma200 > 0 && price > cached.trend.sma200) aboveSma200++;
  }

  return {
    total,
    pctAboveSma50:  total >= 20 ? Math.round(aboveSma50  / total * 100) : null,
    pctAboveSma200: total >= 20 ? Math.round(aboveSma200 / total * 100) : null,
  };
}

import { fetchQuote, fetchOHLCV, type OHLCVBar } from "./marketData.js";
import {
  calcTrend, calcMomentum, calcVolume, calcVolatility, calcOptions,
  calcPatterns, calcRelativeStrength, calcChartSignals, calcRegimeIndicators,
  type TrendResult, type MomentumResult, type VolumeResult,
  type VolatilityResult, type OptionsResult, type PatternResult,
  type RelativeStrengthResult, type ChartSignal, type RegimeIndicators,
} from "./indicators.js";
import { calcAtlasScore, type AtlasAlphaScore } from "./scoring.js";
import { analysisCache } from "./cache.js";
import { SCANNER_UNIVERSE } from "./scannerUniverse.js";
import { calibrationStore } from "./calibrationStore.js";
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
  chartSignals: ChartSignal[];
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
  historicalDate?: string
): AnalysisResult {
  const trend          = calcTrend(bars, price);
  const momentum       = calcMomentum(bars);
  const volume         = calcVolume(bars, (quoteOverride.avgVolume as number) ?? 0);
  const volatility     = calcVolatility(bars, price);
  const options        = calcOptions(momentum, volume, volatility, price);
  const patterns       = calcPatterns(bars, trend, volatility);
  const rs             = calcRelativeStrength(sym, bars, spyBars, qqqBars, iwmBars, (quoteOverride.sector as string | null) ?? null);
  const spyTrend       = calcTrend(spyBars, spyBars[spyBars.length - 1]?.close ?? 500);
  const regimeIndicators = calcRegimeIndicators(spyBars, spyTrend);
  const atlasScore     = calcAtlasScore(trend, momentum, volume, options, rs, regimeIndicators.regimeScore, volatility.expectedMovePercent);
  const chartSignals   = calcChartSignals(bars);

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
    chartSignals,
    ...(historicalDate ? { historicalDate } : {}),
    cachedAt: new Date().toISOString(),
  };
}

/** Trigger a background calibration for `ticker` if not already tracked.
 *  Fire-and-forget — never awaited by the caller. */
function maybeCalibrate(sym: string): void {
  const marked = calibrationStore.markPending(sym);
  if (!marked) return; // already fitted, pending, or concurrency limit hit
  setImmediate(() => {
    runCalibrationBackground(sym).catch(() => {
      // markError already handled inside runCalibrationBackground
    });
  });
}

export async function runFullAnalysis(ticker: string): Promise<AnalysisResult> {
  const sym      = ticker.toUpperCase();
  const cacheKey = `analysis:${sym}`;
  const cached   = analysisCache.get<AnalysisResult>(cacheKey);
  if (cached) {
    // Always trigger calibration even for cached analyses (markPending is a no-op if already tracked)
    maybeCalibrate(sym);
    return cached;
  }

  const [quote, bars, spyBars, qqqBars, iwmBars] = await Promise.all([
    fetchQuote(sym),
    fetchOHLCV(sym, "1y", "1d"),
    fetchOHLCV("SPY", "1y", "1d"),
    fetchOHLCV("QQQ", "1y", "1d"),
    fetchOHLCV("IWM", "1y", "1d"),
  ]);

  if (bars.length < 30) throw new Error(`Insufficient historical data for ${sym}`);

  const result = buildResult(sym, quote.price, bars, spyBars, qqqBars, iwmBars, quote as unknown as Record<string, unknown>);

  analysisCache.set(cacheKey, result);
  logger.info({ ticker: sym, atlasScore: result.atlasScore.overall }, "Analysis complete");

  // Kick off background calibration (non-blocking)
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

  for (const ticker of SCANNER_UNIVERSE) {
    const cached = analysisCache.get<AnalysisResult>(`analysis:${ticker}`);
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

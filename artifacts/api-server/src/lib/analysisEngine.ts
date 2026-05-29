import { fetchQuote, fetchOHLCV, type OHLCVBar } from "./marketData.js";
import { calcTrend, calcMomentum, calcVolume, calcVolatility, calcOptions, calcPatterns, calcRelativeStrength, calcChartSignals } from "./indicators.js";
import { calcAtlasScore } from "./scoring.js";
import { analysisCache } from "./cache.js";
import { logger } from "./logger.js";

function buildResult(
  sym: string,
  price: number,
  bars: OHLCVBar[],
  spyBars: OHLCVBar[],
  qqqBars: OHLCVBar[],
  iwmBars: OHLCVBar[],
  quoteOverride: Record<string, unknown>,
  historicalDate?: string
) {
  const trend = calcTrend(bars, price);
  const momentum = calcMomentum(bars);
  const volume = calcVolume(bars, (quoteOverride.avgVolume as number) ?? 0);
  const volatility = calcVolatility(bars, price);
  const options = calcOptions(momentum, volume, volatility, price);
  const patterns = calcPatterns(bars, trend, volatility);
  const rs = calcRelativeStrength(sym, bars.slice(-60), spyBars, qqqBars, iwmBars, (quoteOverride.sector as string | null) ?? null);
  const spyTrend = calcTrend(spyBars, spyBars[spyBars.length - 1]?.close ?? 500);
  const marketRegimeScore = spyTrend.trendAlignmentScore;
  const atlasScore = calcAtlasScore(trend, momentum, volume, options, rs, marketRegimeScore, volatility.expectedMovePercent);
  const chartSignals = calcChartSignals(bars);

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
    chartSignals,
    ...(historicalDate ? { historicalDate } : {}),
    cachedAt: new Date().toISOString(),
  };
}

export async function runFullAnalysis(ticker: string) {
  const cacheKey = `analysis:${ticker.toUpperCase()}`;
  const cached = analysisCache.get(cacheKey);
  if (cached) return cached;

  const sym = ticker.toUpperCase();

  const [quote, bars, spyBars, qqqBars, iwmBars] = await Promise.all([
    fetchQuote(sym),
    fetchOHLCV(sym, "1y", "1d"),
    fetchOHLCV("SPY", "3mo", "1d"),
    fetchOHLCV("QQQ", "3mo", "1d"),
    fetchOHLCV("IWM", "3mo", "1d"),
  ]);

  if (bars.length < 30) throw new Error(`Insufficient historical data for ${sym}`);

  const result = buildResult(sym, quote.price, bars, spyBars, qqqBars, iwmBars, quote as unknown as Record<string, unknown>);

  analysisCache.set(cacheKey, result);
  logger.info({ ticker: sym, atlasScore: result.atlasScore.overall }, "Analysis complete");
  return result;
}

export async function runHistoricalAnalysis(ticker: string, asOf: string) {
  const cacheKey = `historical:${ticker.toUpperCase()}:${asOf}`;
  const cached = analysisCache.get(cacheKey);
  if (cached) return cached;

  const sym = ticker.toUpperCase();

  // Fetch 2 years so we have enough bars for SMA200, even when sliced to a past date
  const [allBars, allSpyBars, allQqqBars, allIwmBars] = await Promise.all([
    fetchOHLCV(sym, "2y", "1d"),
    fetchOHLCV("SPY", "2y", "1d"),
    fetchOHLCV("QQQ", "2y", "1d"),
    fetchOHLCV("IWM", "2y", "1d"),
  ]);

  // Slice each series to only data on or before asOf (point-in-time)
  const bars = allBars.filter(b => b.time <= asOf);
  const spyBars = allSpyBars.filter(b => b.time <= asOf);
  const qqqBars = allQqqBars.filter(b => b.time <= asOf);
  const iwmBars = allIwmBars.filter(b => b.time <= asOf);

  if (bars.length < 30) throw new Error(`Insufficient data for ${sym} as of ${asOf}`);

  const lastBar = bars[bars.length - 1];
  const prevBar = bars[bars.length - 2];
  const price = lastBar.close;
  const change = prevBar ? price - prevBar.close : 0;
  const changePercent = prevBar && prevBar.close > 0 ? (change / prevBar.close) * 100 : 0;
  const recentBars = bars.slice(-30);
  const avgVolume = recentBars.reduce((s, b) => s + b.volume, 0) / recentBars.length;
  const historicalBars252 = bars.slice(-252);

  const syntheticQuote = {
    ticker: sym, name: sym, price,
    change, changePercent,
    open: lastBar.open, high: lastBar.high, low: lastBar.low,
    previousClose: prevBar?.close ?? price,
    volume: lastBar.volume, avgVolume,
    marketCap: null,
    week52High: Math.max(...historicalBars252.map(b => b.high)),
    week52Low: Math.min(...historicalBars252.map(b => b.low)),
    beta: null, pe: null, eps: null, sector: null, industry: null,
    timestamp: new Date(asOf).toISOString(),
  };

  const result = buildResult(sym, price, bars, spyBars, qqqBars, iwmBars, syntheticQuote as unknown as Record<string, unknown>, asOf);

  analysisCache.set(cacheKey, result);
  logger.info({ ticker: sym, asOf, atlasScore: result.atlasScore.overall }, "Historical analysis complete");
  return result;
}

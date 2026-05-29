import { fetchQuote, fetchOHLCV } from "./marketData.js";
import { calcTrend, calcMomentum, calcVolume, calcVolatility, calcOptions, calcPatterns, calcRelativeStrength } from "./indicators.js";
import { calcAtlasScore } from "./scoring.js";
import { analysisCache } from "./cache.js";
import { logger } from "./logger.js";

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

  if (bars.length < 30) {
    throw new Error(`Insufficient historical data for ${sym}`);
  }

  const price = quote.price;

  const trend = calcTrend(bars, price);
  const momentum = calcMomentum(bars);
  const volume = calcVolume(bars, quote.avgVolume);
  const volatility = calcVolatility(bars, price);
  const options = calcOptions(momentum, volume, volatility, price);
  const patterns = calcPatterns(bars, trend, volatility);
  const rs = calcRelativeStrength(sym, bars.slice(-60), spyBars, qqqBars, iwmBars, quote.sector);

  // Market regime score (based on SPY trend)
  const spyTrend = calcTrend(spyBars, spyBars[spyBars.length - 1]?.close ?? 500);
  const marketRegimeScore = spyTrend.trendAlignmentScore;

  const atlasScore = calcAtlasScore(
    trend,
    momentum,
    volume,
    options,
    rs,
    marketRegimeScore,
    volatility.expectedMovePercent
  );

  const result = {
    quote,
    atlasScore,
    trend,
    momentum,
    volume,
    volatility,
    options,
    patterns,
    relativeStrength: rs,
    cachedAt: new Date().toISOString(),
  };

  analysisCache.set(cacheKey, result);
  logger.info({ ticker: sym, atlasScore: atlasScore.overall }, "Analysis complete");
  return result;
}

import {
  RSI,
  MACD,
  BollingerBands,
  EMA,
  SMA,
  Stochastic,
  CCI,
  ROC,
  OBV,
  ATR,
} from "technicalindicators";
import type { OHLCVBar } from "./marketData.js";

export interface TrendResult {
  sma20: number;
  sma50: number;
  sma100: number;
  sma200: number;
  ema8: number;
  ema21: number;
  ema34: number;
  goldenCross: boolean;
  deathCross: boolean;
  priceVsSma20: number;
  priceVsSma50: number;
  priceVsSma200: number;
  trendAlignmentScore: number;
  trendDirection: "strong_up" | "up" | "neutral" | "down" | "strong_down";
}

export interface MomentumResult {
  rsi: number;
  rsiSignal: "overbought" | "neutral" | "oversold";
  rsiDivergence: "bullish" | "bearish" | null;
  macd: number;
  macdSignal: number;
  macdHistogram: number;
  macdCrossover: "bullish" | "bearish" | null;
  stochK: number;
  stochD: number;
  cci: number;
  roc: number;
  momentumScore: number;
}

export interface VolumeResult {
  obv: number;
  obvTrend: "rising" | "falling" | "flat";
  accumulationDistribution: number;
  chaikinMoneyFlow: number;
  vwap: number;
  relativeVolume: number;
  volumeSpike: boolean;
  volumeScore: number;
}

export interface VolatilityResult {
  atr: number;
  atrPercent: number;
  atrExpansion: boolean;
  bollingerUpper: number;
  bollingerMiddle: number;
  bollingerLower: number;
  bollingerWidth: number;
  keltnerUpper: number;
  keltnerLower: number;
  volatilitySqueeze: boolean;
  ivRank: number | null;
  ivPercentile: number | null;
  expectedMove: number;
  expectedMovePercent: number;
}

export interface OptionsResult {
  putCallRatio: number | null;
  maxPain: number | null;
  callWall: number | null;
  putWall: number | null;
  gammaFlipLevel: number | null;
  unusualActivity: boolean;
  optionsScore: number;
}

export interface PatternResult {
  patterns: string[];
  marketStructure: "uptrend" | "downtrend" | "ranging";
  supportLevel: number | null;
  resistanceLevel: number | null;
}

export interface RelativeStrengthResult {
  vsSpy: number;
  vsQqq: number;
  vsIwm: number;
  vsSector: number;
  rsScore: number;
  sectorName: string | null;
}

function last<T>(arr: T[]): T {
  return arr[arr.length - 1];
}

function avg(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function clamp(val: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, val));
}

export function calcTrend(bars: OHLCVBar[], price: number): TrendResult {
  const closes = bars.map(b => b.close);

  const sma20Arr = SMA.calculate({ values: closes, period: 20 });
  const sma50Arr = SMA.calculate({ values: closes, period: 50 });
  const sma100Arr = SMA.calculate({ values: closes, period: 100 });
  const sma200Arr = SMA.calculate({ values: closes, period: 200 });
  const ema8Arr = EMA.calculate({ values: closes, period: 8 });
  const ema21Arr = EMA.calculate({ values: closes, period: 21 });
  const ema34Arr = EMA.calculate({ values: closes, period: 34 });

  const sma20 = last(sma20Arr) ?? price;
  const sma50 = last(sma50Arr) ?? price;
  const sma100 = last(sma100Arr) ?? price;
  const sma200 = last(sma200Arr) ?? price;
  const ema8 = last(ema8Arr) ?? price;
  const ema21 = last(ema21Arr) ?? price;
  const ema34 = last(ema34Arr) ?? price;

  const prevSma50 = sma50Arr[sma50Arr.length - 2] ?? sma50;
  const prevSma200 = sma200Arr[sma200Arr.length - 2] ?? sma200;
  const goldenCross = prevSma50 < prevSma200 && sma50 >= sma200;
  const deathCross = prevSma50 > prevSma200 && sma50 <= sma200;

  const priceVsSma20 = ((price - sma20) / sma20) * 100;
  const priceVsSma50 = ((price - sma50) / sma50) * 100;
  const priceVsSma200 = ((price - sma200) / sma200) * 100;

  // Alignment score: how many key levels is price above?
  let aboveCount = 0;
  if (price > sma20) aboveCount++;
  if (price > sma50) aboveCount++;
  if (price > sma100) aboveCount++;
  if (price > sma200) aboveCount++;
  if (price > ema8) aboveCount++;
  if (price > ema21) aboveCount++;
  if (price > ema34) aboveCount++;

  const trendAlignmentScore = clamp((aboveCount / 7) * 100);

  let trendDirection: TrendResult["trendDirection"] = "neutral";
  if (trendAlignmentScore >= 80 && priceVsSma200 > 5) trendDirection = "strong_up";
  else if (trendAlignmentScore >= 55) trendDirection = "up";
  else if (trendAlignmentScore <= 20 && priceVsSma200 < -5) trendDirection = "strong_down";
  else if (trendAlignmentScore <= 45) trendDirection = "down";

  return {
    sma20, sma50, sma100, sma200, ema8, ema21, ema34,
    goldenCross, deathCross,
    priceVsSma20, priceVsSma50, priceVsSma200,
    trendAlignmentScore,
    trendDirection,
  };
}

export function calcMomentum(bars: OHLCVBar[]): MomentumResult {
  const closes = bars.map(b => b.close);
  const highs = bars.map(b => b.high);
  const lows = bars.map(b => b.low);

  const rsiArr = RSI.calculate({ values: closes, period: 14 });
  const rsi = last(rsiArr) ?? 50;

  const macdArr = MACD.calculate({
    values: closes,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });
  const macdVal = last(macdArr);
  const macd = macdVal?.MACD ?? 0;
  const macdSignal = macdVal?.signal ?? 0;
  const macdHistogram = macdVal?.histogram ?? 0;
  const prevMacd = macdArr[macdArr.length - 2];
  let macdCrossover: MomentumResult["macdCrossover"] = null;
  if (prevMacd && macdVal) {
    if ((prevMacd.MACD ?? 0) < (prevMacd.signal ?? 0) && macd > macdSignal) macdCrossover = "bullish";
    if ((prevMacd.MACD ?? 0) > (prevMacd.signal ?? 0) && macd < macdSignal) macdCrossover = "bearish";
  }

  const stochArr = Stochastic.calculate({ high: highs, low: lows, close: closes, period: 14, signalPeriod: 3 });
  const stochVal = last(stochArr);
  const stochK = stochVal?.k ?? 50;
  const stochD = stochVal?.d ?? 50;

  const cciArr = CCI.calculate({ high: highs, low: lows, close: closes, period: 20 });
  const cci = last(cciArr) ?? 0;

  const rocArr = ROC.calculate({ values: closes, period: 12 });
  const roc = last(rocArr) ?? 0;

  // RSI divergence: check if price making new highs/lows but RSI not confirming
  let rsiDivergence: MomentumResult["rsiDivergence"] = null;
  if (bars.length >= 20) {
    const recentPrices = closes.slice(-10);
    const recentRsi = rsiArr.slice(-10);
    const priceDown = last(recentPrices) < recentPrices[0];
    const rsiUp = last(recentRsi) > recentRsi[0];
    const priceUp = last(recentPrices) > recentPrices[0];
    const rsiDown = last(recentRsi) < recentRsi[0];
    if (priceDown && rsiUp && rsi < 45) rsiDivergence = "bullish";
    if (priceUp && rsiDown && rsi > 55) rsiDivergence = "bearish";
  }

  let rsiSignal: MomentumResult["rsiSignal"] = "neutral";
  if (rsi > 70) rsiSignal = "overbought";
  else if (rsi < 30) rsiSignal = "oversold";

  // Momentum score: composite of RSI, MACD, Stoch, CCI, ROC
  let score = 50;
  score += (rsi - 50) * 0.5;
  score += macd > macdSignal ? 8 : -8;
  score += stochK > stochD ? 5 : -5;
  score += cci > 0 ? clamp(cci / 10, 0, 10) : -clamp(-cci / 10, 0, 10);
  score += roc > 0 ? Math.min(roc, 10) : Math.max(roc, -10);
  if (macdCrossover === "bullish") score += 5;
  if (macdCrossover === "bearish") score -= 5;
  if (rsiDivergence === "bullish") score += 5;
  if (rsiDivergence === "bearish") score -= 5;

  return {
    rsi,
    rsiSignal,
    rsiDivergence,
    macd,
    macdSignal,
    macdHistogram,
    macdCrossover,
    stochK,
    stochD,
    cci,
    roc,
    momentumScore: clamp(score),
  };
}

export function calcVolume(bars: OHLCVBar[], avgVolume: number): VolumeResult {
  const closes = bars.map(b => b.close);
  const volumes = bars.map(b => b.volume);
  const highs = bars.map(b => b.high);
  const lows = bars.map(b => b.low);

  const obvArr = OBV.calculate({ close: closes, volume: volumes });
  const obv = last(obvArr) ?? 0;
  const obvPrev = obvArr[obvArr.length - 10] ?? obv;
  const obvTrend: VolumeResult["obvTrend"] = obv > obvPrev * 1.02 ? "rising" : obv < obvPrev * 0.98 ? "falling" : "flat";

  // Accumulation/Distribution Line
  let adLine = 0;
  const adArr: number[] = [];
  for (const bar of bars) {
    const clv = bar.high === bar.low ? 0 : ((bar.close - bar.low) - (bar.high - bar.close)) / (bar.high - bar.low);
    adLine += clv * bar.volume;
    adArr.push(adLine);
  }
  const accumulationDistribution = last(adArr) ?? 0;

  // Chaikin Money Flow (20-period)
  const period = 20;
  const recentBars = bars.slice(-period);
  let sumMFV = 0;
  let sumVol = 0;
  for (const bar of recentBars) {
    const clv = bar.high === bar.low ? 0 : ((bar.close - bar.low) - (bar.high - bar.close)) / (bar.high - bar.low);
    sumMFV += clv * bar.volume;
    sumVol += bar.volume;
  }
  const chaikinMoneyFlow = sumVol > 0 ? sumMFV / sumVol : 0;

  // VWAP (last 20 bars)
  let totalPV = 0;
  let totalVol = 0;
  for (const bar of recentBars) {
    const typicalPrice = (bar.high + bar.low + bar.close) / 3;
    totalPV += typicalPrice * bar.volume;
    totalVol += bar.volume;
  }
  const vwap = totalVol > 0 ? totalPV / totalVol : closes[closes.length - 1];

  const currentVol = volumes[volumes.length - 1] ?? 0;
  const relativeVolume = avgVolume > 0 ? currentVol / avgVolume : 1;
  const volumeSpike = relativeVolume > 1.5;

  let score = 50;
  score += obvTrend === "rising" ? 15 : obvTrend === "falling" ? -15 : 0;
  score += chaikinMoneyFlow * 30;
  score += relativeVolume > 2 ? 15 : relativeVolume > 1.5 ? 8 : relativeVolume < 0.5 ? -10 : 0;

  return {
    obv,
    obvTrend,
    accumulationDistribution,
    chaikinMoneyFlow,
    vwap,
    relativeVolume,
    volumeSpike,
    volumeScore: clamp(score),
  };
}

export function calcVolatility(bars: OHLCVBar[], price: number): VolatilityResult {
  const closes = bars.map(b => b.close);
  const highs = bars.map(b => b.high);
  const lows = bars.map(b => b.low);

  const atrArr = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });
  const atr = last(atrArr) ?? price * 0.02;
  const atrPercent = (atr / price) * 100;

  const prevAtr = atrArr[atrArr.length - 5] ?? atr;
  const atrExpansion = atr > prevAtr * 1.1;

  const bbArr = BollingerBands.calculate({ values: closes, period: 20, stdDev: 2 });
  const bb = last(bbArr);
  const bollingerUpper = bb?.upper ?? price * 1.02;
  const bollingerMiddle = bb?.middle ?? price;
  const bollingerLower = bb?.lower ?? price * 0.98;
  const bollingerWidth = bollingerUpper - bollingerLower;

  // Keltner Channels (EMA20 ± 2*ATR)
  const ema20Arr = EMA.calculate({ values: closes, period: 20 });
  const ema20 = last(ema20Arr) ?? price;
  const keltnerUpper = ema20 + 2 * atr;
  const keltnerLower = ema20 - 2 * atr;

  // Volatility squeeze: BB inside Keltner
  const volatilitySqueeze = bollingerUpper < keltnerUpper && bollingerLower > keltnerLower;

  // Expected move: 1 standard deviation over 30 days using historical vol
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    returns.push(Math.log(closes[i] / closes[i - 1]));
  }
  const sigma = returns.length > 0
    ? Math.sqrt(avg(returns.map(r => r * r)) - Math.pow(avg(returns), 2)) * Math.sqrt(252)
    : 0.2;
  const expectedMovePercent = sigma * Math.sqrt(30 / 252) * 100;
  const expectedMove = price * expectedMovePercent / 100;

  return {
    atr,
    atrPercent,
    atrExpansion,
    bollingerUpper,
    bollingerMiddle,
    bollingerLower,
    bollingerWidth,
    keltnerUpper,
    keltnerLower,
    volatilitySqueeze,
    ivRank: null,
    ivPercentile: null,
    expectedMove,
    expectedMovePercent,
  };
}

export function calcOptions(momentum: MomentumResult, volume: VolumeResult, volatility: VolatilityResult, price: number): OptionsResult {
  // Derive proxy options metrics from price/volume/momentum data
  // In production these would come from options chain data
  const unusualActivity = volume.relativeVolume > 2.5 && Math.abs(momentum.rsi - 50) > 15;

  let optionsScore = 50;
  optionsScore += momentum.rsiSignal === "oversold" ? 15 : momentum.rsiSignal === "overbought" ? -10 : 0;
  optionsScore += volume.chaikinMoneyFlow > 0.1 ? 15 : volume.chaikinMoneyFlow < -0.1 ? -15 : 0;
  optionsScore += volatility.volatilitySqueeze ? 10 : 0;
  optionsScore += unusualActivity ? 8 : 0;

  // Proxy levels based on Bollinger/Keltner
  const callWall = volatility.bollingerUpper;
  const putWall = volatility.bollingerLower;
  const gammaFlipLevel = volatility.bollingerMiddle;

  return {
    putCallRatio: null,
    maxPain: null,
    callWall,
    putWall,
    gammaFlipLevel,
    unusualActivity,
    optionsScore: clamp(optionsScore),
  };
}

export function calcPatterns(bars: OHLCVBar[], trend: TrendResult, volatility: VolatilityResult): PatternResult {
  const closes = bars.map(b => b.close);
  const highs = bars.map(b => b.high);
  const lows = bars.map(b => b.low);
  const patterns: string[] = [];

  // Market structure
  const recentCloses = closes.slice(-20);
  const recentHighs = highs.slice(-20);
  const recentLows = lows.slice(-20);

  const higherHighs = recentHighs[recentHighs.length - 1] > recentHighs[0];
  const higherLows = recentLows[recentLows.length - 1] > recentLows[0];
  const lowerHighs = recentHighs[recentHighs.length - 1] < recentHighs[0];
  const lowerLows = recentLows[recentLows.length - 1] < recentLows[0];

  let marketStructure: PatternResult["marketStructure"] = "ranging";
  if (higherHighs && higherLows) marketStructure = "uptrend";
  else if (lowerHighs && lowerLows) marketStructure = "downtrend";

  // Golden/Death Cross patterns
  if (trend.goldenCross) patterns.push("Golden Cross");
  if (trend.deathCross) patterns.push("Death Cross");

  // Volatility squeeze
  if (volatility.volatilitySqueeze) patterns.push("Volatility Squeeze");

  // Bollinger Band patterns
  const price = closes[closes.length - 1];
  if (price > volatility.bollingerUpper) patterns.push("Bollinger Band Breakout");
  if (price < volatility.bollingerLower) patterns.push("Bollinger Band Breakdown");

  // Simple pattern detection
  const last5High = Math.max(...recentHighs.slice(-5));
  const last5Low = Math.min(...recentLows.slice(-5));
  const prior5High = Math.max(...recentHighs.slice(-10, -5));
  const prior5Low = Math.min(...recentLows.slice(-10, -5));

  if (Math.abs(last5High - prior5High) / prior5High < 0.01 && last5Low > prior5Low) {
    patterns.push("Ascending Triangle");
  }
  if (Math.abs(last5Low - prior5Low) / prior5Low < 0.01 && last5High < prior5High) {
    patterns.push("Descending Triangle");
  }

  // Bull/Bear flag detection
  if (marketStructure === "uptrend" && trend.trendAlignmentScore > 65) {
    const recentConsolidation = Math.max(...recentHighs.slice(-5)) - Math.min(...recentLows.slice(-5));
    const priorRange = Math.max(...recentHighs.slice(-20, -10)) - Math.min(...recentLows.slice(-20, -10));
    if (recentConsolidation < priorRange * 0.4) patterns.push("Bull Flag");
  }
  if (marketStructure === "downtrend" && trend.trendAlignmentScore < 35) {
    patterns.push("Bear Flag");
  }

  // Support/Resistance (recent swing high/low)
  const supportLevel = Math.min(...lows.slice(-20));
  const resistanceLevel = Math.max(...highs.slice(-20));

  return {
    patterns: patterns.slice(0, 5),
    marketStructure,
    supportLevel,
    resistanceLevel,
  };
}

export function calcRelativeStrength(
  ticker: string,
  tickerBars: OHLCVBar[],
  spyBars: OHLCVBar[],
  qqqBars: OHLCVBar[],
  iwmBars: OHLCVBar[],
  sectorName: string | null
): RelativeStrengthResult {
  const perfPct = (bars: OHLCVBar[]) => {
    if (bars.length < 2) return 0;
    const first = bars[0].close;
    const last = bars[bars.length - 1].close;
    return ((last - first) / first) * 100;
  };

  const tickerPerf = perfPct(tickerBars);
  const spyPerf = perfPct(spyBars);
  const qqqPerf = perfPct(qqqBars);
  const iwmPerf = perfPct(iwmBars);

  const vsSpy = tickerPerf - spyPerf;
  const vsQqq = tickerPerf - qqqPerf;
  const vsIwm = tickerPerf - iwmPerf;
  const vsSector = vsSpy * 0.5; // proxy when sector ETF not available

  const rsScore = clamp(50 + vsSpy * 2);

  return {
    vsSpy,
    vsQqq,
    vsIwm,
    vsSector,
    rsScore,
    sectorName,
  };
}

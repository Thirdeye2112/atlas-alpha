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
  ADX,
  // ── Single-bar candlestick patterns ──────────────────────────────────────
  doji,
  dragonflydoji,
  gravestonedoji,
  bullishhammerstick,
  bearishhammerstick,
  hangingman,
  shootingstar,
  bullishinvertedhammerstick,
  bearishinvertedhammerstick,
  bullishmarubozu,
  bearishmarubozu,
  bullishspinningtop,
  bearishspinningtop,
  // ── Two-bar patterns ──────────────────────────────────────────────────────
  bullishengulfingpattern,
  bearishengulfingpattern,
  bullishharami,
  bearishharami,
  bullishharamicross,
  bearishharamicross,
  piercingline,
  darkcloudcover,
  tweezertop,
  tweezerbottom,
  // ── Three-bar patterns ────────────────────────────────────────────────────
  morningstar,
  eveningstar,
  morningdojistar,
  eveningdojistar,
  threewhitesoldiers,
  threeblackcrows,
  abandonedbaby,
  downsidetasukigap,
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

export interface ExhaustionResult {
  gapPct: number;               // open vs prior close %
  wickRatio: number;            // (close - low) / (high - low); 1.0 = closed at high
  consecutiveDownDays: number;  // unbroken run of down closes
  distributionTop: boolean;     // overbought exhaustion signals active
  capitulationVolume: boolean;  // relVol > 5x at RSI < 25
  exhaustionScore: number;      // 0-100; high = potential bottom exhaustion
  exhaustionSignal: "capitulation" | "reversal_bar" | "breakout" | "extended_decline" | "distribution_top" | "none";
  doubleTop: boolean;           // price-pattern: two roughly-equal highs with trough ≥3% between them
  parabolicRise: boolean;       // rapid ascent vs prior baseline velocity — "hump" retracement risk
  doubleTopPeakPct: number;     // how far current price is from the double-top peak level (neg = below peak)
  riseSpeed5d: number;          // 5-day ROC at the time of detection (0 if not parabolic)
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

  // Stochastic: extreme readings are EXHAUSTION signals, not trend confirmations.
  // At K/D > 90 or < 10, mean-reversion risk outweighs the directional signal.
  // Bearish cross from overbought or bullish cross from oversold are the best entries.
  if (stochK > 90 && stochD > 90) {
    score -= 8;  // extreme overbought peak — reversal risk dominates
  } else if (stochK < 10 && stochD < 10) {
    score += 8;  // extreme oversold floor — bounce risk dominates
  } else if (stochK > 80 && stochD > 80 && stochK < stochD) {
    score -= 5;  // bearish crossover from overbought region
  } else if (stochK < 20 && stochD < 20 && stochK > stochD) {
    score += 5;  // bullish crossover from oversold region
  } else {
    score += stochK > stochD ? 4 : -4;  // normal range: directional signal
  }

  // CCI: above 150 / below -150, the extreme reading is an exhaustion counter-signal
  if (cci > 150) {
    score += 10 - Math.min((cci - 150) / 10, 10);  // ramps from +10 at 150 down to 0 at 250
  } else if (cci < -150) {
    score -= 10 - Math.min((-cci - 150) / 10, 10);
  } else {
    score += cci > 0 ? clamp(cci / 10, 0, 10) : -clamp(-cci / 10, 0, 10);
  }

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
  if (bars.length < 10) {
    return { patterns: [], marketStructure: "ranging", supportLevel: 0, resistanceLevel: 0 };
  }

  const closes  = bars.map(b => b.close);
  const highs   = bars.map(b => b.high);
  const lows    = bars.map(b => b.low);
  const volumes = bars.map(b => b.volume);
  const n       = bars.length;
  const patterns: string[] = [];
  const price   = closes[n - 1];

  // ── Market structure (20-bar HH/HL vs LH/LL) ─────────────────────────────────
  const rH = highs.slice(-20), rL = lows.slice(-20);
  const higherHighs = rH[rH.length - 1] > rH[0];
  const higherLows  = rL[rL.length - 1] > rL[0];
  const lowerHighs  = rH[rH.length - 1] < rH[0];
  const lowerLows   = rL[rL.length - 1] < rL[0];
  let marketStructure: PatternResult["marketStructure"] = "ranging";
  if (higherHighs && higherLows) marketStructure = "uptrend";
  else if (lowerHighs && lowerLows) marketStructure = "downtrend";

  // ── Support / Resistance ──────────────────────────────────────────────────────
  // Dynamic S/R: use 50-bar swing highs/lows, fall back to 20-bar
  const lb50H = highs.slice(-50), lb50L = lows.slice(-50);
  const supportLevel    = Math.min(...(lb50L.length ? lb50L : lows.slice(-20)));
  const resistanceLevel = Math.max(...(lb50H.length ? lb50H : highs.slice(-20)));

  // ── MA-based structural signals ───────────────────────────────────────────────
  if (trend.goldenCross)        patterns.push("Golden Cross");
  if (trend.deathCross)         patterns.push("Death Cross");
  if (volatility.volatilitySqueeze) patterns.push("Volatility Squeeze");
  if (price > volatility.bollingerUpper) patterns.push("BB Breakout");
  if (price < volatility.bollingerLower) patterns.push("BB Breakdown");

  // ── Bull Flag / Bear Flag ────────────────────────────────────────────────────
  // Requires: strong prior leg (10-20 bars ago) + tight recent consolidation (last 5-8 bars)
  //           + volume declining during consolidation
  if (n >= 25) {
    const flagPole   = closes.slice(-20, -8);
    const flagBody   = closes.slice(-8);
    const poleGain   = (flagPole[flagPole.length - 1] - flagPole[0]) / flagPole[0] * 100;
    const flagRange  = Math.max(...highs.slice(-8)) - Math.min(...lows.slice(-8));
    const poleRange  = Math.max(...highs.slice(-20, -8)) - Math.min(...lows.slice(-20, -8));
    const volFlagAvg = volumes.slice(-8).reduce((a, b) => a + b, 0) / 8;
    const volPoleAvg = volumes.slice(-20, -8).reduce((a, b) => a + b, 0) / 12;
    const volDecline = volFlagAvg < volPoleAvg * 0.75;
    const tight      = poleRange > 0 && flagRange < poleRange * 0.45;
    if (poleGain > 6 && tight && volDecline) patterns.push("Bull Flag");
    if (poleGain < -6 && tight && volDecline) patterns.push("Bear Flag");
  }

  // ── Ascending / Descending Triangle ──────────────────────────────────────────
  // Flat top + rising lows (ascending) | Flat bottom + falling highs (descending)
  if (n >= 20) {
    const tHigh20 = highs.slice(-20), tLow20 = lows.slice(-20);
    const maxH   = Math.max(...tHigh20), minH  = Math.min(...tHigh20);
    const maxL   = Math.max(...tLow20),  minL  = Math.min(...tLow20);
    const flatTop    = (maxH - minH) / maxH < 0.025;   // highs within 2.5%
    const risingLows = tLow20[tLow20.length - 1] > tLow20[0] + (maxL - minL) * 0.3;
    const flatBot    = (maxL - minL) / maxL < 0.025;
    const fallingHighs = tHigh20[tHigh20.length - 1] < tHigh20[0] - (maxH - minH) * 0.3;
    if (flatTop && risingLows)   patterns.push("Ascending Triangle");
    if (flatBot && fallingHighs) patterns.push("Descending Triangle");
  }

  // ── Symmetrical Triangle (converging highs AND lows) ─────────────────────────
  if (n >= 20) {
    const tH = highs.slice(-20), tL = lows.slice(-20);
    const highDiff  = tH[0] - tH[tH.length - 1];
    const lowDiff   = tL[tL.length - 1] - tL[0];
    if (highDiff > 0 && lowDiff > 0 &&
        Math.abs(highDiff - lowDiff) / Math.max(highDiff, lowDiff) < 0.4) {
      patterns.push("Symmetrical Triangle");
    }
  }

  // ── Rising / Falling Wedge ────────────────────────────────────────────────────
  // Both highs and lows trending same direction but converging
  if (n >= 25) {
    const wH = highs.slice(-25), wL = lows.slice(-25);
    const highSlope = (wH[wH.length - 1] - wH[0]) / wH[0] * 100;
    const lowSlope  = (wL[wL.length - 1] - wL[0]) / wL[0] * 100;
    // Rising wedge: both slopes positive but lows rising faster → compression near top
    if (highSlope > 1 && lowSlope > 1 && lowSlope > highSlope * 1.3) patterns.push("Rising Wedge");
    // Falling wedge: both slopes negative but highs falling faster → bullish compression
    if (highSlope < -1 && lowSlope < -1 && highSlope < lowSlope * 1.3) patterns.push("Falling Wedge");
  }

  // ── Cup and Handle ────────────────────────────────────────────────────────────
  // Rough detection: U-shaped 30-60 bar base + shallow pullback in last 10 bars
  if (n >= 50) {
    const cup    = closes.slice(-50, -10);
    const cupMax = Math.max(...cup);
    const cupMin = Math.min(...cup);
    const midMin = Math.min(...closes.slice(-40, -20));
    const isU    = cupMin < cupMax * 0.95 && midMin < cupMax * 0.9 && cup[cup.length - 1] > cupMax * 0.95;
    if (isU) {
      const handle    = closes.slice(-10);
      const handleLow = Math.min(...handle);
      const shallow   = handleLow > cupMax * 0.88;
      if (shallow) patterns.push("Cup and Handle");
    }
  }

  // ── Double Bottom ─────────────────────────────────────────────────────────────
  // Two roughly-equal lows + meaningful rally between them + price now recovering
  if (n >= 20) {
    const lb = lows.slice(-60);
    const len = lb.length;
    if (len >= 20) {
      let v1Idx = 0;
      for (let i = 1; i < len; i++) if (lb[i] < lb[v1Idx]) v1Idx = i;
      const v1 = lb[v1Idx];
      if (v1Idx >= 3 && v1Idx <= len - 5) {
        let peakIdx = v1Idx, peakVal = closes[n - len + v1Idx];
        for (let i = v1Idx + 1; i < len - 2; i++) {
          if (closes[n - len + i] > peakVal) { peakVal = closes[n - len + i]; peakIdx = i; }
        }
        const peakRise = (peakVal - v1) / v1 * 100;
        if (peakRise >= 3 && peakIdx > v1Idx) {
          let v2Idx = peakIdx, v2 = lb[peakIdx];
          for (let i = peakIdx + 1; i < len; i++) if (lb[i] < v2) { v2 = lb[i]; v2Idx = i; }
          const valleyDiff = Math.abs(v2 - v1) / v1 * 100;
          const isRecent   = v2Idx >= len - 20;
          if (valleyDiff <= 3.5 && isRecent && peakRise >= 3) patterns.push("Double Bottom");
        }
      }
    }
  }

  // ── Head and Shoulders (bearish) ─────────────────────────────────────────────
  if (n >= 40) {
    const h = highs.slice(-80);
    const len = h.length;
    // find head (global peak), then left shoulder and right shoulder
    let headIdx = 0;
    for (let i = 1; i < len; i++) if (h[i] > h[headIdx]) headIdx = i;
    const head = h[headIdx];
    if (headIdx >= 10 && headIdx <= len - 10) {
      // left shoulder: highest point in [0, headIdx-5]
      let lsIdx = 0;
      for (let i = 1; i < headIdx - 4; i++) if (h[i] > h[lsIdx]) lsIdx = i;
      // right shoulder: highest point in [headIdx+5, end]
      let rsIdx = headIdx + 5;
      for (let i = headIdx + 6; i < len; i++) if (h[i] > h[rsIdx]) rsIdx = i;
      const ls = h[lsIdx], rs = h[rsIdx];
      // Shoulders should be roughly equal and meaningfully below the head
      const shoulderBalance = Math.abs(ls - rs) / head * 100;
      const headPremium     = (head - Math.max(ls, rs)) / head * 100;
      const rsRecent        = rsIdx >= len - 25;
      if (shoulderBalance < 5 && headPremium > 3 && rsRecent) patterns.push("Head and Shoulders");
    }
  }

  // ── Inverse Head and Shoulders (bullish) ─────────────────────────────────────
  if (n >= 40) {
    const l = lows.slice(-80);
    const len = l.length;
    let headIdx = 0;
    for (let i = 1; i < len; i++) if (l[i] < l[headIdx]) headIdx = i;
    const head = l[headIdx];
    if (headIdx >= 10 && headIdx <= len - 10) {
      let lsIdx = 0;
      for (let i = 1; i < headIdx - 4; i++) if (l[i] < l[lsIdx]) lsIdx = i;
      let rsIdx = headIdx + 5;
      for (let i = headIdx + 6; i < len; i++) if (l[i] < l[rsIdx]) rsIdx = i;
      const ls = l[lsIdx], rs = l[rsIdx];
      const shoulderBalance = Math.abs(ls - rs) / Math.abs(head) * 100;
      const headDiscount    = (Math.min(ls, rs) - head) / Math.abs(head) * 100;
      const rsRecent        = rsIdx >= len - 25;
      if (shoulderBalance < 5 && headDiscount > 3 && rsRecent) patterns.push("Inv Head and Shoulders");
    }
  }

  // ── Island Reversal ───────────────────────────────────────────────────────────
  // Gap up followed by gap down (or vice versa), leaving an isolated candle island
  if (n >= 5) {
    const g1 = bars[n - 3].open - bars[n - 4].close; // gap into island
    const g2 = bars[n - 1].open - bars[n - 2].close; // gap out of island
    if (g1 > 0 && g2 < 0 && Math.abs(g1) > 0.5 && Math.abs(g2) > 0.5) patterns.push("Bearish Island Reversal");
    if (g1 < 0 && g2 > 0 && Math.abs(g1) > 0.5 && Math.abs(g2) > 0.5) patterns.push("Bullish Island Reversal");
  }

  // ── Inside Day / NR7 (Narrow Range 7) ────────────────────────────────────────
  if (n >= 7) {
    const todayRange = bars[n - 1].high - bars[n - 1].low;
    const prevRange  = bars[n - 2].high - bars[n - 2].low;
    if (bars[n - 1].high < bars[n - 2].high && bars[n - 1].low > bars[n - 2].low)
      patterns.push("Inside Day");
    // NR7: today's range is smallest of last 7 bars (compression before expansion)
    const ranges7 = Array.from({ length: 7 }, (_, i) => bars[n - 7 + i].high - bars[n - 7 + i].low);
    if (todayRange === Math.min(...ranges7) && todayRange < prevRange * 0.6)
      patterns.push("NR7 Compression");
  }

  // ── Three-candle patterns (library-based, current state only) ────────────────
  if (n >= 5) {
    const ohlc = { open: bars.map(b => b.open), high: highs, low: lows, close: closes };
    try { if (threewhitesoldiers(ohlc).at(-1)) patterns.push("Three White Soldiers"); } catch { /* skip */ }
    try { if (threeblackcrows(ohlc).at(-1))    patterns.push("Three Black Crows");    } catch { /* skip */ }
    try { if (morningstar(ohlc).at(-1))        patterns.push("Morning Star");         } catch { /* skip */ }
    try { if (eveningstar(ohlc).at(-1))        patterns.push("Evening Star");         } catch { /* skip */ }
    try { if (morningdojistar(ohlc).at(-1))    patterns.push("Morning Doji Star");    } catch { /* skip */ }
    try { if (eveningdojistar(ohlc).at(-1))    patterns.push("Evening Doji Star");    } catch { /* skip */ }
    try { if (abandonedbaby(ohlc).at(-1))      patterns.push("Abandoned Baby");       } catch { /* skip */ }
  }

  return {
    patterns: [...new Set(patterns)].slice(0, 12),
    marketStructure,
    supportLevel:    Math.round(supportLevel    * 100) / 100,
    resistanceLevel: Math.round(resistanceLevel * 100) / 100,
  };
}

export interface ChartSignal {
  date: string;
  direction: "bull" | "bear";
  label: string;
  strength: "strong" | "moderate";
}

/** Run a technicalindicators candlestick pattern function across the full bar array
 *  and emit a ChartSignal for every bar where the pattern fires within the window. */
function runCandlePattern(
  fn: (d: { open: number[]; high: number[]; low: number[]; close: number[] }) => boolean[],
  opens: number[], highs: number[], lows: number[], closes: number[],
  bars: OHLCVBar[],
  windowStart: number,
  label: string,
  direction: "bull" | "bear",
  strength: "strong" | "moderate",
  signals: ChartSignal[]
): void {
  try {
    const results = fn({ open: opens, high: highs, low: lows, close: closes });
    const offset = opens.length - results.length;
    for (let i = 0; i < results.length; i++) {
      const barIdx = offset + i;
      if (barIdx < windowStart) continue;
      if (results[i]) {
        signals.push({ date: bars[barIdx].time.substring(0, 10), direction, label, strength });
      }
    }
  } catch { /* pattern requires more bars than available — skip */ }
}

export function calcChartSignals(bars: OHLCVBar[]): ChartSignal[] {
  if (bars.length < 35) return [];

  const opens  = bars.map(b => b.open);
  const closes = bars.map(b => b.close);
  const highs  = bars.map(b => b.high);
  const lows   = bars.map(b => b.low);
  const volumes = bars.map(b => b.volume);
  const n = bars.length;
  const windowStart     = Math.max(0, n - 90);   // candlestick patterns: 90-bar window
  const recentStart     = Math.max(0, n - 20);    // BB / volume: tighter window
  const signals: ChartSignal[] = [];

  // ── Single-bar candlestick patterns ──────────────────────────────────────────
  runCandlePattern(doji,                    opens, highs, lows, closes, bars, windowStart, "DOJI",     "bear", "moderate", signals);
  runCandlePattern(dragonflydoji,           opens, highs, lows, closes, bars, windowStart, "DFLYDO",   "bull", "strong",   signals);
  runCandlePattern(gravestonedoji,          opens, highs, lows, closes, bars, windowStart, "GRAVDO",   "bear", "strong",   signals);
  runCandlePattern(bullishhammerstick,      opens, highs, lows, closes, bars, windowStart, "HAMMER",   "bull", "strong",   signals);
  runCandlePattern(bearishhammerstick,      opens, highs, lows, closes, bars, windowStart, "BHAMMER",  "bear", "moderate", signals);
  runCandlePattern(hangingman,              opens, highs, lows, closes, bars, windowStart, "HANGMAN",  "bear", "strong",   signals);
  runCandlePattern(shootingstar,            opens, highs, lows, closes, bars, windowStart, "SHOOT★",   "bear", "strong",   signals);
  runCandlePattern(bullishinvertedhammerstick, opens, highs, lows, closes, bars, windowStart, "INVHAM", "bull", "moderate", signals);
  runCandlePattern(bearishinvertedhammerstick, opens, highs, lows, closes, bars, windowStart, "INVBH",  "bear", "moderate", signals);
  runCandlePattern(bullishmarubozu,         opens, highs, lows, closes, bars, windowStart, "MBULL",    "bull", "strong",   signals);
  runCandlePattern(bearishmarubozu,         opens, highs, lows, closes, bars, windowStart, "MBEAR",    "bear", "strong",   signals);
  runCandlePattern(bullishspinningtop,      opens, highs, lows, closes, bars, windowStart, "SPINTOP",  "bull", "moderate", signals);
  runCandlePattern(bearishspinningtop,      opens, highs, lows, closes, bars, windowStart, "SPINBOT",  "bear", "moderate", signals);

  // ── Two-bar candlestick patterns ─────────────────────────────────────────────
  runCandlePattern(bullishengulfingpattern, opens, highs, lows, closes, bars, windowStart, "ENGULF↑",  "bull", "strong",   signals);
  runCandlePattern(bearishengulfingpattern, opens, highs, lows, closes, bars, windowStart, "ENGULF↓",  "bear", "strong",   signals);
  runCandlePattern(bullishharami,           opens, highs, lows, closes, bars, windowStart, "HARAMI↑",  "bull", "moderate", signals);
  runCandlePattern(bearishharami,           opens, highs, lows, closes, bars, windowStart, "HARAMI↓",  "bear", "moderate", signals);
  runCandlePattern(bullishharamicross,      opens, highs, lows, closes, bars, windowStart, "HCROSS↑",  "bull", "strong",   signals);
  runCandlePattern(bearishharamicross,      opens, highs, lows, closes, bars, windowStart, "HCROSS↓",  "bear", "strong",   signals);
  runCandlePattern(piercingline,            opens, highs, lows, closes, bars, windowStart, "PIERCE",   "bull", "strong",   signals);
  runCandlePattern(darkcloudcover,          opens, highs, lows, closes, bars, windowStart, "DRKCLOUD", "bear", "strong",   signals);
  runCandlePattern(tweezertop,              opens, highs, lows, closes, bars, windowStart, "TWZTOP",   "bear", "moderate", signals);
  runCandlePattern(tweezerbottom,           opens, highs, lows, closes, bars, windowStart, "TWZBOT",   "bull", "moderate", signals);

  // ── Three-bar candlestick patterns ───────────────────────────────────────────
  runCandlePattern(morningstar,             opens, highs, lows, closes, bars, windowStart, "MORNSTAR", "bull", "strong",   signals);
  runCandlePattern(eveningstar,             opens, highs, lows, closes, bars, windowStart, "EVENSTAR", "bear", "strong",   signals);
  runCandlePattern(morningdojistar,         opens, highs, lows, closes, bars, windowStart, "MNDOSTAR", "bull", "strong",   signals);
  runCandlePattern(eveningdojistar,         opens, highs, lows, closes, bars, windowStart, "EVDOSTAR", "bear", "strong",   signals);
  runCandlePattern(threewhitesoldiers,      opens, highs, lows, closes, bars, windowStart, "3SOLDIER", "bull", "strong",   signals);
  runCandlePattern(threeblackcrows,         opens, highs, lows, closes, bars, windowStart, "3CROWS",   "bear", "strong",   signals);
  runCandlePattern(abandonedbaby,           opens, highs, lows, closes, bars, windowStart, "ABNDBY",   "bull", "strong",   signals);
  runCandlePattern(downsidetasukigap,       opens, highs, lows, closes, bars, windowStart, "TASUKI↓",  "bear", "moderate", signals);

  // ── Inside Bar and Outside Bar (custom, last 90 bars) ────────────────────────
  for (let i = windowStart + 1; i < n; i++) {
    const prev = bars[i - 1];
    const cur  = bars[i];
    // Inside bar: today's entire range fits within yesterday's range
    if (cur.high < prev.high && cur.low > prev.low) {
      const dir = cur.close >= cur.open ? "bull" : "bear";
      signals.push({ date: cur.time.substring(0, 10), direction: dir, label: "IB", strength: "moderate" });
    }
    // Outside bar / engulfing range: today's range fully swallows yesterday's
    if (cur.high > prev.high && cur.low < prev.low) {
      const dir = cur.close >= cur.open ? "bull" : "bear";
      signals.push({ date: cur.time.substring(0, 10), direction: dir, label: "OB", strength: "strong" });
    }
  }

  // ── Gap Up / Gap Down (open > prev close + threshold) ────────────────────────
  for (let i = windowStart + 1; i < n; i++) {
    const gapPct = ((bars[i].open - bars[i - 1].close) / bars[i - 1].close) * 100;
    if (gapPct > 2) {
      signals.push({ date: bars[i].time.substring(0, 10), direction: "bull", label: `GAP+${gapPct.toFixed(1)}%`, strength: gapPct > 5 ? "strong" : "moderate" });
    } else if (gapPct < -2) {
      signals.push({ date: bars[i].time.substring(0, 10), direction: "bear", label: `GAP${gapPct.toFixed(1)}%`, strength: gapPct < -5 ? "strong" : "moderate" });
    }
  }

  // ── RSI threshold crossings ───────────────────────────────────────────────────
  const rsiArr = RSI.calculate({ values: closes, period: 14 });
  const rsiOff = n - rsiArr.length;
  for (let i = 1; i < rsiArr.length; i++) {
    const bi = rsiOff + i;
    if (bi < windowStart) continue;
    const prev = rsiArr[i - 1], curr = rsiArr[i];
    if (prev >= 30 && curr < 30)  signals.push({ date: bars[bi].time.substring(0, 10), direction: "bear", label: "OS",    strength: "strong"   });
    if (prev < 30  && curr >= 30) signals.push({ date: bars[bi].time.substring(0, 10), direction: "bull", label: "RSI↑",  strength: "strong"   });
    if (prev <= 70 && curr > 70)  signals.push({ date: bars[bi].time.substring(0, 10), direction: "bull", label: "OB",    strength: "moderate" });
    if (prev > 70  && curr <= 70) signals.push({ date: bars[bi].time.substring(0, 10), direction: "bear", label: "RSI↓",  strength: "moderate" });
  }

  // ── Bollinger Band events (last 20 bars) ─────────────────────────────────────
  const bbArr = BollingerBands.calculate({ values: closes, period: 20, stdDev: 2 });
  const bbOff = n - bbArr.length;
  for (let i = 1; i < bbArr.length; i++) {
    const bi = bbOff + i;
    if (bi < recentStart) continue;
    const bb = bbArr[i], pbB = bbArr[i - 1];
    if (!bb || !pbB) continue;
    const price = closes[bi], prevPrice = closes[bi - 1];
    if (prevPrice <= pbB.upper && price > bb.upper)  signals.push({ date: bars[bi].time.substring(0, 10), direction: "bull", label: "BB↑",  strength: "moderate" });
    if (prevPrice >= pbB.lower && price < bb.lower)  signals.push({ date: bars[bi].time.substring(0, 10), direction: "bear", label: "BB↓",  strength: "moderate" });
    if (prevPrice < pbB.lower  && price >= bb.lower) signals.push({ date: bars[bi].time.substring(0, 10), direction: "bull", label: "BB↪",  strength: "strong"   });
    if (prevPrice > pbB.upper  && price <= bb.upper) signals.push({ date: bars[bi].time.substring(0, 10), direction: "bear", label: "BB↩",  strength: "moderate" });
  }

  // ── MACD crossovers ───────────────────────────────────────────────────────────
  const macdArr = MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false });
  const macdOff = n - macdArr.length;
  for (let i = 1; i < macdArr.length; i++) {
    const bi = macdOff + i;
    if (bi < windowStart) continue;
    const prev = macdArr[i - 1], curr = macdArr[i];
    if (!prev?.histogram || !curr?.histogram) continue;
    if (prev.histogram < 0 && curr.histogram >= 0) signals.push({ date: bars[bi].time.substring(0, 10), direction: "bull", label: "MACD↑", strength: "moderate" });
    if (prev.histogram > 0 && curr.histogram <= 0) signals.push({ date: bars[bi].time.substring(0, 10), direction: "bear", label: "MACD↓", strength: "moderate" });
  }

  // ── Volume spikes (>2.5× 20-bar avg) ─────────────────────────────────────────
  for (let i = windowStart + 20; i < n; i++) {
    const avgVol = volumes.slice(i - 20, i).reduce((a, b) => a + b, 0) / 20;
    if (avgVol > 0 && volumes[i] > avgVol * 2.5) {
      const dir = closes[i] >= (closes[i - 1] ?? closes[i]) ? "bull" : "bear";
      signals.push({ date: bars[i].time.substring(0, 10), direction: dir, label: "VOL", strength: "strong" });
    }
  }

  // ── Sort, deduplicate, cap ────────────────────────────────────────────────────
  signals.sort((a, b) => b.date.localeCompare(a.date));
  const seen = new Set<string>();
  const deduped: ChartSignal[] = [];
  for (const s of signals) {
    const key = `${s.date}:${s.direction}:${s.label}`;
    if (!seen.has(key)) { seen.add(key); deduped.push(s); }
  }
  return deduped.slice(0, 30);
}

export interface RegimeIndicators {
  adx: number;
  adxTrending: boolean;
  realizedVol20: number;
  realizedVolPct: number;
  regimeScore: number;
  /** Pre-computed HYG/LQD 20D momentum factor (0–100); null when data unavailable. */
  creditSpreadFactor: number | null;
  /** Pre-computed VIX3M/VIX ratio factor (0–100); null when data unavailable. */
  vixTermStructureFactor: number | null;
}

/**
 * Optional extra market context for enhanced regime scoring.
 * All fields are optional — safe to omit (neutral 50 is assumed for missing values).
 */
export interface RegimeExtra {
  /** 0–100: HYG/LQD 20D ratio momentum. 100 = improving credit (risk-on). */
  creditSpreadFactor?: number;
  /** 0–100: VIX3M/VIX ratio. 100 = strong contango (calm). 0 = backwardation (fear). */
  vixTermStructureFactor?: number;
}

export function calcRegimeIndicators(
  bars: OHLCVBar[],
  spyTrend: TrendResult,
  extra?: RegimeExtra,
): RegimeIndicators {
  const highs = bars.map(b => b.high);
  const lows = bars.map(b => b.low);
  const closes = bars.map(b => b.close);

  // ADX — trend strength; >20 = trending, >40 = strongly trending
  const adxArr = ADX.calculate({ high: highs, low: lows, close: closes, period: 14 });
  const adxVal = adxArr.length > 0 ? (adxArr[adxArr.length - 1].adx ?? 25) : 25;
  const adxTrending = adxVal > 20;

  // 20-day realized volatility (annualized %)
  const logReturns = closes.slice(1).map((c, i) => Math.log(c / closes[i]));
  const last20 = logReturns.slice(-20);
  const meanR = last20.reduce((a, b) => a + b, 0) / 20;
  const variance = last20.reduce((a, r) => a + (r - meanR) ** 2, 0) / Math.max(1, last20.length - 1);
  const realizedVol20 = Math.sqrt(variance * 252) * 100;

  // Percentile of current vol vs rolling 20-day vols over all available history
  const rollingVols: number[] = [];
  for (let i = 20; i <= logReturns.length; i++) {
    const slice = logReturns.slice(i - 20, i);
    const m = slice.reduce((a, b) => a + b, 0) / 20;
    const v = slice.reduce((a, r) => a + (r - m) ** 2, 0) / Math.max(1, slice.length - 1);
    rollingVols.push(Math.sqrt(v * 252) * 100);
  }
  const rank = rollingVols.filter(v => v < realizedVol20).length;
  const realizedVolPct = rollingVols.length > 0 ? (rank / rollingVols.length) * 100 : 50;

  // Extra factors: default to 50 (neutral) when unavailable so score scale
  // is preserved in backtestEngine historical runs without HYG/LQD data.
  const creditFactor = extra?.creditSpreadFactor    ?? 50;
  const vtsFactor    = extra?.vixTermStructureFactor ?? 50;

  // Composite regime score (weights sum to 100%):
  //   40% SPY SMA alignment     — primary market trend direction
  //   20% volatility state      — low vol = calm = risk-on
  //   15% ADX                   — whether there is a clear trend to follow
  //   15% credit spread momentum— HYG/LQD ratio improving = risk-on
  //   10% VIX term structure    — contango = calm, backwardation = fear
  const volFactor = 100 - realizedVolPct;
  const adxFactor = clamp((adxVal - 15) * 5); // ADX 15→0, ADX 35→100
  const regimeScore = clamp(
    spyTrend.trendAlignmentScore * 0.40 +
    volFactor * 0.20 +
    adxFactor * 0.15 +
    creditFactor * 0.15 +
    vtsFactor  * 0.10
  );

  return {
    adx: Math.round(adxVal * 10) / 10,
    adxTrending,
    realizedVol20:  Math.round(realizedVol20 * 10) / 10,
    realizedVolPct: Math.round(realizedVolPct),
    regimeScore:    Math.round(regimeScore),
    creditSpreadFactor:     extra?.creditSpreadFactor    ?? null,
    vixTermStructureFactor: extra?.vixTermStructureFactor ?? null,
  };
}

/**
 * Exhaustion detector — identifies seller/buyer exhaustion at price extremes.
 *
 * The trend/momentum sub-scores are designed to follow established trends. At
 * capitulation events (e.g. extreme gap-down on 9-10x volume) they correctly
 * signal "bearish" but miss the reversal setup hidden inside the data. This
 * function reads the signals that pure trend-following ignores:
 *   - wick ratio   → where close sits in the day's range (buyers vs sellers)
 *   - relVol × RSI → volume surge at extreme oversold = seller exhaustion
 *   - consecutive down days → extended declines are mean-reversion candidates
 *   - gap events    → large gap-downs on huge vol often mark exhaustion gaps
 *   - price vs SMA200 → deep extension increases snap-back probability
 */
export function calcExhaustion(
  bars: OHLCVBar[],
  momentum: MomentumResult,
  volume: VolumeResult,
  trend: TrendResult,
  volatility?: VolatilityResult
): ExhaustionResult {
  if (bars.length < 5) {
    return {
      gapPct: 0, wickRatio: 0.5, consecutiveDownDays: 0,
      capitulationVolume: false, distributionTop: false, exhaustionScore: 50, exhaustionSignal: "none",
      doubleTop: false, parabolicRise: false, doubleTopPeakPct: 0, riseSpeed5d: 0,
    };
  }

  const lastBar = bars[bars.length - 1];
  const prevBar = bars[bars.length - 2];

  // Gap: today's open vs yesterday's close
  const gapPct = prevBar ? ((lastBar.open - prevBar.close) / prevBar.close) * 100 : 0;

  // Wick ratio: (close − low) / (high − low)
  // 1.0 = closed at the high (buyers totally dominated)
  // 0.0 = closed at the low  (sellers totally dominated)
  const dayRange = lastBar.high - lastBar.low;
  const wickRatio = dayRange > 0.0001 ? (lastBar.close - lastBar.low) / dayRange : 0.5;

  // Consecutive down closes (close < open = red candle)
  let consecutiveDownDays = 0;
  for (let i = bars.length - 1; i >= 0 && i >= bars.length - 20; i--) {
    if (bars[i].close < bars[i].open) consecutiveDownDays++;
    else break;
  }

  const capitulationVolume = volume.relativeVolume > 5 && momentum.rsi < 25;

  let score = 50;

  // ── RSI extremes (lower = deeper oversold = stronger exhaustion/bounce signal) ──
  if      (momentum.rsi < 15) score += 20;
  else if (momentum.rsi < 20) score += 12;
  else if (momentum.rsi < 25) score +=  6;
  // Overbought RSI depresses exhaustion score (top exhaustion = mean reversion risk)
  if      (momentum.rsi > 80) score -= 15;
  else if (momentum.rsi > 70) score -=  8;

  // ── Extended decline (consecutive red candles) ──
  if      (consecutiveDownDays >= 10) score += 15;
  else if (consecutiveDownDays >=  7) score += 10;
  else if (consecutiveDownDays >=  5) score +=  6;
  else if (consecutiveDownDays >=  3) score +=  3;

  // ── Wick quality: where did buyers/sellers finish the day? ──
  // High wick ratio after a gap-down or extended slide = buyers absorbed selling
  if      (wickRatio > 0.70) score += 20;   // reversal bar — buyers dominated
  else if (wickRatio > 0.50) score += 12;
  else if (wickRatio > 0.30) score +=  5;
  else if (wickRatio < 0.20) score -= 15;   // sellers still in full control

  // ── Volume surge at extreme oversold = capitulation ──
  if      (volume.relativeVolume > 7 && momentum.rsi < 25) score += 15;
  else if (volume.relativeVolume > 5 && momentum.rsi < 30) score += 10;
  else if (volume.relativeVolume > 3 && momentum.rsi < 35) score +=  5;

  // ── Price stretched far below long-term average (mean-reversion pull) ──
  if      (trend.priceVsSma200 < -30) score += 12;
  else if (trend.priceVsSma200 < -20) score +=  8;
  else if (trend.priceVsSma200 < -10) score +=  4;

  // ── Gap-down exhaustion (large gaps on huge vol often mark the terminal move) ──
  if      (gapPct < -20) score += 10;
  else if (gapPct < -10) score +=  6;
  else if (gapPct <  -5) score +=  3;

  // ── Stochastic at absolute floor (bullish exhaustion) ──
  if      (momentum.stochK < 10 && momentum.stochD < 10) score += 10;
  else if (momentum.stochK < 20)                          score +=  5;

  // ── Stochastic at absolute ceiling (overbought exhaustion — mirror of above) ──
  if      (momentum.stochK > 90 && momentum.stochD > 90) score -= 15;
  else if (momentum.stochK > 80 && momentum.stochD > 80 && momentum.stochK < momentum.stochD) score -= 10; // bearish cross from OB zone

  // ── Price above Bollinger upper band — mean reversion pressure at top ──
  if (volatility) {
    const lastClose = bars[bars.length - 1].close;
    const bbDeviation = volatility.bollingerUpper > 0
      ? (lastClose - volatility.bollingerUpper) / volatility.bollingerUpper * 100
      : 0;
    if      (bbDeviation > 3)  score -= 15;  // well above BB+ — extreme overextension
    else if (bbDeviation > 1)  score -= 10;  // clearly above BB+
    else if (bbDeviation > 0)  score -=  5;  // just piercing BB+
  }

  // ── Price stretched far above SMA20 — mean reversion pull from the top ──
  if      (trend.priceVsSma20 > 20) score -= 12;  // extreme extension (>20% above SMA20)
  else if (trend.priceVsSma20 > 15) score -=  8;
  else if (trend.priceVsSma20 > 10) score -=  4;

  // ── Low volume at elevated prices = distribution (smart money is not chasing) ──
  if (volume.relativeVolume < 0.8 && trend.priceVsSma20 > 10) score -= 6;

  // ── CCI extremes signal top exhaustion ──
  if      (momentum.cci > 200) score -= 8;
  else if (momentum.cci > 150) score -= 4;

  // ── Early divergence already detected by momentum engine ──
  if (momentum.rsiDivergence === "bullish") score += 8;
  if (momentum.rsiDivergence === "bearish") score -= 6;

  score = clamp(score);

  // Classify the primary signal type
  // Key distinction: gap-UP with high wick = breakout (earnings/catalyst); 
  // gap-DOWN or flat open with high wick after oversold = reversal bar.
  // Whether overbought distribution signals are active (used in narrative)
  const distributionTop =
    momentum.stochK > 80 && momentum.stochD > 80 &&
    (trend.priceVsSma20 > 10 || (volatility ? bars[bars.length - 1].close > volatility.bollingerUpper : false));

  // ── Double-top price pattern: two roughly-equal highs separated by a ≥3% trough ──
  // Looks back 60 bars; second peak must be in the last 20 bars.
  let doubleTop = false;
  let doubleTopPeakPct = 0;
  {
    const lb = bars.slice(-60);
    const len = lb.length;
    if (len >= 20) {
      const highs = lb.map(b => b.high);
      const lows  = lb.map(b => b.low);

      // Step 1: find the global peak (first/leftmost peak)
      let p1Idx = 0;
      for (let i = 1; i < len; i++) if (highs[i] > highs[p1Idx]) p1Idx = i;
      const p1 = highs[p1Idx];

      // Step 2: peak must not be in the last 5 bars (room for second peak) nor first 3
      if (p1Idx >= 3 && p1Idx <= len - 5) {
        // Step 3: find the trough after the first peak
        let troughIdx = p1Idx + 1;
        let troughLow = lows[p1Idx + 1] ?? p1;
        for (let i = p1Idx + 1; i < len - 2; i++) {
          if (lows[i] < troughLow) { troughLow = lows[i]; troughIdx = i; }
        }
        const troughDepth = (p1 - troughLow) / p1 * 100;

        // Step 4: find the second peak after the trough
        if (troughDepth >= 3 && troughIdx > p1Idx) {
          let p2Idx = troughIdx;
          let p2 = highs[troughIdx];
          for (let i = troughIdx + 1; i < len; i++) {
            if (highs[i] > p2) { p2 = highs[i]; p2Idx = i; }
          }
          // Second peak within 3.5% of first peak AND in last 20 bars
          const peakDiff = Math.abs(p2 - p1) / p1 * 100;
          if (peakDiff <= 3.5 && p2Idx >= len - 20 && troughDepth >= 3) {
            doubleTop = true;
            const currentClose = bars[bars.length - 1].close;
            doubleTopPeakPct = (currentClose - Math.max(p1, p2)) / Math.max(p1, p2) * 100;
          }
        }
      }
    }
  }
  if (doubleTop) score -= 14;

  // ── Parabolic rise: recent 5D velocity >> prior 15D baseline → "hump" risk ──
  // The faster the ascent, the more proportional the retracement tends to be.
  let parabolicRise = false;
  let riseSpeed5d = 0;
  {
    const closes = bars.map(b => b.close);
    const n2 = closes.length;
    if (n2 >= 26) {
      const roc5  = (closes[n2 - 1] - closes[n2 - 6])  / closes[n2 - 6]  * 100;
      // baseline: the 15-day move that ended 5 days ago (non-overlapping window)
      const roc15 = (closes[n2 - 6] - closes[n2 - 21]) / closes[n2 - 21] * 100;
      riseSpeed5d = roc5;
      // Parabolic: 5D gain > 8% AND faster than 1.5× the prior 15D pace AND extended above SMA20
      if (roc5 > 8 && roc5 > Math.abs(roc15) * 1.5 && trend.priceVsSma20 > 5) {
        parabolicRise = true;
      }
    }
  }
  if (parabolicRise) score -= 10;

  score = clamp(score);

  let exhaustionSignal: ExhaustionResult["exhaustionSignal"] = "none";
  if (score >= 70) {
    if (capitulationVolume) {
      exhaustionSignal = "capitulation";
    } else if (gapPct > 8 && wickRatio > 0.60 && volume.relativeVolume > 2) {
      // Gap-up on elevated volume closing near highs = catalyst-driven breakout,
      // not an organic reversal bar. Don't mislabel it.
      exhaustionSignal = "breakout";
    } else if (wickRatio > 0.60 && volume.relativeVolume > 2 && momentum.rsi < 50) {
      // Organic reversal: opened weak/flat, buyers took it back, stock was oversold
      exhaustionSignal = "reversal_bar";
    } else if (consecutiveDownDays >= 7) {
      exhaustionSignal = "extended_decline";
    }
  } else if (score <= 30 && distributionTop) {
    exhaustionSignal = "distribution_top";
  }

  return {
    gapPct:               Math.round(gapPct   * 10) / 10,
    wickRatio:            Math.round(wickRatio * 100) / 100,
    consecutiveDownDays,
    capitulationVolume,
    distributionTop,
    exhaustionScore:      score,
    exhaustionSignal,
    doubleTop,
    parabolicRise,
    doubleTopPeakPct:     Math.round(doubleTopPeakPct * 10) / 10,
    riseSpeed5d:          Math.round(riseSpeed5d * 10) / 10,
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
  // % return over a given lookback (uses all available bars if fewer than requested)
  const perfPct = (bars: OHLCVBar[], lookback: number): number => {
    const sliced = bars.slice(-lookback);
    if (sliced.length < 2) return 0;
    return ((sliced[sliced.length - 1].close - sliced[0].close) / sliced[0].close) * 100;
  };

  // Three timeframes: 1mo (21d), 3mo (63d), 6mo (126d)
  const t1m = 21, t3m = 63, t6m = 126;

  const tickerVsSpy1m = perfPct(tickerBars, t1m) - perfPct(spyBars, t1m);
  const tickerVsSpy3m = perfPct(tickerBars, t3m) - perfPct(spyBars, t3m);
  const tickerVsSpy6m = perfPct(tickerBars, t6m) - perfPct(spyBars, t6m);

  // Mansfield-style weighted composite: 40% recent + 35% medium + 25% long
  const weightedVsSpy = tickerVsSpy1m * 0.40 + tickerVsSpy3m * 0.35 + tickerVsSpy6m * 0.25;

  const vsSpy   = Math.round(weightedVsSpy * 10) / 10;
  const vsQqq   = Math.round((perfPct(tickerBars, t1m) - perfPct(qqqBars, t1m)) * 10) / 10;
  const vsIwm   = Math.round((perfPct(tickerBars, t1m) - perfPct(iwmBars, t1m)) * 10) / 10;
  const vsSector = Math.round(weightedVsSpy * 0.5 * 10) / 10;

  const rsScore = clamp(50 + weightedVsSpy * 2);

  return { vsSpy, vsQqq, vsIwm, vsSector, rsScore, sectorName };
}

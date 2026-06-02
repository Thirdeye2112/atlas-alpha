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
  rsiDivergenceStrength: "strong" | "weak" | null;
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
  /** 0–100 realized-vol percentile rank over trailing 52 weeks (IV Rank proxy) */
  ivRankProxy: number;
  /** -1 to +1: positive = more up-days (call pressure), negative = more down-days (put pressure) */
  realizedSkew: number;
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

/** Returns indices of local minima (pivot lows) within the given window. */
function findPivotLows(values: number[], window = 3): { idx: number; value: number }[] {
  const pivots: { idx: number; value: number }[] = [];
  for (let i = window; i < values.length - window; i++) {
    let isPivot = true;
    for (let j = i - window; j <= i + window; j++) {
      if (j !== i && values[j] <= values[i]) { isPivot = false; break; }
    }
    if (isPivot) pivots.push({ idx: i, value: values[i] });
  }
  return pivots;
}

/** Returns indices of local maxima (pivot highs) within the given window. */
function findPivotHighs(values: number[], window = 3): { idx: number; value: number }[] {
  const pivots: { idx: number; value: number }[] = [];
  for (let i = window; i < values.length - window; i++) {
    let isPivot = true;
    for (let j = i - window; j <= i + window; j++) {
      if (j !== i && values[j] >= values[i]) { isPivot = false; break; }
    }
    if (isPivot) pivots.push({ idx: i, value: values[i] });
  }
  return pivots;
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

  // True pivot-based RSI divergence — compares price swing lows/highs to RSI at those pivots
  let rsiDivergence: MomentumResult["rsiDivergence"] = null;
  let rsiDivergenceStrength: MomentumResult["rsiDivergenceStrength"] = null;
  if (bars.length >= 30 && rsiArr.length >= 10) {
    const lookback    = Math.min(closes.length, 60);
    const sliceCloses = closes.slice(-lookback);
    const rsiOffset   = closes.length - rsiArr.length; // rsiArr[i] corresponds to closes[i + rsiOffset]
    const toRsiIdx    = (sliceIdx: number) => (closes.length - lookback + sliceIdx) - rsiOffset;

    const priceLows  = findPivotLows(sliceCloses,  3);
    const priceHighs = findPivotHighs(sliceCloses, 3);

    // Bullish divergence: lower price low + higher RSI low (hidden buying pressure)
    if (priceLows.length >= 2) {
      const p1 = priceLows[priceLows.length - 2];
      const p2 = priceLows[priceLows.length - 1];
      const r1i = toRsiIdx(p1.idx), r2i = toRsiIdx(p2.idx);
      if (r1i >= 0 && r2i > r1i && r2i < rsiArr.length) {
        const r1 = rsiArr[r1i], r2 = rsiArr[r2i];
        if (p2.value < p1.value && r2 > r1 && rsi < 52) {
          rsiDivergence = "bullish";
          const pDrop = (p1.value - p2.value) / p1.value * 100;
          const rRise = r2 - r1;
          rsiDivergenceStrength = pDrop > 4 && rRise > 6 ? "strong" : "weak";
        }
      }
    }

    // Bearish divergence: higher price high + lower RSI high (hidden selling pressure)
    if (!rsiDivergence && priceHighs.length >= 2) {
      const p1 = priceHighs[priceHighs.length - 2];
      const p2 = priceHighs[priceHighs.length - 1];
      const r1i = toRsiIdx(p1.idx), r2i = toRsiIdx(p2.idx);
      if (r1i >= 0 && r2i > r1i && r2i < rsiArr.length) {
        const r1 = rsiArr[r1i], r2 = rsiArr[r2i];
        if (p2.value > p1.value && r2 < r1 && rsi > 48) {
          rsiDivergence = "bearish";
          const pRise = (p2.value - p1.value) / p1.value * 100;
          const rDrop = r1 - r2;
          rsiDivergenceStrength = pRise > 4 && rDrop > 6 ? "strong" : "weak";
        }
      }
    }
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
    rsiDivergenceStrength,
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

  // IV Rank proxy: where does current 20-day realized vol sit in its 52-week distribution?
  // High rank = expensive vol (premium-selling environment), low = cheap vol (breakout setup)
  const logReturns: number[] = [];
  for (let i = 1; i < closes.length; i++) logReturns.push(Math.log(closes[i] / closes[i - 1]));

  const cur20 = logReturns.slice(-20);
  const mean20 = cur20.length > 0 ? cur20.reduce((a, b) => a + b, 0) / cur20.length : 0;
  const var20 = cur20.length > 1 ? cur20.reduce((a, r) => a + (r - mean20) ** 2, 0) / (cur20.length - 1) : 0;
  const currentRealizedVol = Math.sqrt(var20 * 252) * 100;

  const rollingVols252: number[] = [];
  for (let i = 20; i <= logReturns.length; i++) {
    const slice = logReturns.slice(i - 20, i);
    const m = slice.reduce((a, b) => a + b, 0) / 20;
    const v = slice.reduce((a, r) => a + (r - m) ** 2, 0) / Math.max(slice.length - 1, 1);
    rollingVols252.push(Math.sqrt(v * 252) * 100);
  }
  const ivRank = rollingVols252.length > 0
    ? Math.round(rollingVols252.filter(v => v < currentRealizedVol).length / rollingVols252.length * 100)
    : null;
  const ivPercentile = ivRank;

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
    ivRank,
    ivPercentile,
    expectedMove,
    expectedMovePercent,
  };
}

export function calcOptions(
  momentum: MomentumResult,
  volume: VolumeResult,
  volatility: VolatilityResult,
  price: number,
  bars?: OHLCVBar[],
): OptionsResult {
  // ── IV Rank proxy (realized-vol percentile from calcVolatility) ───────────────
  // Low rank = cheap vol (pre-expansion setup), high rank = expensive vol (fade extremes)
  const ivRankProxy = volatility.ivRank ?? 50;

  // ── Realized skew proxy ───────────────────────────────────────────────────────
  // Asymmetry of recent daily returns: positive = more up-days (call demand proxy),
  // negative = more down-days (put demand proxy)
  let realizedSkew = 0;
  if (bars && bars.length >= 21) {
    const recentCloses = bars.slice(-21).map(b => b.close);
    let upDays = 0, dnDays = 0;
    for (let i = 1; i < recentCloses.length; i++) {
      const r = (recentCloses[i] - recentCloses[i - 1]) / recentCloses[i - 1] * 100;
      if (r >  0.1) upDays++;
      else if (r < -0.1) dnDays++;
    }
    const total = upDays + dnDays;
    realizedSkew = total > 0 ? (upDays - dnDays) / total : 0;
  }

  // ── Unusual activity ──────────────────────────────────────────────────────────
  const unusualActivity = volume.relativeVolume > 2.5 && Math.abs(momentum.rsi - 50) > 15;

  // ── Composite score ───────────────────────────────────────────────────────────
  let optionsScore = 50;

  // IV Rank signal: low IV = setup for expansion (bullish for directional plays)
  //                high IV = elevated risk premium, fade extremes
  if      (ivRankProxy < 20) optionsScore += 15;  // very low vol → expansion likely
  else if (ivRankProxy < 35) optionsScore +=  8;  // below-avg vol → mild bullish
  else if (ivRankProxy > 75) optionsScore -= 10;  // high IV → risk premium elevated
  else if (ivRankProxy > 60) optionsScore -=  5;  // above-avg vol → slight headwind

  // Vol squeeze: strongest single predictor of near-term expansion
  if (volatility.volatilitySqueeze) optionsScore += 12;

  // CMF order-flow directional proxy (money flow, not just raw volume)
  optionsScore += volume.chaikinMoneyFlow > 0.15 ? 12
                : volume.chaikinMoneyFlow < -0.15 ? -12
                : Math.round(volume.chaikinMoneyFlow * 60);

  // Realized skew: positive (more up-days) = bullish sentiment proxy
  optionsScore += Math.round(realizedSkew * 10);

  // RSI extremes modulated by IV rank
  if      (momentum.rsiSignal === "oversold"   && ivRankProxy < 40) optionsScore += 12;
  else if (momentum.rsiSignal === "oversold")                        optionsScore +=  6;
  else if (momentum.rsiSignal === "overbought" && ivRankProxy > 60) optionsScore -= 10;
  else if (momentum.rsiSignal === "overbought")                      optionsScore -=  5;

  if (unusualActivity) optionsScore += 5;

  // Proxy levels (best available without real options data)
  const callWall       = volatility.bollingerUpper;
  const putWall        = volatility.bollingerLower;
  const gammaFlipLevel = volatility.bollingerMiddle;

  return {
    putCallRatio:   null,
    maxPain:        null,
    callWall,
    putWall,
    gammaFlipLevel,
    unusualActivity,
    optionsScore:   clamp(optionsScore),
    ivRankProxy,
    realizedSkew:   Math.round(realizedSkew * 100) / 100,
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

  // ── Bullish / Bearish Pennant ─────────────────────────────────────────────────
  // Sharp pole + short symmetrical consolidation (converging highs AND lows)
  // Distinct from Flag: Flag has parallel channels; Pennant has converging trendlines
  if (n >= 20) {
    const poleC  = closes.slice(-20, -5);
    const pMove  = (poleC[poleC.length - 1] - poleC[0]) / poleC[0] * 100;
    const pHigH  = highs.slice(-5);
    const pLowL  = lows.slice(-5);
    const highsConv = pHigH[pHigH.length - 1] < pHigH[0];
    const lowsConv  = pLowL[pLowL.length - 1] > pLowL[0];
    const poleRng = Math.max(...highs.slice(-20, -5)) - Math.min(...lows.slice(-20, -5));
    const consRng = Math.max(...pHigH) - Math.min(...pLowL);
    const tight2  = poleRng > 0 && consRng < poleRng * 0.30;
    if (Math.abs(pMove) > 5 && highsConv && lowsConv && tight2) {
      patterns.push(pMove > 0 ? "Bullish Pennant" : "Bearish Pennant");
    }
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

  // ── Double Top ─────────────────────────────────────────────────────────────────
  // Two roughly-equal highs + meaningful trough between them + price retreating
  if (n >= 20) {
    const dtH = highs.slice(-60);
    const dtLen = dtH.length;
    if (dtLen >= 20) {
      let p1Idx = 0;
      for (let i = 1; i < dtLen; i++) if (dtH[i] > dtH[p1Idx]) p1Idx = i;
      const p1 = dtH[p1Idx];
      if (p1Idx >= 3 && p1Idx <= dtLen - 5) {
        let troughIdx = p1Idx, troughVal = closes[n - dtLen + p1Idx];
        for (let i = p1Idx + 1; i < dtLen - 2; i++) {
          const cv = closes[n - dtLen + i];
          if (cv !== undefined && cv < troughVal) { troughVal = cv; troughIdx = i; }
        }
        const troughDrop = (p1 - troughVal) / p1 * 100;
        if (troughDrop >= 3 && troughIdx > p1Idx) {
          let p2Idx = troughIdx, p2 = dtH[troughIdx] ?? 0;
          for (let i = troughIdx + 1; i < dtLen; i++) if (dtH[i] > p2) { p2 = dtH[i]; p2Idx = i; }
          const peakDiff2 = Math.abs(p2 - p1) / p1 * 100;
          const isRecent2 = p2Idx >= dtLen - 20;
          if (peakDiff2 <= 3.5 && isRecent2 && troughDrop >= 3) patterns.push("Double Top");
        }
      }
    }
  }

  // ── Rectangle / Base ──────────────────────────────────────────────────────────
  // Horizontal consolidation: flat highs AND flat lows for 20 bars
  // Common during institutional accumulation/distribution before breakout
  if (n >= 25) {
    const rH2   = highs.slice(-20), rL2 = lows.slice(-20);
    const maxH2 = Math.max(...rH2),  minH2 = Math.min(...rH2);
    const maxL2 = Math.max(...rL2),  minL2 = Math.min(...rL2);
    const hFlat = maxH2 > 0 && (maxH2 - minH2) / maxH2 < 0.035;
    const lFlat = maxL2 > 0 && (maxL2 - minL2) / maxL2 < 0.035;
    const band  = maxH2 > 0 ? (maxH2 - minL2) / maxH2 : 1;
    if (hFlat && lFlat && band < 0.07) patterns.push("Rectangle Base");
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

  // ── Candlestick patterns (library-based, current bar only) ──────────────────
  if (n >= 5) {
    const ohlc = { open: bars.map(b => b.open), high: highs, low: lows, close: closes };
    // Single-bar reversal candles
    try { if (bullishhammerstick(ohlc).at(-1))      patterns.push("Hammer");               } catch { /* skip */ }
    try { if (bearishhammerstick(ohlc).at(-1))      patterns.push("Inverted Hammer");      } catch { /* skip */ }
    try { if (hangingman(ohlc).at(-1))              patterns.push("Hanging Man");           } catch { /* skip */ }
    try { if (shootingstar(ohlc).at(-1))            patterns.push("Shooting Star");         } catch { /* skip */ }
    try { if (doji(ohlc).at(-1))                    patterns.push("Doji");                  } catch { /* skip */ }
    try { if (dragonflydoji(ohlc).at(-1))           patterns.push("Dragonfly Doji");        } catch { /* skip */ }
    try { if (gravestonedoji(ohlc).at(-1))          patterns.push("Gravestone Doji");       } catch { /* skip */ }
    try { if (bullishmarubozu(ohlc).at(-1))         patterns.push("Bullish Marubozu");      } catch { /* skip */ }
    try { if (bearishmarubozu(ohlc).at(-1))         patterns.push("Bearish Marubozu");      } catch { /* skip */ }
    try { if (bullishinvertedhammerstick(ohlc).at(-1)) patterns.push("Bullish Inv Hammer"); } catch { /* skip */ }
    try { if (bearishinvertedhammerstick(ohlc).at(-1)) patterns.push("Bearish Inv Hammer"); } catch { /* skip */ }
    try { if (bullishspinningtop(ohlc).at(-1))      patterns.push("Bullish Spinning Top");  } catch { /* skip */ }
    try { if (bearishspinningtop(ohlc).at(-1))      patterns.push("Bearish Spinning Top");  } catch { /* skip */ }
    // Two-bar reversal patterns
    try { if (bullishengulfingpattern(ohlc).at(-1)) patterns.push("Bullish Engulfing");     } catch { /* skip */ }
    try { if (bearishengulfingpattern(ohlc).at(-1)) patterns.push("Bearish Engulfing");     } catch { /* skip */ }
    try { if (bullishharami(ohlc).at(-1))           patterns.push("Bullish Harami");        } catch { /* skip */ }
    try { if (bearishharami(ohlc).at(-1))           patterns.push("Bearish Harami");        } catch { /* skip */ }
    try { if (bullishharamicross(ohlc).at(-1))      patterns.push("Bullish Harami Cross");  } catch { /* skip */ }
    try { if (bearishharamicross(ohlc).at(-1))      patterns.push("Bearish Harami Cross");  } catch { /* skip */ }
    try { if (piercingline(ohlc).at(-1))            patterns.push("Piercing Line");         } catch { /* skip */ }
    try { if (darkcloudcover(ohlc).at(-1))          patterns.push("Dark Cloud Cover");      } catch { /* skip */ }
    try { if (tweezertop(ohlc).at(-1))              patterns.push("Tweezer Top");           } catch { /* skip */ }
    try { if (tweezerbottom(ohlc).at(-1))           patterns.push("Tweezer Bottom");        } catch { /* skip */ }
    try { if (downsidetasukigap(ohlc).at(-1))       patterns.push("Downside Tasuki Gap");   } catch { /* skip */ }
    // Three-bar reversal patterns
    try { if (threewhitesoldiers(ohlc).at(-1))      patterns.push("Three White Soldiers");  } catch { /* skip */ }
    try { if (threeblackcrows(ohlc).at(-1))         patterns.push("Three Black Crows");     } catch { /* skip */ }
    try { if (morningstar(ohlc).at(-1))             patterns.push("Morning Star");          } catch { /* skip */ }
    try { if (eveningstar(ohlc).at(-1))             patterns.push("Evening Star");          } catch { /* skip */ }
    try { if (morningdojistar(ohlc).at(-1))         patterns.push("Morning Doji Star");     } catch { /* skip */ }
    try { if (eveningdojistar(ohlc).at(-1))         patterns.push("Evening Doji Star");     } catch { /* skip */ }
    try { if (abandonedbaby(ohlc).at(-1))           patterns.push("Abandoned Baby");        } catch { /* skip */ }
  }

  return {
    patterns: [...new Set(patterns)].slice(0, 20),
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
    if (prev?.histogram == null || curr?.histogram == null) continue;
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

// ── Feature: Fibonacci Retracement Levels ────────────────────────────────────

export interface FibLevel {
  ratio: number;
  price: number;
  label: string;
}

export interface FibLevelsResult {
  swingHigh: number;
  swingLow: number;
  /** Whether price is retracing from a high (down) or recovering from a low (up) */
  trend: "up" | "down";
  levels: FibLevel[];
}

/**
 * Compute Fibonacci retracement levels from the 100-bar swing high/low.
 * For an uptrend: standard retracements from high down (23.6%–78.6%).
 * For a downtrend: standard retracements from low up.
 */
export function calcFibLevels(bars: OHLCVBar[]): FibLevelsResult {
  const lookback    = Math.min(bars.length, 100);
  const recentBars  = bars.slice(-lookback);
  const highs = recentBars.map(b => b.high);
  const lows  = recentBars.map(b => b.low);

  const swingHigh = Math.max(...highs);
  const swingLow  = Math.min(...lows);
  const range     = swingHigh - swingLow;

  const highIdx   = highs.indexOf(swingHigh);
  const lowIdx    = lows.indexOf(swingLow);
  const trend: FibLevelsResult["trend"] = lowIdx < highIdx ? "up" : "down";

  const FIB_RATIOS: { ratio: number; label: string }[] = [
    { ratio: 0,     label: "0%"     },
    { ratio: 0.236, label: "23.6%"  },
    { ratio: 0.382, label: "38.2%"  },
    { ratio: 0.500, label: "50%"    },
    { ratio: 0.618, label: "61.8%"  },
    { ratio: 0.786, label: "78.6%"  },
    { ratio: 1,     label: "100%"   },
    { ratio: 1.272, label: "127.2%" },
    { ratio: 1.618, label: "161.8%" },
  ];

  const levels: FibLevel[] = FIB_RATIOS.map(({ ratio, label }) => {
    const price = trend === "up"
      ? swingHigh - ratio * range          // retracing down from high
      : swingLow  + ratio * range;         // recovering up from low
    return { ratio, price: Math.round(price * 100) / 100, label };
  });

  return {
    swingHigh: Math.round(swingHigh * 100) / 100,
    swingLow:  Math.round(swingLow  * 100) / 100,
    trend,
    levels,
  };
}

// ── Feature: Volume Profile (VAP / POC / VAH / VAL) ──────────────────────────

export interface VolumeBin {
  priceLevel: number;
  volume: number;
  /** % of total profile volume in this bucket */
  pct: number;
}

export interface VolumeProfileResult {
  /** Point of Control — price level with highest traded volume */
  poc: number;
  /** Value Area High — upper boundary of 70% volume zone */
  vah: number;
  /** Value Area Low — lower boundary of 70% volume zone */
  val: number;
  bins: VolumeBin[];
}

/**
 * Compute a price×volume histogram (Volume at Price) over the last `lookbackBars`.
 * The Value Area is the contiguous price range around the POC that contains ≥70%
 * of total volume — the institutional "fair value" zone.
 */
export function calcVolumeProfile(bars: OHLCVBar[], numBuckets = 24, lookbackBars = 60): VolumeProfileResult {
  const recentBars = bars.slice(-Math.min(bars.length, lookbackBars));
  const allHighs   = recentBars.map(b => b.high);
  const allLows    = recentBars.map(b => b.low);
  const rangeHigh  = Math.max(...allHighs);
  const rangeLow   = Math.min(...allLows);
  const bucketSize = (rangeHigh - rangeLow) / numBuckets;

  if (bucketSize <= 0 || !isFinite(bucketSize)) {
    const price = recentBars[recentBars.length - 1]?.close ?? 0;
    return { poc: price, vah: price, val: price, bins: [] };
  }

  // Distribute each bar's volume proportionally across the price buckets it spans
  const bucketVolumes = new Float64Array(numBuckets);
  for (const bar of recentBars) {
    const barRange = bar.high - bar.low;
    for (let b = 0; b < numBuckets; b++) {
      const bLow  = rangeLow + b * bucketSize;
      const bHigh = bLow + bucketSize;
      const overlap = Math.max(0, Math.min(bar.high, bHigh) - Math.max(bar.low, bLow));
      const fraction = barRange > 0 ? overlap / barRange : 1 / numBuckets;
      bucketVolumes[b] += bar.volume * fraction;
    }
  }

  const totalVol = bucketVolumes.reduce((a, b) => a + b, 0);

  // POC — highest-volume bucket
  let pocBucket = 0;
  for (let i = 1; i < numBuckets; i++) {
    if (bucketVolumes[i] > bucketVolumes[pocBucket]) pocBucket = i;
  }
  const poc = rangeLow + (pocBucket + 0.5) * bucketSize;

  // Value Area expansion from POC outward until 70% of volume is captured
  let vaVol = bucketVolumes[pocBucket];
  const vaTarget = totalVol * 0.70;
  let vaLow = pocBucket, vaHigh = pocBucket;

  while (vaVol < vaTarget && (vaLow > 0 || vaHigh < numBuckets - 1)) {
    const nextLow  = vaLow  > 0             ? bucketVolumes[vaLow  - 1] : -1;
    const nextHigh = vaHigh < numBuckets - 1 ? bucketVolumes[vaHigh + 1] : -1;
    if (nextHigh >= nextLow && nextHigh >= 0) { vaHigh++; vaVol += bucketVolumes[vaHigh]; }
    else if (nextLow  >= 0)                   { vaLow--;  vaVol += bucketVolumes[vaLow];  }
    else break;
  }

  const vah = rangeLow + (vaHigh + 1) * bucketSize;
  const val = rangeLow +  vaLow       * bucketSize;

  const bins: VolumeBin[] = Array.from(bucketVolumes).map((vol, i) => ({
    priceLevel: Math.round((rangeLow + (i + 0.5) * bucketSize) * 100) / 100,
    volume:     Math.round(vol),
    pct:        totalVol > 0 ? Math.round(vol / totalVol * 1000) / 10 : 0,
  }));

  return {
    poc: Math.round(poc * 100) / 100,
    vah: Math.round(vah * 100) / 100,
    val: Math.round(val * 100) / 100,
    bins,
  };
}

// ── Feature: Multi-Timeframe Weekly Context ───────────────────────────────────

export interface WeeklyContextResult {
  weeklyTrend: "strong_up" | "up" | "neutral" | "down" | "strong_down";
  weeklyRsi: number;
  weeklyMacdBullish: boolean;
  weeklyAboveSma20: boolean;
  weeklyAboveSma50: boolean;
  /** Synthesized alignment of the 4 weekly signals (bullish / bearish / neutral) */
  weeklyAlignment: "bullish" | "bearish" | "neutral";
}

/**
 * Derive weekly-timeframe trend/momentum context from weekly OHLCV bars.
 * Returns a WeeklyContextResult for the MTF alignment badge in the Dashboard.
 */
export function calcWeeklyContext(weeklyBars: OHLCVBar[]): WeeklyContextResult | null {
  if (weeklyBars.length < 10) return null;

  const closes = weeklyBars.map(b => b.close);
  const price  = closes[closes.length - 1];

  const sma20Period = Math.min(20, closes.length - 1);
  const sma50Period = Math.min(50, closes.length - 1);

  const wSma20Arr = SMA.calculate({ values: closes, period: sma20Period });
  const wSma50Arr = SMA.calculate({ values: closes, period: sma50Period });
  const wSma20    = last(wSma20Arr) ?? price;
  const wSma50    = last(wSma50Arr) ?? price;

  const rsiPeriod = Math.min(14, closes.length - 2);
  const rsiArr    = RSI.calculate({ values: closes, period: rsiPeriod });
  const weeklyRsi = Math.round((last(rsiArr) ?? 50) * 10) / 10;

  let weeklyMacdBullish = false;
  if (closes.length >= 30) {
    const macdArr = MACD.calculate({
      values: closes,
      fastPeriod: 12, slowPeriod: 26, signalPeriod: 9,
      SimpleMAOscillator: false, SimpleMASignal: false,
    });
    const mv = last(macdArr);
    weeklyMacdBullish = mv ? (mv.MACD ?? 0) > (mv.signal ?? 0) : false;
  }

  const weeklyAboveSma20 = price > wSma20;
  const weeklyAboveSma50 = price > wSma50;

  // Composite: count how many weekly signals agree
  const bullCount =
    (weeklyAboveSma20 ? 1 : 0) +
    (weeklyAboveSma50 ? 1 : 0) +
    (weeklyRsi > 50   ? 1 : 0) +
    (weeklyMacdBullish ? 1 : 0);

  let weeklyTrend: WeeklyContextResult["weeklyTrend"] = "neutral";
  if      (weeklyAboveSma20 && weeklyAboveSma50 && weeklyRsi > 55) weeklyTrend = weeklyRsi > 65 ? "strong_up"   : "up";
  else if (!weeklyAboveSma20 && !weeklyAboveSma50 && weeklyRsi < 45) weeklyTrend = weeklyRsi < 35 ? "strong_down" : "down";

  const weeklyAlignment: WeeklyContextResult["weeklyAlignment"] =
    bullCount >= 3 ? "bullish" : bullCount <= 1 ? "bearish" : "neutral";

  return {
    weeklyTrend,
    weeklyRsi,
    weeklyMacdBullish,
    weeklyAboveSma20,
    weeklyAboveSma50,
    weeklyAlignment,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Multi-Timeframe Market Cycle Analysis (Weinstein Stage Analysis)
// ─────────────────────────────────────────────────────────────────────────────

export interface MarketCycleResult {
  /** Weinstein stage the stock currently occupies */
  cyclePhase: "accumulation" | "markup" | "distribution" | "markdown" | "ranging";
  /** 0–100 confidence in the cycle-phase assignment */
  cycleStrength: number;
  /** % distance from 52-week high — negative means below (e.g. -10 = 10% below) */
  distFrom52wHigh: number;
  /** % distance above 52-week low */
  distFrom52wLow: number;
  /** Weekly SMA-40 value (proxy for the 200-day MA on a weekly chart) */
  sma40Weekly: number;
  /** Whether the weekly SMA-40 is in a rising slope */
  sma40Rising: boolean;
  /** % of price relative to weekly SMA-40 */
  priceVsSma40Weekly: number;
  /** Chart patterns detected on the weekly timeframe */
  weeklyPatterns: string[];
  /** RSI computed on weekly closes */
  weeklyRsi: number;
}

/**
 * Analyse where a stock is in its long-term market cycle using weekly OHLCV
 * bars.  Returns null when fewer than 20 weekly bars are available.
 *
 * Logic uses Weinstein's Stage Analysis:
 *   Stage 1 — Accumulation:  base-building near 52-week lows, flat SMA-40
 *   Stage 2 — Markup:        above rising SMA-40, higher-highs / higher-lows
 *   Stage 3 — Distribution:  extended at highs, SMA-40 flattening, weakening
 *   Stage 4 — Markdown:      below declining SMA-40, lower-highs / lower-lows
 */
export function calcMarketCycle(weeklyBars: OHLCVBar[]): MarketCycleResult | null {
  if (weeklyBars.length < 20) return null;

  const closes  = weeklyBars.map(b => b.close);
  const highs   = weeklyBars.map(b => b.high);
  const lows    = weeklyBars.map(b => b.low);
  const volumes = weeklyBars.map(b => b.volume);
  const n       = closes.length;
  const price   = closes[n - 1];

  // ── 52-week high / low ───────────────────────────────────────────────────
  const lb52    = Math.min(52, n);
  const high52  = Math.max(...highs.slice(-lb52));
  const low52   = Math.min(...lows.slice(-lb52));
  const distFrom52wHigh = (price - high52) / high52 * 100;   // ≤0
  const distFrom52wLow  = (price - low52)  / low52  * 100;   // ≥0

  // ── Weekly SMA-40 (≈ 200-day MA) ─────────────────────────────────────────
  const sma40Period  = Math.min(40, n - 1);
  const sma40Arr     = SMA.calculate({ values: closes, period: sma40Period });
  const sma40Weekly  = last(sma40Arr) ?? price;
  const sma40Prev    = sma40Arr[Math.max(0, sma40Arr.length - 7)] ?? sma40Weekly;
  const sma40Rising  = sma40Weekly > sma40Prev;
  const priceVsSma40Weekly = sma40Weekly > 0 ? (price - sma40Weekly) / sma40Weekly * 100 : 0;

  // ── Weekly SMA-10 (≈ 50-day MA) ──────────────────────────────────────────
  const sma10Period = Math.min(10, n - 1);
  const sma10Arr    = SMA.calculate({ values: closes, period: sma10Period });
  const sma10Weekly = last(sma10Arr) ?? price;

  // ── Weekly RSI ────────────────────────────────────────────────────────────
  const rsiPeriod = Math.min(14, n - 2);
  const rsiArr    = RSI.calculate({ values: closes, period: rsiPeriod });
  const weeklyRsi = Math.round((last(rsiArr) ?? 50) * 10) / 10;

  // ── Higher-highs / lower-lows (last 20 weekly bars) ─────────────────────
  const lb20    = Math.min(20, n);
  const rH      = highs.slice(-lb20);
  const rL      = lows.slice(-lb20);
  const higherHighs = rH[rH.length - 1] > rH[0];
  const higherLows  = rL[rL.length - 1] > rL[0];
  const lowerHighs  = rH[rH.length - 1] < rH[0];
  const lowerLows   = rL[rL.length - 1] < rL[0];

  // ── Volume expansion check (last 4 vs prior 12 weeks) ───────────────────
  const slice4   = volumes.slice(-4);
  const slice12  = volumes.slice(-16, -4);
  const recentVol = slice4.reduce((a, b)  => a + b, 0) / slice4.length;
  const priorVol  = slice12.reduce((a, b) => a + b, 0) / Math.max(slice12.length, 1);
  const volExpanding = recentVol > priorVol * 1.1;

  // ── Weinstein Stage Assignment ────────────────────────────────────────────
  const aboveSma40 = price > sma40Weekly;
  const aboveSma10 = price > sma10Weekly;
  const nearHigh52 = distFrom52wHigh > -15;
  const nearLow52  = distFrom52wLow  <  35;

  let cyclePhase: MarketCycleResult["cyclePhase"];
  let cycleStrength: number;

  if (aboveSma40 && sma40Rising && higherHighs && higherLows && aboveSma10) {
    // Stage 2 — Markup: above rising 200d proxy, uptrend structure intact
    cyclePhase    = "markup";
    cycleStrength = Math.min(95, 60 + (nearHigh52 ? 15 : 0) + (volExpanding ? 15 : 0) + (weeklyRsi > 55 ? 5 : 0));
  } else if (!aboveSma40 && !sma40Rising && lowerHighs && lowerLows) {
    // Stage 4 — Markdown: below declining 200d proxy, downtrend structure
    cyclePhase    = "markdown";
    cycleStrength = Math.min(95, 65 + (weeklyRsi < 45 ? 15 : 0) + (!nearLow52 ? 10 : 0));
  } else if (aboveSma40 && nearHigh52 && (!sma40Rising || weeklyRsi > 68)) {
    // Stage 3 — Distribution: extended at highs, momentum or slope weakening
    cyclePhase    = "distribution";
    cycleStrength = Math.min(85, 55 + (volExpanding && !higherHighs ? 20 : 0) + (weeklyRsi > 72 ? 10 : 0));
  } else if (!aboveSma40 && nearLow52 && weeklyRsi < 52) {
    // Stage 1 — Accumulation: base-building near lows, below flat/declining SMA
    cyclePhase    = "accumulation";
    cycleStrength = Math.min(80, 50 + (volExpanding ? 15 : 0) + (!lowerLows ? 15 : 0));
  } else {
    // Transitional / undefined
    cyclePhase    = "ranging";
    cycleStrength = 40;
  }

  // ── Weekly chart pattern detection ────────────────────────────────────────
  const weeklyPatterns: string[] = [];

  try {
    // Golden / Death Cross on weekly (SMA10 vs SMA40)
    if      (aboveSma10 && sma10Weekly > sma40Weekly) weeklyPatterns.push("Weekly Golden Cross");
    else if (!aboveSma10 && sma10Weekly < sma40Weekly) weeklyPatterns.push("Weekly Death Cross");

    // Bollinger Band signals (20-week bands)
    if (n >= 20) {
      const bbArr = BollingerBands.calculate({ values: closes, period: 20, stdDev: 2 });
      const bb    = last(bbArr);
      if (bb) {
        if (price > bb.upper) weeklyPatterns.push("Weekly BB Breakout");
        if (price < bb.lower) weeklyPatterns.push("Weekly BB Breakdown");
        if (bb.upper > bb.lower && (bb.upper - bb.lower) / bb.middle < 0.08)
          weeklyPatterns.push("Weekly Volatility Squeeze");
      }
    }

    // Bull / Bear Flag on weekly (strong 12-week pole → 6-week tight flag)
    if (n >= 25) {
      const poleCloses = closes.slice(-20, -6);
      const flagHighs  = highs.slice(-6);
      const flagLows   = lows.slice(-6);
      const poleGain   = poleCloses.length > 1
        ? (poleCloses[poleCloses.length - 1] - poleCloses[0]) / poleCloses[0] * 100 : 0;
      const poleRange  = Math.max(...highs.slice(-20, -6)) - Math.min(...lows.slice(-20, -6));
      const flagRange  = Math.max(...flagHighs) - Math.min(...flagLows);
      const tightFlag  = poleRange > 0 && flagRange < poleRange * 0.45;
      const volLow     = volumes.slice(-6).reduce((a, b) => a + b, 0) / 6
                       < volumes.slice(-20, -6).reduce((a, b) => a + b, 0) / 14 * 0.75;
      if (poleGain > 8  && tightFlag && volLow) weeklyPatterns.push("Weekly Bull Flag");
      if (poleGain < -8 && tightFlag && volLow) weeklyPatterns.push("Weekly Bear Flag");
    }

    // Ascending / Descending Triangle (20 weeks)
    if (n >= 20) {
      const tH   = highs.slice(-20), tL = lows.slice(-20);
      const maxH = Math.max(...tH),  minH = Math.min(...tH);
      const maxL = Math.max(...tL),  minL = Math.min(...tL);
      const flatTop     = maxH > 0 && (maxH - minH) / maxH < 0.04;
      const risingLows  = tL[tL.length - 1] > tL[0] + (maxL - minL) * 0.3;
      const flatBot     = maxL > 0 && (maxL - minL) / maxL < 0.04;
      const fallingHighs = tH[tH.length - 1] < tH[0] - (maxH - minH) * 0.3;
      if (flatTop  && risingLows)  weeklyPatterns.push("Weekly Ascending Triangle");
      if (flatBot  && fallingHighs) weeklyPatterns.push("Weekly Descending Triangle");
    }

    // Cup & Handle on weekly (40-bar cup, 10-bar handle)
    if (n >= 45) {
      const cupC  = closes.slice(-40, -10);
      const cupH  = highs.slice(-40,  -10);
      const cupMax = Math.max(...cupH);
      const midMin = Math.min(...closes.slice(-30, -15));
      const isU    = midMin < cupMax * 0.90 && cupC[cupC.length - 1] > cupMax * 0.94;
      if (isU) {
        const handleMin = Math.min(...lows.slice(-10));
        if (handleMin > cupMax * 0.87) weeklyPatterns.push("Weekly Cup and Handle");
      }
    }

    // Double Bottom on weekly (last 50 bars)
    if (n >= 25) {
      const dbLows = lows.slice(-50);
      const dbLen  = dbLows.length;
      let v1Idx = 0;
      for (let i = 1; i < dbLen; i++) if (dbLows[i] < dbLows[v1Idx]) v1Idx = i;
      const v1 = dbLows[v1Idx];
      if (v1Idx >= 3 && v1Idx <= dbLen - 8) {
        const sliceClose = closes.slice(-(50 - v1Idx));
        let peakVal = v1, peakIdx = v1Idx;
        for (let i = v1Idx + 1; i < dbLen - 3; i++) {
          const cv = closes[n - dbLen + i];
          if (cv !== undefined && cv > peakVal) { peakVal = cv; peakIdx = i; }
        }
        if ((peakVal - v1) / v1 * 100 >= 5 && peakIdx > v1Idx) {
          let v2 = dbLows[peakIdx], v2Idx = peakIdx;
          for (let i = peakIdx + 1; i < dbLen; i++) if (dbLows[i] < v2) { v2 = dbLows[i]; v2Idx = i; }
          if (Math.abs(v2 - v1) / v1 * 100 <= 6 && v2Idx >= dbLen - 20)
            weeklyPatterns.push("Weekly Double Bottom");
        }
        void sliceClose;
      }
    }

    // Double Top on weekly (last 50 bars)
    if (n >= 25) {
      const dtHighs = highs.slice(-50);
      const dtLen   = dtHighs.length;
      let p1Idx = 0;
      for (let i = 1; i < dtLen; i++) if (dtHighs[i] > dtHighs[p1Idx]) p1Idx = i;
      const p1 = dtHighs[p1Idx];
      if (p1Idx >= 3 && p1Idx <= dtLen - 8) {
        let troughVal = closes[n - dtLen + p1Idx] ?? p1, troughIdx = p1Idx;
        for (let i = p1Idx + 1; i < dtLen - 3; i++) {
          const cv = closes[n - dtLen + i];
          if (cv !== undefined && cv < troughVal) { troughVal = cv; troughIdx = i; }
        }
        if ((p1 - troughVal) / p1 * 100 >= 5 && troughIdx > p1Idx) {
          let p2 = dtHighs[troughIdx], p2Idx = troughIdx;
          for (let i = troughIdx + 1; i < dtLen; i++) if (dtHighs[i] > p2) { p2 = dtHighs[i]; p2Idx = i; }
          if (Math.abs(p2 - p1) / p1 * 100 <= 6 && p2Idx >= dtLen - 20)
            weeklyPatterns.push("Weekly Double Top");
        }
      }
    }

    // Head & Shoulders / Inverse H&S on weekly
    if (n >= 30) {
      const hsH = highs.slice(-30), hsL = lows.slice(-30);
      const hl  = hsH.length;
      const mid = Math.floor(hl / 2);
      const leftH  = Math.max(...hsH.slice(0, mid - 4));
      const head   = Math.max(...hsH.slice(mid - 4, mid + 4));
      const rightH = Math.max(...hsH.slice(mid + 4));
      const leftL  = Math.min(...hsL.slice(0, mid - 4));
      const headL  = Math.min(...hsL.slice(mid - 4, mid + 4));
      const rightL = Math.min(...hsL.slice(mid + 4));
      // H&S: head > shoulders, shoulders similar
      if (head > leftH * 1.03 && head > rightH * 1.03 && Math.abs(leftH - rightH) / head < 0.06)
        weeklyPatterns.push("Weekly Head and Shoulders");
      // Inv H&S: head below shoulders
      if (headL < leftL * 0.97 && headL < rightL * 0.97 && Math.abs(leftL - rightL) / Math.max(leftL, 1) < 0.06)
        weeklyPatterns.push("Weekly Inv Head and Shoulders");
    }
  } catch {
    // pattern detection failures are non-fatal
  }

  return {
    cyclePhase,
    cycleStrength,
    distFrom52wHigh,
    distFrom52wLow,
    sma40Weekly,
    sma40Rising,
    priceVsSma40Weekly,
    weeklyPatterns,
    weeklyRsi,
  };
}

// ── Recent Candle Structure ───────────────────────────────────────────────────

export interface CandleBar {
  date:          string;
  direction:     "up" | "down" | "doji";
  bodyPct:       number;       // % change open → close
  upperWickPct:  number;       // upper wick as % of full candle range
  lowerWickPct:  number;       // lower wick as % of full candle range
  volumeVsAvg:   number;       // volume / 20-day avg volume
  gapPct:        number;       // (open − prev close) / prev close × 100
}

export interface RecentCandleStructure {
  last5Bars:           CandleBar[];
  distributionCandles: number;   // upper wick >40% of range in last 5 bars
  climaxBars:          number;   // vol >2× avg AND green in last 5 (buying climax)
  downDayVolumeRatio:  number;   // avg vol on red / avg vol on green (last 10 bars)
  parabolicMovePct:    number;   // max % gain from any 60-bar rolling low → subsequent high
  parabolicMoveDays:   number;   // trading days that move took
  consecutiveRedDays:  number;   // current streak of red closes
  priceExtensionPct:   number;   // % above 20-day SMA
  largestGapPct:       number;   // largest positive gap (open > prev close) in last 5 bars
}

export function calcRecentCandleStructure(bars: OHLCVBar[]): RecentCandleStructure | null {
  if (bars.length < 30) return null;

  const len      = bars.length;
  const avgVol20 = bars.slice(-20).reduce((s, b) => s + b.volume, 0) / 20;
  const sma20    = bars.slice(-20).reduce((s, b) => s + b.close,  0) / 20;
  const last5    = bars.slice(-5);
  const last10   = bars.slice(-10);
  const current  = bars[len - 1];

  // Per-candle summary for last 5 bars ─────────────────────────────────────
  const last5Bars: CandleBar[] = last5.map((b, i) => {
    const prevClose   = i === 0 ? (bars[len - 6]?.close ?? b.open) : last5[i - 1].close;
    const range       = b.high - b.low;
    const bodyAbs     = Math.abs(b.close - b.open);
    const bodyPct     = b.open > 0 ? ((b.close - b.open) / b.open) * 100 : 0;
    const upperWick   = range > 0 ? ((b.high - Math.max(b.open, b.close)) / range) * 100 : 0;
    const lowerWick   = range > 0 ? ((Math.min(b.open, b.close) - b.low) / range) * 100 : 0;
    const volumeVsAvg = avgVol20 > 0 ? b.volume / avgVol20 : 1;
    const gapPct      = prevClose > 0 ? ((b.open - prevClose) / prevClose) * 100 : 0;
    const direction: "up" | "down" | "doji" =
      range > 0 && bodyAbs / range < 0.1 ? "doji"
      : b.close >= b.open ? "up" : "down";
    return {
      date:         b.time,
      direction,
      bodyPct:      +bodyPct.toFixed(2),
      upperWickPct: +upperWick.toFixed(1),
      lowerWickPct: +lowerWick.toFixed(1),
      volumeVsAvg:  +volumeVsAvg.toFixed(2),
      gapPct:       +gapPct.toFixed(2),
    };
  });

  // Distribution candles — seller rejection at highs
  const distributionCandles = last5Bars.filter(b => b.upperWickPct > 40).length;

  // Buying climax — high-volume green bars (buyer exhaustion)
  const climaxBars = last5.filter(b => b.close >= b.open && b.volume > avgVol20 * 2).length;

  // Down-day / up-day volume ratio over last 10 bars
  const downBars   = last10.filter(b => b.close < b.open);
  const upBars     = last10.filter(b => b.close >= b.open);
  const avgDownVol = downBars.length > 0 ? downBars.reduce((s, b) => s + b.volume, 0) / downBars.length : 0;
  const avgUpVol   = upBars.length   > 0 ? upBars.reduce((s, b)   => s + b.volume, 0) / upBars.length   : 1;
  const downDayVolumeRatio = +(avgDownVol / Math.max(avgUpVol, 1)).toFixed(2);

  // Parabolic move: max % gain from any local low → subsequent high in last 60 bars
  const lookback = bars.slice(-60);
  let parabolicMovePct  = 0;
  let parabolicMoveDays = 0;
  for (let i = 1; i < lookback.length - 3; i++) {
    const prevLow = lookback[i - 1]?.low ?? Infinity;
    const nextLow = lookback[i + 1]?.low ?? Infinity;
    if (lookback[i].low < prevLow && lookback[i].low < nextLow) {
      const base = lookback[i].low;
      for (let j = i + 3; j < lookback.length; j++) {
        const movePct = ((lookback[j].high - base) / base) * 100;
        if (movePct > parabolicMovePct) {
          parabolicMovePct  = movePct;
          parabolicMoveDays = j - i;
        }
      }
    }
  }

  // Consecutive red closes from most recent bar backwards
  let consecutiveRedDays = 0;
  for (let i = len - 1; i >= 0; i--) {
    if (bars[i].close < bars[i].open) consecutiveRedDays++;
    else break;
  }

  const priceExtensionPct = +(sma20 > 0 ? ((current.close - sma20) / sma20) * 100 : 0).toFixed(1);
  const largestGapPct     = +Math.max(0, ...last5Bars.map(b => b.gapPct)).toFixed(2);

  return {
    last5Bars,
    distributionCandles,
    climaxBars,
    downDayVolumeRatio,
    parabolicMovePct:  +parabolicMovePct.toFixed(1),
    parabolicMoveDays,
    consecutiveRedDays,
    priceExtensionPct,
    largestGapPct,
  };
}

import { ADX } from "technicalindicators";
import type { OHLCVBar } from "./marketData.js";
import type { TrendResult, MomentumResult, VolumeResult, ExhaustionResult } from "./indicators.js";

export interface PullbackSignal {
  label: string;
  sentiment: "bullish" | "bearish" | "neutral";
}

export interface PullbackReversalResult {
  classification: "pullback" | "reversal" | "ambiguous";
  pullbackScore: number;
  keySignals: PullbackSignal[];
  summary: string;
}

export function calcPullbackReversal(
  bars: OHLCVBar[],
  trend: TrendResult,
  momentum: MomentumResult,
  volume: VolumeResult,
  exhaustion: ExhaustionResult,
): PullbackReversalResult {
  const highs  = bars.map(b => b.high);
  const lows   = bars.map(b => b.low);
  const closes = bars.map(b => b.close);

  const adxArr  = ADX.calculate({ high: highs, low: lows, close: closes, period: 14 });
  const stockAdx = adxArr.length > 0 ? (adxArr[adxArr.length - 1].adx ?? 20) : 20;

  let score = 50;
  const signals: PullbackSignal[] = [];

  // ── Trend structure (±22) ─────────────────────────────────────────────
  if (trend.priceVsSma50 > 0) {
    score += 6;
    signals.push({ label: "Price above SMA50", sentiment: "bullish" });
  } else if (trend.priceVsSma50 > -5) {
    score += 2;
    signals.push({ label: `Price testing SMA50 (${trend.priceVsSma50.toFixed(1)}%)`, sentiment: "neutral" });
  } else {
    score -= 8;
    signals.push({ label: `Price ${Math.abs(trend.priceVsSma50).toFixed(1)}% below SMA50`, sentiment: "bearish" });
  }

  if (trend.sma20 > trend.sma50) {
    score += 5;
    signals.push({ label: "SMA20 > SMA50 — uptrend aligned", sentiment: "bullish" });
  } else {
    score -= 5;
    signals.push({ label: "SMA20 < SMA50 — MAs crossed down", sentiment: "bearish" });
  }

  if (trend.deathCross) {
    score -= 10;
    signals.push({ label: "Death cross — major reversal warning", sentiment: "bearish" });
  } else if (trend.goldenCross) {
    score += 6;
    signals.push({ label: "Golden cross — trend turning up", sentiment: "bullish" });
  }

  if (trend.priceVsSma200 < -10) {
    score -= 5;
    signals.push({ label: `Price ${Math.abs(trend.priceVsSma200).toFixed(1)}% below SMA200`, sentiment: "bearish" });
  }

  // ── RSI (±18) ─────────────────────────────────────────────────────────
  const rsi = momentum.rsi;
  if (rsi >= 35 && rsi <= 55) {
    score += 12;
    signals.push({ label: `RSI ${rsi.toFixed(0)} — healthy correction zone`, sentiment: "bullish" });
  } else if (rsi > 55 && rsi < 70) {
    score += 4;
  } else if (rsi >= 25 && rsi < 35) {
    score += 3;
    signals.push({ label: `RSI ${rsi.toFixed(0)} — oversold, possible bottom`, sentiment: "neutral" });
  } else if (rsi < 25) {
    score -= 8;
    signals.push({ label: `RSI ${rsi.toFixed(0)} — deeply oversold, breakdown risk`, sentiment: "bearish" });
  }

  if (momentum.rsiDivergence === "bullish") {
    score += 8;
    signals.push({ label: `Bullish RSI divergence${momentum.rsiDivergenceStrength === "strong" ? " (strong)" : ""}`, sentiment: "bullish" });
  } else if (momentum.rsiDivergence === "bearish") {
    score -= 10;
    signals.push({ label: `Bearish RSI divergence${momentum.rsiDivergenceStrength === "strong" ? " (strong)" : ""}`, sentiment: "bearish" });
  }

  // ── MACD (±16) ────────────────────────────────────────────────────────
  if (momentum.macdHistogram > 0) {
    score += 8;
    signals.push({ label: "MACD histogram positive — momentum intact", sentiment: "bullish" });
  } else if (momentum.macdHistogram > -0.3) {
    score += 1;
  } else {
    score -= 7;
    signals.push({ label: "MACD histogram negative — momentum fading", sentiment: "bearish" });
  }

  if (momentum.macdCrossover === "bullish") {
    score += 6;
    signals.push({ label: "MACD bullish crossover", sentiment: "bullish" });
  } else if (momentum.macdCrossover === "bearish") {
    score -= 10;
    signals.push({ label: "MACD bearish crossover — momentum shift", sentiment: "bearish" });
  }

  // ── OBV / money flow (±15) ────────────────────────────────────────────
  if (volume.obvTrend === "rising") {
    score += 10;
    signals.push({ label: "OBV rising — institutional accumulation intact", sentiment: "bullish" });
  } else if (volume.obvTrend === "flat") {
    score += 1;
  } else {
    score -= 10;
    signals.push({ label: "OBV falling — distribution detected", sentiment: "bearish" });
  }

  const cmf = volume.chaikinMoneyFlow;
  if (cmf > 0.1) {
    score += 4;
    signals.push({ label: `Chaikin MF +${cmf.toFixed(2)} — net inflow`, sentiment: "bullish" });
  } else if (cmf < -0.1) {
    score -= 5;
    signals.push({ label: `Chaikin MF ${cmf.toFixed(2)} — net outflow`, sentiment: "bearish" });
  }

  // ── ADX / trend strength (±10) ────────────────────────────────────────
  if (stockAdx > 25) {
    score += 8;
    signals.push({ label: `ADX ${stockAdx.toFixed(0)} — strong trend (dip buyable)`, sentiment: "bullish" });
  } else if (stockAdx >= 18) {
    score += 2;
  } else {
    score -= 5;
    signals.push({ label: `ADX ${stockAdx.toFixed(0)} — trend weakening`, sentiment: "bearish" });
  }

  // ── Exhaustion / capitulation (±12) ───────────────────────────────────
  if (exhaustion.capitulationVolume) {
    score += 10;
    signals.push({ label: "Capitulation volume — potential panic bottom", sentiment: "bullish" });
  }
  if (exhaustion.exhaustionScore > 65) {
    score += 4;
    signals.push({ label: `Exhaustion score ${exhaustion.exhaustionScore} — oversold setup`, sentiment: "bullish" });
  }
  if (exhaustion.distributionTop) {
    score -= 8;
    signals.push({ label: "Distribution top — trend likely ending", sentiment: "bearish" });
  }
  if (exhaustion.consecutiveDownDays >= 4 && rsi < 45) {
    score += 3;
    signals.push({ label: `${exhaustion.consecutiveDownDays} consecutive down days — oversold`, sentiment: "neutral" });
  }

  const pullbackScore = Math.max(5, Math.min(95, Math.round(score)));

  let classification: "pullback" | "reversal" | "ambiguous";
  if (pullbackScore >= 63)      classification = "pullback";
  else if (pullbackScore <= 37) classification = "reversal";
  else                          classification = "ambiguous";

  let summary: string;
  if (classification === "pullback") {
    summary = "Trend structure intact — looks like a buyable dip, not a trend change.";
  } else if (classification === "reversal") {
    summary = "Multiple reversal signals active — structure breaking down, not a safe dip-buy.";
  } else {
    summary = "Mixed signals — watch for confirmation before entering long or pressing short.";
  }

  const bullish = signals.filter(s => s.sentiment === "bullish").slice(0, 3);
  const bearish = signals.filter(s => s.sentiment === "bearish").slice(0, 3);
  const neutral = signals.filter(s => s.sentiment === "neutral").slice(0, 1);
  const keySignals = [...bullish, ...bearish, ...neutral].slice(0, 6);

  return { classification, pullbackScore, keySignals, summary };
}

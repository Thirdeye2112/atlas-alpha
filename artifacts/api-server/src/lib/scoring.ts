import type { TrendResult, MomentumResult, VolumeResult, OptionsResult, RelativeStrengthResult, PatternResult } from "./indicators.js";

export type AtlasLabel = "extreme_bearish" | "bearish" | "neutral" | "bullish" | "extreme_bullish";
export type Direction = "bullish" | "bearish" | "neutral";
export type TimeHorizon = "1-3d" | "1-2w" | "1-3m";

export interface AtlasAlphaScore {
  overall: number;
  label: AtlasLabel;
  trendScore: number;
  momentumScore: number;
  volumeScore: number;
  optionsScore: number;
  relativeStrengthScore: number;
  marketRegimeScore: number;
  bullishProbability: number;
  bearishProbability: number;
  confidenceScore: number;
  riskScore: number;
  direction: Direction;
  timeHorizon: TimeHorizon;
  expectedMovePercent: number;
  indicatorsAgreeing: number;
  totalIndicators: number;
  signalNarrative: string;
}

function clamp(val: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, val));
}

function labelFromScore(score: number): AtlasLabel {
  if (score >= 80) return "extreme_bullish";
  if (score >= 60) return "bullish";
  if (score >= 40) return "neutral";
  if (score >= 20) return "bearish";
  return "extreme_bearish";
}

// Logistic calibration: score 50→50%, 70→84%, 30→16%, 80→93%, 20→7%
function logisticProb(score: number): number {
  return clamp(Math.round((1 / (1 + Math.exp(-0.08 * (score - 50)))) * 100));
}

export function calcAtlasScore(
  trend: TrendResult,
  momentum: MomentumResult,
  volume: VolumeResult,
  options: OptionsResult,
  rs: RelativeStrengthResult,
  marketRegimeScore: number,
  expectedMovePercent: number
): AtlasAlphaScore {
  // Weighted composite: Trend 30% + Momentum 20% + Volume 15% + Options 10% + RS 15% + Regime 10%
  // Options reduced (proxy data); Trend + RS raised (verifiable price-based signals)
  const overall = clamp(
    trend.trendAlignmentScore * 0.30 +
    momentum.momentumScore    * 0.20 +
    volume.volumeScore        * 0.15 +
    options.optionsScore      * 0.10 +
    rs.rsScore                * 0.15 +
    marketRegimeScore         * 0.10
  );

  const label = labelFromScore(overall);

  // Indicator agreement — 18 independent signals (redundant vsSpy>2 slot removed)
  const bullishSignals: boolean[] = [
    trend.trendDirection === "strong_up" || trend.trendDirection === "up",
    trend.goldenCross,
    momentum.rsi > 50 && momentum.rsi < 70,
    momentum.macd > momentum.macdSignal,
    momentum.macdCrossover === "bullish",
    momentum.stochK > momentum.stochD && momentum.stochK < 80,
    momentum.cci > 0,
    momentum.roc > 0,
    volume.obvTrend === "rising",
    volume.chaikinMoneyFlow > 0,
    volume.volumeSpike && overall > 50,
    options.optionsScore > 60,
    options.unusualActivity && overall > 50,
    rs.vsSpy > 0,                      // multi-timeframe weighted RS vs SPY
    trend.priceVsSma50 > 0,
    trend.priceVsSma200 > 0,
    momentum.rsiDivergence === "bullish",
    momentum.rsiSignal === "oversold",
  ];

  const bearishSignals: boolean[] = [
    trend.trendDirection === "strong_down" || trend.trendDirection === "down",
    trend.deathCross,
    momentum.rsi < 50 && momentum.rsi > 30,
    momentum.macd < momentum.macdSignal,
    momentum.macdCrossover === "bearish",
    momentum.stochK < momentum.stochD && momentum.stochK > 20,
    momentum.cci < 0,
    momentum.roc < 0,
    volume.obvTrend === "falling",
    volume.chaikinMoneyFlow < 0,
    volume.volumeSpike && overall < 50,
    options.optionsScore < 40,
    options.unusualActivity && overall < 50,
    rs.vsSpy < 0,
    trend.priceVsSma50 < 0,
    trend.priceVsSma200 < 0,
    momentum.rsiDivergence === "bearish",
    momentum.rsiSignal === "overbought",
  ];

  const totalIndicators = bullishSignals.length;
  const bullCount = bullishSignals.filter(Boolean).length;
  const bearCount = bearishSignals.filter(Boolean).length;
  const indicatorsAgreeing = overall >= 50 ? bullCount : bearCount;

  const agreementRatio = Math.max(bullCount, bearCount) / totalIndicators;
  const confidenceScore = clamp(agreementRatio * 100);

  // Logistic-calibrated probabilities (not just the raw score)
  const bullishProbability = logisticProb(overall);
  const bearishProbability = clamp(100 - bullishProbability);

  const direction: Direction = overall >= 60 ? "bullish" : overall <= 40 ? "bearish" : "neutral";

  let timeHorizon: TimeHorizon = "1-2w";
  if (confidenceScore > 80 && Math.abs(overall - 50) > 25) timeHorizon = "1-3d";
  else if (confidenceScore < 55) timeHorizon = "1-3m";

  const riskScore = clamp(100 - confidenceScore + (expectedMovePercent > 5 ? 20 : 0));

  const signalNarrative = buildNarrative(trend, momentum, volume, options, rs, direction, overall, confidenceScore, bullCount, totalIndicators);

  return {
    overall: Math.round(overall),
    label,
    trendScore: Math.round(trend.trendAlignmentScore),
    momentumScore: Math.round(momentum.momentumScore),
    volumeScore: Math.round(volume.volumeScore),
    optionsScore: Math.round(options.optionsScore),
    relativeStrengthScore: Math.round(rs.rsScore),
    marketRegimeScore: Math.round(marketRegimeScore),
    bullishProbability,
    bearishProbability,
    confidenceScore: Math.round(confidenceScore),
    riskScore: Math.round(riskScore),
    direction,
    timeHorizon,
    expectedMovePercent: Math.round(expectedMovePercent * 10) / 10,
    indicatorsAgreeing,
    totalIndicators,
    signalNarrative,
  };
}

function buildNarrative(
  trend: TrendResult,
  momentum: MomentumResult,
  volume: VolumeResult,
  options: OptionsResult,
  rs: RelativeStrengthResult,
  direction: Direction,
  overall: number,
  confidence: number,
  agreeing: number,
  total: number
): string {
  const parts: string[] = [];
  const strength = overall >= 75 ? "Strong" : overall >= 60 ? "Moderate" : overall <= 25 ? "Strong bearish" : overall <= 40 ? "Moderate bearish" : "Mixed";

  parts.push(`${strength} ${direction} setup detected. Signal confidence: ${Math.round(confidence)}% (${agreeing}/${total} indicators in agreement).`);

  if (trend.trendDirection === "strong_up") {
    parts.push(`Price maintains alignment above key moving averages — SMA50 (+${trend.priceVsSma50.toFixed(1)}%), SMA200 (+${trend.priceVsSma200.toFixed(1)}%).`);
  } else if (trend.trendDirection === "strong_down") {
    parts.push(`Price trading below all key moving averages — a bearish structure. Distance from SMA200: ${trend.priceVsSma200.toFixed(1)}%.`);
  } else if (trend.trendDirection === "up") {
    parts.push(`Trend structure is constructive with price above key moving averages.`);
  }

  if (trend.goldenCross) {
    parts.push(`Golden Cross confirmed — SMA50 crossed above SMA200, a historically significant bullish signal.`);
  }
  if (trend.deathCross) {
    parts.push(`Death Cross detected — SMA50 crossed below SMA200, a bearish structural event.`);
  }

  if (momentum.rsiSignal === "oversold") {
    parts.push(`RSI reading of ${momentum.rsi.toFixed(1)} indicates oversold conditions — potential mean reversion setup.`);
  } else if (momentum.rsiSignal === "overbought") {
    parts.push(`RSI at ${momentum.rsi.toFixed(1)} reflects overbought conditions; short-term consolidation risk elevated.`);
  } else {
    parts.push(`RSI at ${momentum.rsi.toFixed(1)} remains in neutral territory with ${momentum.macd > momentum.macdSignal ? "positive" : "negative"} MACD momentum.`);
  }

  if (momentum.macdCrossover === "bullish") {
    parts.push(`MACD recently crossed bullish — histogram expansion suggests accelerating momentum.`);
  } else if (momentum.macdCrossover === "bearish") {
    parts.push(`MACD crossed bearish — momentum deteriorating on the daily.`);
  }

  if (volume.relativeVolume > 2) {
    parts.push(`Volume surging at ${volume.relativeVolume.toFixed(1)}x average — ${volume.chaikinMoneyFlow > 0 ? "smart money accumulation" : "distribution pressure"} detected.`);
  } else if (volume.obvTrend === "rising") {
    parts.push(`On-Balance Volume trending higher, suggesting quiet institutional accumulation.`);
  } else if (volume.obvTrend === "falling") {
    parts.push(`OBV in decline — distribution pressure remains elevated below the surface.`);
  }

  if (options.unusualActivity) {
    parts.push(`Unusual activity flagged in the derivatives market. ${direction === "bullish" ? "Call buying pressure" : "Put activity"} elevated relative to average.`);
  }

  if (rs.vsSpy > 3) {
    parts.push(`Outperforming SPY by ${rs.vsSpy.toFixed(1)}% (multi-timeframe composite) — institutional relative strength thesis intact.`);
  } else if (rs.vsSpy < -3) {
    parts.push(`Underperforming SPY by ${Math.abs(rs.vsSpy).toFixed(1)}% (multi-timeframe composite) — sector rotation risk should be monitored.`);
  }

  if (momentum.rsiDivergence === "bullish") {
    parts.push(`Bullish RSI divergence detected — price making lower lows while RSI forms higher lows, a historically reliable reversal signal.`);
  } else if (momentum.rsiDivergence === "bearish") {
    parts.push(`Bearish RSI divergence present — momentum not confirming price highs. Distribution risk elevated.`);
  }

  return parts.join(" ");
}

export function calcScannerResult(
  ticker: string,
  name: string,
  price: number,
  change: number,
  changePercent: number,
  atlasScore: AtlasAlphaScore,
  volume: VolumeResult,
  momentum: MomentumResult,
  trend: TrendResult,
  sector: string | null,
  volTotal: number
): object {
  const catalysts: string[] = [];
  if (trend.goldenCross) catalysts.push("Golden Cross");
  if (trend.deathCross) catalysts.push("Death Cross");
  if (volume.volumeSpike) catalysts.push(`Vol ${volume.relativeVolume.toFixed(1)}x avg`);
  if (momentum.macdCrossover === "bullish") catalysts.push("MACD Bullish Cross");
  if (momentum.macdCrossover === "bearish") catalysts.push("MACD Bearish Cross");
  if (momentum.rsiSignal === "oversold") catalysts.push("RSI Oversold");
  if (momentum.rsiSignal === "overbought") catalysts.push("RSI Overbought");
  if (momentum.rsiDivergence) catalysts.push(`RSI ${momentum.rsiDivergence} divergence`);

  const signalStrength = atlasScore.confidenceScore >= 75 ? "strong" : atlasScore.confidenceScore >= 55 ? "moderate" : "weak";

  return {
    ticker,
    name,
    price,
    change,
    changePercent,
    atlasScore: atlasScore.overall,
    atlasLabel: atlasScore.label,
    bullishProbability: atlasScore.bullishProbability,
    bearishProbability: atlasScore.bearishProbability,
    confidenceScore: atlasScore.confidenceScore,
    direction: atlasScore.direction,
    signalStrength,
    sector,
    volume: volTotal,
    relativeVolume: Math.round(volume.relativeVolume * 10) / 10,
    rsi: Math.round(momentum.rsi * 10) / 10,
    catalysts: catalysts.slice(0, 4),
  };
}

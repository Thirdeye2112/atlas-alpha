import type { TrendResult, MomentumResult, VolumeResult, OptionsResult, RelativeStrengthResult, ExhaustionResult } from "./indicators.js";

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
  exhaustionScore: number;
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

// Logistic calibration: score 50→50%, 70→84%, 80→93%, 30→16%
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
  expectedMovePercent: number,
  exhaustion: ExhaustionResult
): AtlasAlphaScore {
  // Regime gate: in choppy/fearful markets (low regime), dampen trend+momentum
  // because price-based signals produce more false positives without a clear trend.
  // ADX < 20 and high realized vol are captured in the regime score.
  const regimeGate = marketRegimeScore < 35 ? 0.70
    : marketRegimeScore < 50 ? 0.85
    : 1.0;

  // Weighted composite:
  //   Trend 27% + Momentum 18% + Volume 13% + VolSqueeze 9% + RS 13% + Regime 8% + Exhaustion 12%
  // Exhaustion is a counter-trend signal: it captures capitulation, reversal bars, and
  // extended-decline snap-back setups that pure trend-following always misses.
  // Trend and Momentum are gated by regime to avoid false signals in choppy markets.
  const overall = clamp(
    trend.trendAlignmentScore       * 0.27 * regimeGate +
    momentum.momentumScore          * 0.18 * regimeGate +
    volume.volumeScore              * 0.13 +
    options.optionsScore            * 0.09 +
    rs.rsScore                      * 0.13 +
    marketRegimeScore               * 0.08 +
    exhaustion.exhaustionScore      * 0.12
  );

  const label = labelFromScore(overall);

  // ── Category-level confidence (6 independent buckets) ─────────────────────
  // Each bucket is an orthogonal data dimension. Asking "does each category
  // agree?" avoids the correlated-indicator inflation of raw signal counts.
  // Exhaustion counts as a bullish category when it's signalling a reversal.
  const bullCats = [
    trend.trendAlignmentScore > 60,
    momentum.momentumScore > 60,
    volume.volumeScore > 60,
    rs.rsScore > 60,
    marketRegimeScore > 60,
    exhaustion.exhaustionScore > 70,
  ].filter(Boolean).length;

  const bearCats = [
    trend.trendAlignmentScore < 40,
    momentum.momentumScore < 40,
    volume.volumeScore < 40,
    rs.rsScore < 40,
    marketRegimeScore < 40,
    exhaustion.exhaustionScore < 30,
  ].filter(Boolean).length;

  const totalIndicators = 6;
  const indicatorsAgreeing = overall >= 50 ? bullCats : bearCats;
  const confidenceScore = clamp(Math.max(bullCats, bearCats) / totalIndicators * 100);

  // Logistic-calibrated probability
  const bullishProbability = logisticProb(overall);
  const bearishProbability = clamp(100 - bullishProbability);

  const direction: Direction = overall >= 60 ? "bullish" : overall <= 40 ? "bearish" : "neutral";

  let timeHorizon: TimeHorizon = "1-2w";
  if (confidenceScore >= 80 && Math.abs(overall - 50) > 25) timeHorizon = "1-3d";
  else if (confidenceScore < 60) timeHorizon = "1-3m";

  const riskScore = clamp(100 - confidenceScore + (expectedMovePercent > 5 ? 20 : 0));

  const signalNarrative = buildNarrative(
    trend, momentum, volume, options, rs, exhaustion,
    direction, overall, confidenceScore,
    bullCats, bearCats, totalIndicators, regimeGate
  );

  return {
    overall: Math.round(overall),
    label,
    trendScore: Math.round(trend.trendAlignmentScore),
    momentumScore: Math.round(momentum.momentumScore),
    volumeScore: Math.round(volume.volumeScore),
    optionsScore: Math.round(options.optionsScore),
    relativeStrengthScore: Math.round(rs.rsScore),
    marketRegimeScore: Math.round(marketRegimeScore),
    exhaustionScore: Math.round(exhaustion.exhaustionScore),
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
  exhaustion: ExhaustionResult,
  direction: Direction,
  overall: number,
  confidence: number,
  bullCats: number,
  bearCats: number,
  totalCats: number,
  regimeGate: number
): string {
  const parts: string[] = [];
  const strength = overall >= 75 ? "Strong" : overall >= 60 ? "Moderate" : overall <= 25 ? "Strong bearish" : overall <= 40 ? "Moderate bearish" : "Mixed";
  const agreeing = overall >= 50 ? bullCats : bearCats;

  // ── Exhaustion override: lead with the reversal signal if it's strong ──────
  if (exhaustion.exhaustionSignal === "capitulation") {
    parts.push(
      `⚡ CAPITULATION DETECTED: Extreme volume surge (${volume.relativeVolume.toFixed(1)}x avg) at deeply oversold levels (RSI ${momentum.rsi.toFixed(1)}) signals potential seller exhaustion.` +
      (exhaustion.gapPct < -10 ? ` Gap-down of ${exhaustion.gapPct.toFixed(1)}% on this volume is characteristic of a terminal flush.` : "") +
      ` Watch for a reversal confirmation candle (wick ratio > 0.60, close near session high) in the next 1–3 sessions before acting.`
    );
  } else if (exhaustion.exhaustionSignal === "reversal_bar") {
    parts.push(
      `🔄 REVERSAL BAR: Buyers absorbed selling pressure — close in the top ${Math.round(exhaustion.wickRatio * 100)}% of the day's range on ${volume.relativeVolume.toFixed(1)}x volume.` +
      (exhaustion.consecutiveDownDays >= 5 ? ` After ${exhaustion.consecutiveDownDays} consecutive down sessions, this bar shifts risk/reward to the upside.` : "") +
      ` RSI at ${momentum.rsi.toFixed(1)} — oversold momentum provides additional tailwind for a mean-reversion bounce.`
    );
  } else if (exhaustion.exhaustionSignal === "extended_decline") {
    parts.push(
      `📉 EXTENDED DECLINE: ${exhaustion.consecutiveDownDays} consecutive down sessions with price ${Math.abs(trend.priceVsSma200).toFixed(1)}% below SMA200.` +
      ` Statistical mean-reversion pressure is elevated — wait for a volume-confirmed reversal bar before entering.`
    );
  }

  parts.push(`${strength} ${direction} setup detected. ${agreeing}/${totalCats} independent categories in agreement (confidence: ${Math.round(confidence)}%).`);

  if (regimeGate < 1.0) {
    parts.push(`Regime gate active (${regimeGate === 0.70 ? "risk-off" : "choppy"} market): trend and momentum signals dampened — false-positive risk elevated.`);
  }

  if (trend.trendDirection === "strong_up") {
    parts.push(`Price maintains alignment above major moving averages — SMA50 (+${trend.priceVsSma50.toFixed(1)}%), SMA200 (+${trend.priceVsSma200.toFixed(1)}%).`);
  } else if (trend.trendDirection === "strong_down") {
    parts.push(`Price trading below all major moving averages. Distance from SMA200: ${trend.priceVsSma200.toFixed(1)}%.`);
  } else if (trend.trendDirection === "up") {
    parts.push(`Trend structure is constructive with price above key moving averages.`);
  }

  if (trend.goldenCross) {
    parts.push(`Golden Cross confirmed — SMA50 crossed above SMA200, a historically significant long-term bullish signal.`);
  }
  if (trend.deathCross) {
    parts.push(`Death Cross detected — SMA50 crossed below SMA200, a major structural bearish event.`);
  }

  if (momentum.rsiSignal === "oversold") {
    parts.push(`RSI at ${momentum.rsi.toFixed(1)} — oversold territory. Potential mean reversion setup if volume confirms.`);
  } else if (momentum.rsiSignal === "overbought") {
    parts.push(`RSI at ${momentum.rsi.toFixed(1)} — overbought. Short-term consolidation or pullback risk is elevated.`);
  } else {
    parts.push(`RSI at ${momentum.rsi.toFixed(1)} — neutral range. MACD momentum is ${momentum.macd > momentum.macdSignal ? "positive" : "negative"}.`);
  }

  if (momentum.macdCrossover === "bullish") {
    parts.push(`MACD bullish crossover — histogram expansion suggests accelerating upside momentum.`);
  } else if (momentum.macdCrossover === "bearish") {
    parts.push(`MACD bearish crossover — momentum deteriorating on the daily timeframe.`);
  }

  if (momentum.rsiDivergence === "bullish") {
    parts.push(`Bullish RSI divergence: price making lower lows while RSI forms higher lows — a reliable early reversal signal.`);
  } else if (momentum.rsiDivergence === "bearish") {
    parts.push(`Bearish RSI divergence: momentum not confirming price highs. Distribution risk is elevated.`);
  }

  if (volume.relativeVolume > 2) {
    parts.push(`Volume surge at ${volume.relativeVolume.toFixed(1)}x average — ${volume.chaikinMoneyFlow > 0 ? "institutional accumulation" : "distribution pressure"} detected.`);
  } else if (volume.obvTrend === "rising") {
    parts.push(`On-Balance Volume trending higher — quiet accumulation likely ongoing.`);
  } else if (volume.obvTrend === "falling") {
    parts.push(`OBV declining — distribution pressure building beneath the surface.`);
  }

  if (options.unusualActivity) {
    parts.push(`Volatility squeeze signal active. ${direction === "bullish" ? "Expansion likely bullish." : "Watch for directional break."}`);
  }

  if (rs.vsSpy > 3) {
    parts.push(`Outperforming SPY by ${rs.vsSpy.toFixed(1)}% (multi-timeframe composite) — relative strength thesis intact.`);
  } else if (rs.vsSpy < -3) {
    parts.push(`Underperforming SPY by ${Math.abs(rs.vsSpy).toFixed(1)}% (multi-timeframe composite) — sector rotation risk is a factor.`);
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
  volTotal: number,
  gapPercent = 0
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

  const signalStrength = atlasScore.confidenceScore >= 80 ? "strong"
    : atlasScore.confidenceScore >= 60 ? "moderate"
    : "weak";

  return {
    ticker,
    name,
    price,
    change,
    changePercent,
    gapPercent,
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

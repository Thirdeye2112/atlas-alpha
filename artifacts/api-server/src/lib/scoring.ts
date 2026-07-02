import type { TrendResult, MomentumResult, VolumeResult, OptionsResult, RelativeStrengthResult, ExhaustionResult } from "./indicators.js";

// Bump this string whenever scoring weights or formula change materially.
// calibration_models rows with a different score_version are automatically
// treated as stale and excluded from inference.
export const SCORE_VERSION = "v1.5";

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
  /** 0–100 score from the research V4 ML model (all 47 features), or null when no
   *  prediction exists for this ticker/date. Fused into `overall` at ML_WEIGHT. */
  mlScore: number | null;
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
  /** 0–100 factor alignment score. 100 = all sub-scores in sync; lower values
   *  indicate internal divergence that inflates apparent confidence. */
  alignmentScore: number;
}

/** Per-ticker IC²-optimal weight overrides from the walk-forward backtest engine. */
export interface WeightOverrides {
  trend: number;
  momentum: number;
  volume: number;
  relativeStrength: number;
  regime: number;
}

/** Options passed to calcAtlasScore to enable adaptive scoring. */
export interface ScoreOpts {
  weights?: WeightOverrides | null;
  rankIC?: number;
  icRating?: string;
  /** 0–100 score from the research V4 ML model for this ticker (built from all 47
   *  features). Typically rank_percentile×100 from the `predictions` table. When
   *  provided, it's fused into `overall` at ML_WEIGHT and the factor terms scale down
   *  proportionally; when null/undefined, scoring is unchanged (graceful fallback). */
  mlScore?: number | null;
  /** Validated multi-modality confluence lift (atlas-research confluence gate; walk-forward
   *  OOS-stable 15/15 years). POSITIVE-ONLY, and it lifts `confidenceScore` ONLY — never the
   *  directional `overall`. 0 / null / undefined ⇒ no change (graceful fallback). */
  confluenceLift?: number | null;
}

/** Weight given to the research V4 ML model when a prediction is available. */
const ML_WEIGHT = 0.20;

/** Confluence confidence lift: points-per-unit-lift and the hard cap (bounded so a strong
 *  full-scope stack adds at most CONF_LIFT_CAP confidence points; it can never lower it). */
const CONF_LIFT_SCALE = 10;
const CONF_LIFT_CAP   = 12;

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
  exhaustion: ExhaustionResult,
  opts?: ScoreOpts
): AtlasAlphaScore {
  // Regime gate: in choppy/fearful markets (low regime), dampen trend+momentum
  // because price-based signals produce more false positives without a clear trend.
  // ADX < 20 and high realized vol are captured in the regime score.
  const regimeGate = marketRegimeScore < 35 ? 0.70
    : marketRegimeScore < 50 ? 0.85
    : 1.0;

  // Adaptive weights: when the walk-forward backtest has computed IC²-optimal weights
  // for this specific ticker, use them instead of global defaults. Options (9%) and
  // Exhaustion (12%) are pinned; the remaining 79% budget is allocated proportionally
  // by optimalWeights from the calibration store.
  // Global defaults: Trend 24%, Momentum 18%, Volume 13%, RS 20%, Regime 4%.
  // Fix #3: trend & RS are both lagging measures of the SAME past move (a name that
  // ran is above its MAs AND outperforming SPY), so weighting them as two independent
  // 44% votes over-counts stale strength. Cut their combined default weight 44%→36%
  // and redistribute the freed 8% to the forward factors (momentum/volume/exhaustion).
  const OPTS_W  = 0.09;
  const EXHS_W  = 0.14;                 // was 0.12
  const FACT_BG = 1 - OPTS_W - EXHS_W;  // 0.77
  const ow      = opts?.weights;
  const trendW  = ow ? (ow.trend            / 100) * FACT_BG : 0.20;  // was 0.24
  const momW    = ow ? (ow.momentum         / 100) * FACT_BG : 0.22;  // was 0.18
  const volW    = ow ? (ow.volume           / 100) * FACT_BG : 0.15;  // was 0.13
  const rsW     = ow ? (ow.relativeStrength / 100) * FACT_BG : 0.16;  // was 0.20
  const regW    = ow ? (ow.regime           / 100) * FACT_BG : 0.04;

  // V4 ML model fusion: when a prediction exists for this ticker, the model (built
  // from all 47 features) takes ML_WEIGHT of the score and the seven factor terms
  // scale down by (1 - ML_WEIGHT) so the total weight still sums to 1.0. When no
  // prediction exists, mlW = 0 and the formula is identical to before (no behaviour
  // change for un-scored tickers).
  const mlScore = (opts?.mlScore != null && Number.isFinite(opts.mlScore))
    ? clamp(opts.mlScore) : null;
  const mlW   = mlScore != null ? ML_WEIGHT : 0;
  const facS  = 1 - mlW;   // scale applied to the existing factor budget

  // Fix #4: laggard-override gate. When the two laggards (trend/RS) are strong but the
  // live forward reads (momentum + volume) do NOT confirm, the tape is likely topping on
  // stale strength — discount the laggards so a distributing name can't score bullish on
  // where-it's-been alone. (LIXT: trend/RS ~100 vs momentum 49 / volume 45.)
  const laggard = (trend.trendAlignmentScore + rs.rsScore) / 2;
  const forward = (momentum.momentumScore + volume.volumeScore) / 2;
  // Proportional (not a cliff): the further forward lags the laggards, the harder the
  // discount, from 1.0 (fully confirmed) down to 0.55 (stale strength, no confirmation).
  let laggardDamp = 1;
  if (laggard > 60 && forward < laggard - 10) {
    const gap = Math.min(1, (laggard - forward) / 50);   // 0..1
    laggardDamp = 1 - 0.45 * gap;
  }

  const overall = clamp(
    (trend.trendAlignmentScore      * trendW * regimeGate * laggardDamp +
     momentum.momentumScore         * momW   * regimeGate +
     volume.volumeScore             * volW +
     options.optionsScore           * OPTS_W +
     rs.rsScore                     * rsW * laggardDamp +
     marketRegimeScore              * regW +
     exhaustion.exhaustionScore     * EXHS_W) * facS +
    (mlScore ?? 0)                  * mlW
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
  const rawConfidence = clamp(Math.max(bullCats, bearCats) / totalIndicators * 100);

  // ── Alignment (dispersion) penalty ────────────────────────────────────────
  // When the 5 primary sub-scores spread widely (e.g. trend=85 but momentum=20),
  // averaging inflates apparent conviction. We penalise *confidence* — not the
  // raw weighted score — by up to 15% at high factor divergence, preserving
  // signal direction while communicating reduced conviction to the UI and bot.
  const factorScores  = [trend.trendAlignmentScore, momentum.momentumScore, volume.volumeScore, rs.rsScore, marketRegimeScore];
  const factorMean    = factorScores.reduce((s, v) => s + v, 0) / factorScores.length;
  const factorStdDev  = Math.sqrt(factorScores.reduce((s, v) => s + (v - factorMean) ** 2, 0) / factorScores.length);
  // 100 = all factors in sync; approaches 0 at stdDev ≥ 50
  const alignmentScore = clamp(Math.round(100 - factorStdDev * 2));
  // 0% penalty at stdDev ≤ 15; rises to 15% cap at stdDev ≥ 55 (267 = 40/0.15)
  const alignPenalty  = Math.min(0.15, Math.max(0, (factorStdDev - 15) / 267));
  const confidenceScore = Math.round(rawConfidence * (1 - alignPenalty));

  // IC quality gate: cap confidence when historical IC is noise-level (<3% rank correlation).
  // A noise IC means the score has no demonstrated predictive power for this ticker —
  // we still show the score but refuse to claim high confidence in it.
  // Contrarian flag: significantly negative IC means the score's direction is historically
  // inverted — high scores precede mean-reversion, not continuation.
  const icRankAbs    = opts?.rankIC !== undefined ? Math.abs(opts.rankIC) : undefined;
  const isNoiseIC    = opts?.icRating === "noise" || (icRankAbs !== undefined && icRankAbs < 0.03);
  const isContrarian = opts?.rankIC !== undefined && opts.rankIC < -0.02 && !isNoiseIC;
  const cappedConfidence = isNoiseIC ? Math.min(confidenceScore, 50) : confidenceScore;

  // ── Confluence confidence lift (validated, positive-only) ─────────────────────
  // The validated multi-modality confluence GATE (atlas-research: crossing it ~doubles
  // the 5d edge and adds ~3pp hit, OOS-stable 15/15 years) lifts CONFIDENCE only —
  // never the directional `overall`. Positive-only + capped; applied on the long side
  // (the gate was validated long) and damped in risk-off regime (crash guard, 2020).
  const confLiftRaw  = (opts?.confluenceLift != null && opts.confluenceLift > 0) ? opts.confluenceLift : 0;
  const confRegimeOk = marketRegimeScore >= 35 ? 1 : 0.4;
  const confApplies  = overall >= 50 ? 1 : 0;
  const confBoost    = Math.min(CONF_LIFT_CAP, confLiftRaw * CONF_LIFT_SCALE) * confRegimeOk * confApplies;
  const finalConfidence = clamp(cappedConfidence + confBoost);

  // Logistic-calibrated probability
  const bullishProbability = logisticProb(overall);
  const bearishProbability = clamp(100 - bullishProbability);

  const direction: Direction = overall >= 60 ? "bullish" : overall <= 40 ? "bearish" : "neutral";

  let timeHorizon: TimeHorizon = "1-2w";
  if (finalConfidence >= 80 && Math.abs(overall - 50) > 25) timeHorizon = "1-3d";
  else if (finalConfidence < 60) timeHorizon = "1-3m";

  const riskScore = clamp(100 - finalConfidence + (expectedMovePercent > 5 ? 20 : 0));

  const signalNarrative = buildNarrative(
    trend, momentum, volume, options, rs, exhaustion,
    direction, overall, finalConfidence,
    bullCats, bearCats, totalIndicators, regimeGate,
    isContrarian, !!ow
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
    mlScore: mlScore != null ? Math.round(mlScore) : null,
    bullishProbability,
    bearishProbability,
    confidenceScore: Math.round(finalConfidence),
    riskScore: Math.round(riskScore),
    direction,
    timeHorizon,
    expectedMovePercent: Math.round(expectedMovePercent * 10) / 10,
    indicatorsAgreeing,
    totalIndicators,
    signalNarrative,
    alignmentScore,
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
  regimeGate: number,
  isContrarian = false,
  isAdaptive = false
): string {
  const parts: string[] = [];
  const strength = overall >= 75 ? "Strong" : overall >= 60 ? "Moderate" : overall <= 25 ? "Strong bearish" : overall <= 40 ? "Moderate bearish" : "Mixed";
  const agreeing = overall >= 50 ? bullCats : bearCats;

  // ── Contrarian / adaptive-weights annotation ──────────────────────────────
  if (isContrarian) {
    parts.push(
      `⚠️ CONTRARIAN SIGNAL: Walk-forward Rank IC is negative for this ticker — elevated Atlas Scores historically precede mean-reversion, not trend continuation. Treat high scores (>60) as short-side setups and low scores (<40) as long-side setups.`
    );
  }
  if (isAdaptive) {
    parts.push(`[IC²-ADAPTIVE] Score weighted by ticker-specific IC²-optimal factors derived from 2Y walk-forward backtest.`);
  }

  // ── Exhaustion override: lead with the reversal/distribution signal if strong ─
  if (exhaustion.exhaustionSignal === "distribution_top") {
    parts.push(
      `⚠️ DISTRIBUTION TOP: Multiple overbought extremes converging — Stochastic ${momentum.stochK.toFixed(0)}/${momentum.stochD.toFixed(0)} (both in overbought zone)` +
      (trend.priceVsSma20 > 10 ? `, price +${trend.priceVsSma20.toFixed(1)}% above SMA20` : "") +
      (volume.relativeVolume < 0.85 ? `, volume only ${volume.relativeVolume.toFixed(2)}x avg at price highs (distribution)` : "") +
      `. Mean-reversion risk is elevated — momentum is stretched, not building.`
    );
  } else if (exhaustion.exhaustionSignal === "capitulation") {
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
  } else if (exhaustion.exhaustionSignal === "breakout") {
    parts.push(
      `🚀 CATALYST BREAKOUT: Gap-up of +${exhaustion.gapPct.toFixed(1)}% on ${volume.relativeVolume.toFixed(1)}x volume, closing in the top ${Math.round(exhaustion.wickRatio * 100)}% of the day's range.` +
      (trend.priceVsSma200 < -20 ? ` Stock was ${Math.abs(trend.priceVsSma200).toFixed(1)}% below SMA200 — this event may mark a structural trend reversal.` : ` Strong momentum — watch for follow-through or fade on the next session.`)
    );
  } else if (exhaustion.exhaustionSignal === "extended_decline") {
    parts.push(
      `📉 EXTENDED DECLINE: ${exhaustion.consecutiveDownDays} consecutive down sessions with price ${Math.abs(trend.priceVsSma200).toFixed(1)}% below SMA200.` +
      ` Statistical mean-reversion pressure is elevated — wait for a volume-confirmed reversal bar before entering.`
    );
  }

  // ── Structural pattern warnings (fire regardless of overall score direction) ──
  if (exhaustion.doubleTop) {
    const pctStr = exhaustion.doubleTopPeakPct < -0.5
      ? ` Price is now ${Math.abs(exhaustion.doubleTopPeakPct).toFixed(1)}% below the dual-peak level.`
      : ` Price is currently testing the dual-peak resistance zone.`;
    parts.push(
      `⚠️ DOUBLE-TOP STRUCTURE DETECTED: Two roughly-equal price highs separated by a meaningful trough — a classical distribution/reversal pattern.${pctStr}` +
      ` A bullish score here reflects current momentum, NOT the structural setup.` +
      ` Risk/reward skews to the downside until price reclaims both peaks on conviction volume, or breaks the trough (neckline) decisively.`
    );
  }

  if (exhaustion.parabolicRise) {
    parts.push(
      `📐 PARABOLIC EXTENSION: The stock rose ${exhaustion.riseSpeed5d.toFixed(1)}% in 5 sessions — significantly faster than its prior baseline velocity.` +
      ` Parabolic moves ("humps") statistically resolve with a proportional retracement.` +
      ` The steeper the angle of ascent, the sharper the mean-reversion snap when buying exhausts.` +
      ` Reduce position size or use trailing stops; avoid chasing at current velocity.`
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
  gapPercent = 0,
  exhaustion?: ExhaustionResult
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
  if (exhaustion?.exhaustionSignal === "distribution_top") catalysts.push("Distribution Top");
  if (exhaustion?.doubleTop)     catalysts.push("Double Top");
  if (exhaustion?.parabolicRise) catalysts.push("Parabolic Rise");

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

/**
 * Reversal Short Detection Engine
 *
 * Identifies stocks forming potential distribution tops / reversal setups
 * BEFORE the overall atlas score flips bearish. Uses the existing computed
 * fields from AnalysisResult — no extra data fetching required.
 *
 * Key insight: by the time direction === "bearish", the optimal short entry
 * is often gone. This module catches the forming top (double top second peak,
 * overbought distribution, H&S right shoulder) so the bot can enter earlier
 * with a tighter stop above resistance.
 */

import type { AnalysisResult } from "./analysisEngine.js";

export interface ReversalShortSignal {
  score:            number;            // 0–100 conviction
  triggers:         string[];          // human-readable driver list
  resistanceLevel:  number;            // price level to place stop above
  urgency:          "forming" | "confirmed" | "extended";
}

export interface ReversalEntryLevels {
  stopPrice:   number;
  targetPrice: number;
  atrPct:      number;
  trigger:     string;
}

// ── Scoring ───────────────────────────────────────────────────────────────────

export function calcReversalScore(a: AnalysisResult): ReversalShortSignal {
  const price    = a.quote.price as number;
  const rsi      = a.momentum.rsi;
  const exh      = a.exhaustion;
  const patterns = (a.patterns?.patterns ?? []) as string[];
  const pLower   = patterns.map(p => p.toLowerCase().replace(/[_-]/g, " "));

  let score = 0;
  const triggers: string[] = [];

  // 1. Double top structure — two equal peaks separated by a trough ≥3%
  if (exh.doubleTop) {
    score += 40;
    triggers.push("Double Top");
  }

  // 2. Distribution top — stoch K/D >80 + extended price (overbought supply zone)
  if (exh.distributionTop) {
    const boost = rsi > 72 ? 32 : rsi > 65 ? 24 : rsi > 58 ? 16 : 10;
    score += boost;
    triggers.push(`Distribution Top (RSI ${rsi.toFixed(0)})`);
  }

  // 3. Parabolic rise — 5D ascent far outpaces 15D baseline (unsustainable)
  if (exh.parabolicRise) {
    score += 18;
    const spd = typeof exh.riseSpeed5d === "number" ? exh.riseSpeed5d.toFixed(1) : "?";
    triggers.push(`Parabolic Rise (+${spd}% 5D)`);
  }

  // 4. Structural bearish patterns
  const hasHS       = pLower.some(p => p.includes("head and shoulders") && !p.includes("inv"));
  const hasDblTop   = pLower.some(p => p.includes("double top")) && !exh.doubleTop;
  const hasDescTri  = pLower.some(p => p.includes("descending triangle"));
  const hasBearFlag = pLower.some(p => p.includes("bear flag"));
  const hasRiseWdg  = pLower.some(p => p.includes("rising wedge"));
  const hasIsland   = pLower.some(p => p.includes("island reversal") && (p.includes("bearish") || p.includes("bear")));

  if (hasHS)      { score += 25; triggers.push("Head & Shoulders"); }
  if (hasDblTop)  { score += 20; triggers.push("Double Top Pattern"); }
  if (hasDescTri) { score += 15; triggers.push("Descending Triangle"); }
  if (hasRiseWdg) { score += 14; triggers.push("Rising Wedge"); }
  if (hasBearFlag){ score += 12; triggers.push("Bear Flag"); }
  if (hasIsland)  { score += 18; triggers.push("Bearish Island Reversal"); }

  // 5. Candlestick reversal confirmation (cap total candle contribution at 20)
  const CANDLES: { keys: string[]; label: string; pts: number }[] = [
    { keys: ["three black crows"],  label: "Three Black Crows",  pts: 12 },
    { keys: ["evening star"],       label: "Evening Star",        pts: 10 },
    { keys: ["bearish engulfing"],  label: "Bearish Engulfing",  pts: 10 },
    { keys: ["gravestone doji"],    label: "Gravestone Doji",    pts: 9  },
    { keys: ["shooting star"],      label: "Shooting Star",      pts: 9  },
    { keys: ["dark cloud cover"],   label: "Dark Cloud Cover",   pts: 9  },
    { keys: ["tweezer top"],        label: "Tweezer Top",        pts: 8  },
    { keys: ["hanging man"],        label: "Hanging Man",        pts: 7  },
    { keys: ["bearish harami"],     label: "Bearish Harami",     pts: 7  },
  ];
  let candleTotal = 0;
  for (const cp of CANDLES) {
    if (pLower.some(p => cp.keys.some(k => p.includes(k)))) {
      const pts = Math.min(cp.pts, 20 - candleTotal);
      if (pts <= 0) break;
      score += pts;
      candleTotal += pts;
      triggers.push(cp.label);
    }
  }

  // 6. Bearish RSI divergence — price up but RSI declining
  if (a.momentum.rsiDivergence === "bearish") {
    score += 15;
    triggers.push("Bearish RSI Divergence");
  }

  // 7. Overbought RSI
  if      (rsi > 78) { score += 14; triggers.push(`RSI ${rsi.toFixed(0)} (Extreme)`); }
  else if (rsi > 72) { score += 10; triggers.push(`RSI ${rsi.toFixed(0)} Overbought`); }
  else if (rsi > 65) { score += 5;  triggers.push(`RSI ${rsi.toFixed(0)}`); }

  // 8. Price stretched above upper Bollinger Band
  if (a.volatility.bollingerUpper > 0 && price > a.volatility.bollingerUpper) {
    score += 8;
    triggers.push("Price > Upper BB");
  }

  // 9. High wick ratio — distribution wicking (sellers absorbing demand at highs)
  if (typeof exh.wickRatio === "number" && exh.wickRatio > 0.65) {
    score += 8;
    triggers.push(`High Wick Ratio ${exh.wickRatio.toFixed(2)}`);
  }

  // 10. Declining volume at highs — distribution without participation
  const rvol = a.volume.relativeVolume;
  if (rvol < 0.65 && (exh.distributionTop || exh.doubleTop)) {
    score += 8;
    triggers.push(`Low Vol at High (RVOL ${rvol.toFixed(2)}x)`);
  } else if (rvol < 0.80 && (exh.distributionTop || exh.doubleTop)) {
    score += 4;
  }

  // 11. Extreme SMA200 extension — price far above long-term mean
  const vs200 = a.trend.priceVsSma200 ?? 0;
  if      (vs200 > 40) { score += 12; triggers.push(`+${vs200.toFixed(0)}% Above SMA200`); }
  else if (vs200 > 25) { score += 8;  triggers.push(`+${vs200.toFixed(0)}% Above SMA200`); }
  else if (vs200 > 15) { score += 4;  }

  score = Math.min(100, Math.round(score));

  // ── Resistance level ──────────────────────────────────────────────────────
  // Best anchor for the stop: the double-top peak price, or upper BB, or current price.
  // doubleTopPeakPct is how far current price is from the peak (negative = below peak).
  let resistanceLevel = price;

  if (exh.doubleTop && typeof exh.doubleTopPeakPct === "number" && exh.doubleTopPeakPct < 0) {
    // Reconstruct peak: price = peak * (1 + peakPct/100)  =>  peak = price / (1 + peakPct/100)
    const impliedPeak = price / (1 + exh.doubleTopPeakPct / 100);
    if (impliedPeak > price) resistanceLevel = impliedPeak;
  } else if (a.volatility.bollingerUpper > 0 && a.volatility.bollingerUpper >= price * 0.99) {
    resistanceLevel = a.volatility.bollingerUpper;
  } else if (typeof a.trend.priceVsSma20 === "number" && a.trend.priceVsSma20 > 8) {
    // Price stretched; treat current area as resistance
    resistanceLevel = price * 1.005;
  }

  const urgency: ReversalShortSignal["urgency"] =
    score >= 78 ? "extended" : score >= 58 ? "confirmed" : "forming";

  return { score, triggers, resistanceLevel, urgency };
}

// ── Entry levels for a reversal short ─────────────────────────────────────────
// Stop goes just above the resistance level (the double-top high or BB+).
// Target uses 2–2.5× R:R — tighter than a trend continuation short because
// the move is counter-trend and the catalyst is exhaustion, not momentum.

export function computeReversalShortLevels(
  a: AnalysisResult,
  signal: ReversalShortSignal,
): ReversalEntryLevels | null {
  const price  = a.quote.price as number;
  const atrPct = a.volatility.atrPercent;
  const atr    = price * atrPct / 100;

  // Stop above resistance with a small buffer
  const stopBuffer = Math.max(atr * 0.35, signal.resistanceLevel * 0.005);
  const stopPrice  = signal.resistanceLevel + stopBuffer;

  // For a SHORT the risk is (stop − entry); stop must be above current price
  const risk = stopPrice - price;
  if (risk <= 0)      return null;   // price already above resistance — invalid entry
  if (risk > atr * 2.8) return null; // implied entry is too far below resistance

  const rrMult     = signal.urgency === "extended" ? 2.5 : 2.0;
  const targetPrice = price - risk * rrMult;

  const trigger = signal.urgency === "extended" ? "reversal_top_extended"
                : signal.urgency === "confirmed" ? "reversal_top_confirmed"
                : "reversal_top_forming";

  return { stopPrice, targetPrice, atrPct, trigger };
}

// confluenceLive.ts
// ─────────────────────────────────────────────────────────────────────────────
// LIVE confluence-confidence read — computed per request from the detections the
// api-server already produces (calcPatterns names + RSI oversold + trend vs SMA200),
// so the validated gate is FRESH (asOf = latest bar) instead of lagging the nightly
// deep_dive_events mine by up to 3 days.
//
// The nightly confluenceStore is now used ONLY to SUPPLEMENT the two validated
// structure patterns the live detector can't name — descending_channel_break (0.22)
// and triple_top (0.18). Everything with real weight (both pennants, both wedges,
// both head-and-shoulders, the oversold candle) is seen live.
//
// Rules are identical to the store (atlas-research CONFLUENCE_CONFIDENCE_PLAN.md):
//   • POSITIVE-ONLY: a null/absent/unvalidated layer contributes exactly 0, never a penalty.
//   • Long-side gate; validated OPPOSITE-side structures become a veto flag, not a drag.
//   • Out-of-trend (price < SMA200) damps the lift ×0.5.
// The regime crash-guard is applied downstream in scoring.ts (unchanged).
// ─────────────────────────────────────────────────────────────────────────────
import type { TrendResult, MomentumResult } from "./indicators.js";
import {
  W_BULL_STRUCT, W_BEAR_STRUCT, W_CANDLE_OVERSOLD, OUT_OF_TREND_DAMP, tierFor,
  type ConfluenceRead, type ConfluenceLayer,
} from "./confluenceStore.js";

// calcPatterns() label → validated canonical name (only the walk-forward-validated set).
const LIVE_TO_CANON: Record<string, string> = {
  "Bullish Pennant":        "bull_pennant",    // long  0.79
  "Bearish Pennant":        "bear_pennant",    // short 0.52 (veto)
  "Falling Wedge":          "falling_wedge",   // long  0.60
  "Rising Wedge":           "rising_wedge",    // short 0.21 (veto)
  "Inv Head and Shoulders": "hs_bottom",       // long  0.29
  "Head and Shoulders":     "hs_top",          // short 0.36 (veto)
};

// Bullish single-/multi-bar candlestick labels calcPatterns emits. Validated ONLY when
// oversold (Part 1E: raw candle = coin-flip 0; candle×oversold = +0.26%).
const BULLISH_CANDLES = new Set<string>([
  "Hammer", "Bullish Inv Hammer", "Bullish Marubozu", "Bullish Spinning Top",
  "Bullish Engulfing", "Bullish Harami", "Bullish Harami Cross", "Piercing Line",
  "Tweezer Bottom", "Three White Soldiers", "Morning Star", "Morning Doji Star",
  "Dragonfly Doji", "Bullish Island Reversal",
]);

// Validated patterns the LIVE detector cannot name — supplement these (and only these)
// from the nightly store so the full validated set still contributes.
const LIVE_BLIND = new Set<string>(["descending_channel_break", "triple_top"]);

/**
 * Compute the fresh confluence read from live per-request detections, supplemented by the
 * nightly store only for the live-blind patterns. Never throws; returns a tier-0 read when
 * nothing validated is present.
 */
export function computeLiveConfluence(
  patternLabels: string[],
  trend: TrendResult,
  momentum: MomentumResult,
  nightly: ConfluenceRead | null,
  asOf: string,
): ConfluenceRead {
  const layers: ConfluenceLayer[] = [];
  const veto: string[] = [];
  const seen = new Set<string>();
  let lift = 0;

  // ── L3 structure — live named detections ──────────────────────────────────
  for (const label of patternLabels) {
    const canon = LIVE_TO_CANON[label];
    if (!canon || seen.has(canon)) continue;
    if (canon in W_BULL_STRUCT) {
      lift += W_BULL_STRUCT[canon];
      layers.push({ layer: "L3_structure", signal: canon, dir: "long", weight: W_BULL_STRUCT[canon], validated: true, note: "live" });
      seen.add(canon);
    } else if (canon in W_BEAR_STRUCT) {
      veto.push(canon);
      layers.push({ layer: "L3_structure", signal: canon, dir: "short", weight: 0, validated: true, note: "live · contrary evidence (veto)" });
      seen.add(canon);
    }
  }

  // ── L3 supplement — validated patterns the live path is blind to ───────────
  if (nightly) {
    for (const L of nightly.layers) {
      if (L.layer !== "L3_structure" || !LIVE_BLIND.has(L.signal) || seen.has(L.signal)) continue;
      if (L.dir === "long" && L.signal in W_BULL_STRUCT) {
        lift += W_BULL_STRUCT[L.signal];
        layers.push({ ...L, note: "nightly (live-blind pattern)" });
        seen.add(L.signal);
      } else if (L.dir === "short" && L.signal in W_BEAR_STRUCT) {
        veto.push(L.signal);
        layers.push({ ...L, note: "nightly (live-blind, veto)" });
        seen.add(L.signal);
      }
    }
  }

  // ── L0 candle — bullish candle, validated ONLY in an oversold context ──────
  const hasBullCandle = patternLabels.some(p => BULLISH_CANDLES.has(p));
  if (hasBullCandle) {
    const oversold = momentum.rsiSignal === "oversold" || momentum.rsi < 35;
    if (oversold) {
      lift += W_CANDLE_OVERSOLD;
      layers.push({ layer: "L0_candle", signal: "bullish_candle_oversold", dir: "long", weight: W_CANDLE_OVERSOLD, validated: true, note: "live" });
    } else {
      layers.push({ layer: "L0_candle", signal: "bullish_candle", weight: 0, validated: false, note: "not oversold → 0 weight" });
    }
  }

  // ── L2 trend gate — patterns are less reliable below the 200 SMA ───────────
  const above200 = trend.priceVsSma200 >= 0;
  if (!above200) {
    lift *= OUT_OF_TREND_DAMP;
    layers.push({ layer: "L2_trend", signal: "below_sma200", weight: 0, validated: false, note: `out-of-trend x${OUT_OF_TREND_DAMP}` });
  } else {
    layers.push({ layer: "L2_trend", signal: "above_sma200", weight: 0, validated: false, note: "in-trend" });
  }

  lift = Math.round(lift * 1000) / 1000;
  return { lift, tier: tierFor(lift), layers, veto, asOf };
}

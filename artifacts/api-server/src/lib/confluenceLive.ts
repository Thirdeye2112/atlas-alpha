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
import type { OHLCVBar } from "./marketData.js";
import {
  W_BULL_STRUCT, W_BEAR_STRUCT, W_CANDLE_OVERSOLD, OUT_OF_TREND_DAMP, tierFor,
  type ConfluenceRead, type ConfluenceLayer,
} from "./confluenceStore.js";

// L1 (5m intraday confirmation) — validated 2026-07-02 on a 120-liquid basket, 2023+:
// among bullish daily setups, sessions that RECLAIM+HOLD VWAP nearly double the 5d edge
// (+1.05%→+1.93%, +7pp hit, t=9.36, n=3295) while sessions that fail to hold VWAP are a
// coin-flip (+0.17%, 49%). So a held-VWAP session CONFIRMS an existing bullish setup, and a
// failed one is the validated "falling-knife" caution. Only applies WHEN a bullish setup is
// present (structure/candle lift or oversold) — the study validated it as a confirmation,
// not a standalone signal. See reports/validity/DAILY_5M_CORROBORATION.md.
const W_5M_CONFIRM = 0.50;   // confirmation bonus (< the +0.88% marginal edge; bounded)
const DAMP_5M_FAIL = 0.60;   // failed-session damp on an otherwise-bullish setup

/**
 * Intraday confirmation from 5m bars, replicating the research `confirm_5m` exactly:
 * on the MOST RECENT session, using session-anchored cumulative VWAP (typical price),
 * "confirmed" = price reclaimed VWAP intraday (crossed below→above) AND closed the
 * session above VWAP; "failed" = it didn't hold; null = not enough data.
 */
export function confirm5mVwap(bars5m: OHLCVBar[]): "confirmed" | "failed" | null {
  if (!bars5m || bars5m.length < 6) return null;
  const dayKey = (t: string) => t.slice(0, 10);              // ISO UTC date; US RTH is one UTC day
  const lastKey = dayKey(bars5m[bars5m.length - 1].time);
  const sess = bars5m.filter(b => dayKey(b.time) === lastKey);
  if (sess.length < 6) return null;
  let cumPV = 0, cumV = 0;
  const above: boolean[] = [];
  for (const b of sess) {
    const tp = (b.high + b.low + b.close) / 3;
    cumPV += tp * b.volume; cumV += b.volume;
    const vwap = cumV > 0 ? cumPV / cumV : b.close;
    above.push(b.close > vwap);
  }
  const reclaimed = above.some((a, j) => j > 0 && a && !above[j - 1]);
  const closedAbove = above[above.length - 1];
  return reclaimed && closedAbove ? "confirmed" : "failed";
}

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
  /** Most-recent-session 5m VWAP confirmation (confirm5mVwap); null when unavailable. */
  confirm5m: "confirmed" | "failed" | null = null,
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
  const oversold = momentum.rsiSignal === "oversold" || momentum.rsi < 35;
  const hasBullCandle = patternLabels.some(p => BULLISH_CANDLES.has(p));
  if (hasBullCandle) {
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

  // ── L1 intraday 5m confirmation — CONFIRMS an existing bullish setup ────────
  // Validated only as a confirmation of a bullish daily setup (structure/candle lift OR
  // oversold), never standalone. Held VWAP → bonus; failed VWAP → falling-knife caution.
  const setupPresent = lift > 0 || oversold;
  if (confirm5m !== null && setupPresent) {
    if (confirm5m === "confirmed") {
      lift += W_5M_CONFIRM;
      layers.push({ layer: "L1_5m", signal: "vwap_reclaim_held", dir: "long", weight: W_5M_CONFIRM, validated: true, note: "5m session reclaimed + held VWAP (confirms)" });
    } else {
      lift *= DAMP_5M_FAIL;
      layers.push({ layer: "L1_5m", signal: "vwap_lost", weight: 0, validated: true, note: `5m below VWAP (falling knife) → x${DAMP_5M_FAIL} caution` });
    }
  } else if (confirm5m === "confirmed") {
    // confirmation with no bullish setup to confirm — informational only, 0 weight
    layers.push({ layer: "L1_5m", signal: "vwap_held_no_setup", weight: 0, validated: false, note: "5m above VWAP but no bullish setup → 0 weight" });
  }

  lift = Math.round(lift * 1000) / 1000;
  return { lift, tier: tierFor(lift), layers, veto, asOf };
}

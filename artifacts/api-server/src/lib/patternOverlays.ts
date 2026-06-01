import type { OHLCVBar } from "./marketData.js";

export interface PatternLinePoint {
  date: string;
  price: number;
}

export interface PatternLine {
  points: PatternLinePoint[];
  style: "solid" | "dashed" | "dotted";
  color: string;
  label?: string;
}

export interface PatternTarget {
  price: number;
  label: string;
  role: "breakout" | "target" | "stop";
}

export interface PatternOverlay {
  type: "bull-flag" | "bear-flag" | "ascending-triangle" | "descending-triangle" | "double-bottom" | "head-and-shoulders";
  label: string;
  description: string;
  confidence: "high" | "medium" | "low";
  timeframe?: "daily" | "weekly";
  lines: PatternLine[];
  targets: PatternTarget[];
}

function r2(v: number) { return Math.round(v * 100) / 100; }

// ─────────────────────────────────────────────────────────────────────────────
// Peak-anchored flag detection
//
// Classic fixed-window approaches fail because the window start is arbitrary —
// it may include the pre-peak rally or the post-breakdown continuation.
// This function finds actual swing highs/lows first (the real pattern anchor),
// then measures the pole from that point, and "grows" the flag bar-by-bar,
// stopping as soon as the range exceeds the tightness threshold.  That way the
// flag boundary is determined by the price action itself, not a hard bar count.
// ─────────────────────────────────────────────────────────────────────────────
interface PeakAnchorOpts {
  pivotWindow:     number;   // bars each side for swing point (daily=3, weekly=2)
  minPolePct:      number;   // minimum pole move in %  (5)
  maxPoleBars:     number;   // max bars the pole can span (daily=12, weekly=6)
  flagMaxBars:     number;   // max bars allowed in flag   (daily=10, weekly=5)
  tightThreshold:  number;   // flagRange < poleRange * this (0.65)
  lookbackBars:    number;   // how far back to scan        (daily=80, weekly=40)
  maxPatterns:     number;   // cap on returned patterns    (3)
}

function detectPeakAnchoredFlags(
  bars:  OHLCVBar[],
  opts:  PeakAnchorOpts,
): PatternOverlay[] {
  const { pivotWindow, minPolePct, maxPoleBars, flagMaxBars,
          tightThreshold, lookbackBars, maxPatterns } = opts;

  const n       = bars.length;
  const closes  = bars.map(b => b.close);
  const highs   = bars.map(b => b.high);
  const lows    = bars.map(b => b.low);
  const volumes = bars.map(b => b.volume);

  const results:       PatternOverlay[] = [];
  const seenBreakPrices: number[]       = [];

  function addIfUnique(ov: PatternOverlay) {
    const bp = ov.targets[0].price;
    if (!seenBreakPrices.some(p => Math.abs(p - bp) / p < 0.04)) {
      seenBreakPrices.push(bp);
      results.push(ov);
    }
  }

  const scanStart = Math.max(pivotWindow, n - lookbackBars);
  // Reserve enough room for a full pole + flag after the pivot bar.
  const scanEnd   = n - 4;

  for (let i = scanStart; i < scanEnd; i++) {
    if (results.length >= maxPatterns) break;

    const lo = Math.max(0, i - pivotWindow);
    const hi = Math.min(n - 1, i + pivotWindow);

    // ── Bear flag: bar i is a swing HIGH ──────────────────────────────────
    const localMax = Math.max(...highs.slice(lo, hi + 1));
    if (highs[i] === localMax) {
      // Find deepest low in the next maxPoleBars bars
      let poleEndIdx = -1;
      let poleBottom = highs[i];
      const poleSearchEnd = Math.min(i + maxPoleBars, n - 3);
      for (let j = i + 1; j <= poleSearchEnd; j++) {
        if (lows[j] < poleBottom) { poleBottom = lows[j]; poleEndIdx = j; }
      }

      if (poleEndIdx > 0) {
        const poleGain = (closes[poleEndIdx] - closes[i]) / closes[i] * 100;
        if (poleGain < -minPolePct) {
          const poleRange = highs[i] - poleBottom;

          // Grow the flag until it exceeds tightness limit
          let flagHigh = -Infinity, flagLow = Infinity, flagEnd = -1;
          const flagSearchEnd = Math.min(poleEndIdx + flagMaxBars, n - 1);
          for (let k = poleEndIdx + 1; k <= flagSearchEnd; k++) {
            const nH = Math.max(flagHigh, highs[k]);
            const nL = Math.min(flagLow,  lows[k]);
            if (poleRange > 0 && (nH - nL) > poleRange * tightThreshold) break;
            flagHigh = nH; flagLow = nL; flagEnd = k;
          }

          if (flagEnd >= poleEndIdx + 2) {  // need ≥ 2 flag bars
            const flagStart = poleEndIdx + 1;
            const fH = highs.slice(flagStart, flagEnd + 1);
            const fL = lows.slice(flagStart, flagEnd + 1);
            const mid = Math.max(1, Math.floor(fH.length / 2));

            const volPole = volumes.slice(i, poleEndIdx + 1).reduce((s, v) => s + v, 0)
                          / (poleEndIdx - i + 1);
            const volFlag = volumes.slice(flagStart, flagEnd + 1).reduce((s, v) => s + v, 0)
                          / (flagEnd - flagStart + 1);

            if (volFlag <= volPole * 1.1) {  // volume not significantly increasing
              const breakdownPx = r2(Math.min(...fL.slice(mid)));
              const netMove     = Math.abs(closes[poleEndIdx] - closes[i]);
              const targetPx    = r2(breakdownPx - netMove);
              const stopPx      = r2(Math.max(...fH.slice(mid)));

              addIfUnique({
                type:        "bear-flag",
                label:       "Bear Flag",
                description: `${poleGain.toFixed(1)}% pole · B/D ${breakdownPx.toFixed(2)} · Target ${targetPx.toFixed(2)}`,
                confidence:  Math.abs(poleGain) > 15 ? "high" : Math.abs(poleGain) > 8 ? "medium" : "low",
                lines: [
                  {
                    points: [
                      { date: bars[i].time,        price: highs[i]   },
                      { date: bars[poleEndIdx].time, price: poleBottom },
                    ],
                    style: "dotted", color: "rgba(239,68,68,0.28)", label: "Pole",
                  },
                  {
                    points: [
                      { date: bars[flagStart].time, price: Math.max(...fH.slice(0, mid)) },
                      { date: bars[flagEnd].time,   price: Math.max(...fH.slice(mid))    },
                    ],
                    style: "solid", color: "rgba(239,68,68,0.45)", label: "Upper Channel",
                  },
                  {
                    points: [
                      { date: bars[flagStart].time, price: Math.min(...fL.slice(0, mid)) },
                      { date: bars[flagEnd].time,   price: Math.min(...fL.slice(mid))    },
                    ],
                    style: "solid", color: "#ef4444", label: "Lower Channel",
                  },
                ],
                targets: [
                  { price: breakdownPx, label: `B/D ${breakdownPx.toFixed(2)}`, role: "breakout" },
                  { price: targetPx,    label: `T1  ${targetPx.toFixed(2)}`,    role: "target"   },
                  { price: stopPx,      label: `SL  ${stopPx.toFixed(2)}`,      role: "stop"     },
                ],
              });
            }
          }
        }
      }
    }

    // ── Bull flag: bar i is a swing LOW ───────────────────────────────────
    const localMin = Math.min(...lows.slice(lo, hi + 1));
    if (lows[i] === localMin) {
      let poleEndIdx = -1;
      let polePeak   = lows[i];
      const poleSearchEnd = Math.min(i + maxPoleBars, n - 3);
      for (let j = i + 1; j <= poleSearchEnd; j++) {
        if (highs[j] > polePeak) { polePeak = highs[j]; poleEndIdx = j; }
      }

      if (poleEndIdx > 0) {
        const poleGain = (closes[poleEndIdx] - closes[i]) / closes[i] * 100;
        if (poleGain > minPolePct) {
          const poleRange = polePeak - lows[i];

          let flagHigh = -Infinity, flagLow = Infinity, flagEnd = -1;
          const flagSearchEnd = Math.min(poleEndIdx + flagMaxBars, n - 1);
          for (let k = poleEndIdx + 1; k <= flagSearchEnd; k++) {
            const nH = Math.max(flagHigh, highs[k]);
            const nL = Math.min(flagLow,  lows[k]);
            if (poleRange > 0 && (nH - nL) > poleRange * tightThreshold) break;
            flagHigh = nH; flagLow = nL; flagEnd = k;
          }

          if (flagEnd >= poleEndIdx + 2) {
            const flagStart = poleEndIdx + 1;
            const fH = highs.slice(flagStart, flagEnd + 1);
            const fL = lows.slice(flagStart, flagEnd + 1);
            const mid = Math.max(1, Math.floor(fH.length / 2));

            const volPole = volumes.slice(i, poleEndIdx + 1).reduce((s, v) => s + v, 0)
                          / (poleEndIdx - i + 1);
            const volFlag = volumes.slice(flagStart, flagEnd + 1).reduce((s, v) => s + v, 0)
                          / (flagEnd - flagStart + 1);

            if (volFlag <= volPole * 1.1) {
              const breakoutPx = r2(Math.max(...fH.slice(mid)));
              const netMove    = Math.abs(closes[poleEndIdx] - closes[i]);
              const targetPx   = r2(breakoutPx + netMove);
              const stopPx     = r2(Math.min(...fL.slice(mid)));

              addIfUnique({
                type:        "bull-flag",
                label:       "Bull Flag",
                description: `+${poleGain.toFixed(1)}% pole · B/O ${breakoutPx.toFixed(2)} · Target ${targetPx.toFixed(2)}`,
                confidence:  poleGain > 25 ? "high" : poleGain > 12 ? "medium" : "low",
                lines: [
                  {
                    points: [
                      { date: bars[i].time,        price: lows[i]  },
                      { date: bars[poleEndIdx].time, price: polePeak },
                    ],
                    style: "dotted", color: "rgba(34,197,94,0.28)", label: "Pole",
                  },
                  {
                    points: [
                      { date: bars[flagStart].time, price: Math.max(...fH.slice(0, mid)) },
                      { date: bars[flagEnd].time,   price: Math.max(...fH.slice(mid))    },
                    ],
                    style: "solid", color: "#22c55e", label: "Upper Channel",
                  },
                  {
                    points: [
                      { date: bars[flagStart].time, price: Math.min(...fL.slice(0, mid)) },
                      { date: bars[flagEnd].time,   price: Math.min(...fL.slice(mid))    },
                    ],
                    style: "solid", color: "rgba(34,197,94,0.45)", label: "Lower Channel",
                  },
                ],
                targets: [
                  { price: breakoutPx, label: `B/O ${breakoutPx.toFixed(2)}`, role: "breakout" },
                  { price: targetPx,   label: `T1  ${targetPx.toFixed(2)}`,   role: "target"   },
                  { price: stopPx,     label: `SL  ${stopPx.toFixed(2)}`,     role: "stop"     },
                ],
              });
            }
          }
        }
      }
    }
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Triangle / other structure detection (tip-of-series only)
// ─────────────────────────────────────────────────────────────────────────────
function detectTriangles(bars: OHLCVBar[]): PatternOverlay[] {
  const n = bars.length;
  if (n < 25) return [];

  const highs  = bars.map(b => b.high);
  const lows   = bars.map(b => b.low);

  const win  = 20;
  const tH   = highs.slice(-win);
  const tL   = lows.slice(-win);
  const maxH = Math.max(...tH), minH = Math.min(...tH);
  const maxL = Math.max(...tL), minL = Math.min(...tL);

  const startIdx  = n - win;
  const endIdx    = n - 1;
  const startDate = bars[startIdx].time;
  const endDate   = bars[endIdx].time;

  // Ascending triangle: flat top + rising lows
  if (maxH > 0 && (maxH - minH) / maxH < 0.025
      && tL[tL.length - 1] > tL[0] + (maxL - minL) * 0.35) {
    const resistance = r2(maxH);
    const curSupport = r2(tL[tL.length - 1]);
    const target     = r2(resistance + (resistance - tL[0]));
    return [{
      type: "ascending-triangle", label: "Ascending Triangle", confidence: "medium",
      description: `Flat top ${resistance.toFixed(2)} · Rising support · B/O target ${target.toFixed(2)}`,
      lines: [
        { points: [{ date: startDate, price: resistance }, { date: endDate, price: resistance }],
          style: "solid", color: "#ef4444", label: "Resistance" },
        { points: [{ date: startDate, price: r2(tL[0]) }, { date: endDate, price: curSupport }],
          style: "solid", color: "#22c55e", label: "Rising Support" },
      ],
      targets: [
        { price: resistance, label: `B/O ${resistance.toFixed(2)}`, role: "breakout" },
        { price: target,     label: `T1  ${target.toFixed(2)}`,     role: "target"   },
      ],
    }];
  }

  // Descending triangle: flat support + falling highs
  if (maxL > 0 && (maxL - minL) / maxL < 0.025
      && tH[tH.length - 1] < tH[0] - (maxH - minH) * 0.35) {
    const support   = r2(minL);
    const curResist = r2(tH[tH.length - 1]);
    const target    = r2(support - (tH[0] - support));
    return [{
      type: "descending-triangle", label: "Descending Triangle", confidence: "medium",
      description: `Flat support ${support.toFixed(2)} · Falling highs · B/D target ${target.toFixed(2)}`,
      lines: [
        { points: [{ date: startDate, price: support }, { date: endDate, price: support }],
          style: "solid", color: "#22c55e", label: "Support" },
        { points: [{ date: startDate, price: r2(tH[0]) }, { date: endDate, price: curResist }],
          style: "solid", color: "#ef4444", label: "Falling Resistance" },
      ],
      targets: [
        { price: support, label: `B/D ${support.toFixed(2)}`, role: "breakout" },
        { price: target,  label: `T1  ${target.toFixed(2)}`,  role: "target"   },
      ],
    }];
  }

  return [];
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

const DAILY_OPTS: PeakAnchorOpts = {
  pivotWindow:    3,
  minPolePct:     5,
  maxPoleBars:    12,
  flagMaxBars:    10,
  tightThreshold: 0.65,
  lookbackBars:   90,
  maxPatterns:    3,
};

const WEEKLY_OPTS: PeakAnchorOpts = {
  pivotWindow:    2,
  minPolePct:     5,
  maxPoleBars:    6,
  flagMaxBars:    5,
  tightThreshold: 0.65,
  lookbackBars:   40,
  maxPatterns:    2,
};

/**
 * Multi-timeframe pattern detection.
 * Runs peak-anchored flag detection on daily and weekly bars separately,
 * merges results (dedup by price zone), and labels each with its timeframe.
 * Returns up to 4 patterns total, ordered by recency (most recent pole first).
 */
export function calcPatternOverlaysMultiTF(
  dailyBars:  OHLCVBar[],
  weeklyBars: OHLCVBar[],
): PatternOverlay[] {
  const out:   PatternOverlay[] = [];
  const seen:  number[]         = [];

  function merge(ov: PatternOverlay, tf: "daily" | "weekly") {
    const bp = ov.targets[0].price;
    if (!seen.some(p => Math.abs(p - bp) / p < 0.04)) {
      seen.push(bp);
      out.push({ ...ov, timeframe: tf });
    }
  }

  // Daily first (higher resolution / more recent detail)
  if (dailyBars.length >= 20) {
    for (const ov of detectPeakAnchoredFlags(dailyBars, DAILY_OPTS)) {
      if (out.length >= 4) break;
      merge(ov, "daily");
    }
  }

  // Weekly (catches longer-term setups the daily might miss)
  if (weeklyBars.length >= 15) {
    for (const ov of detectPeakAnchoredFlags(weeklyBars, WEEKLY_OPTS)) {
      if (out.length >= 4) break;
      merge(ov, "weekly");
    }
  }

  // If no flags found on either timeframe, fall back to tip-of-series triangles
  if (out.length === 0 && dailyBars.length >= 25) {
    for (const ov of detectTriangles(dailyBars)) {
      out.push({ ...ov, timeframe: "daily" });
    }
  }

  return out;
}

/**
 * Single-timeframe entry point kept for backward compatibility.
 */
export function calcPatternOverlays(bars: OHLCVBar[]): PatternOverlay[] {
  return calcPatternOverlaysMultiTF(bars, []);
}

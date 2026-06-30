import type { OHLCVBar } from "./marketData.js";

// ─────────────────────────────────────────────────────────────────────────────
// Forming-pattern projector (right-edge, live)
//
// Unlike calcPatternOverlays (CONFIRMED breakouts only), this looks at the live
// geometry forming NOW on the most recent swing pivots and projects WHERE/WHEN the
// pattern will fulfil and the target after — so the chart can overlay an in-progress
// pattern and its projection as candles build.
//
// Direction / target / expected-low / bars-to-fulfilment come from the data-driven
// pattern_edge table (atlas-research pattern_outcomes_study, 912,881 occurrences /
// 3,349 names). Six patterns' profitable side differs from the textbook side; here
// each forming geometry is projected to the side history actually pays.
// ─────────────────────────────────────────────────────────────────────────────

export interface FormingPattern {
  name: string;                 // rising_wedge | falling_wedge | ascending_triangle | ...
  label: string;                // human label incl. "(forming)"
  status: "forming";
  direction: "long" | "short";  // data-driven projected side
  flipped: boolean;             // true when this differs from the textbook side
  breakoutLevel: number;        // price the breakout is projected through
  barsToBreakout: number;       // projected bars until fulfilment
  target: number;               // projected target price after breakout
  expectedLow: number;          // expected low / bid-zone before/around fulfilment
  confidence: number;           // 0–99, history + volume aware
  winRate: number | null;       // historical win rate of this projection
  sampleN: number | null;       // historical sample size
  rvol: number | null;          // current relative volume (expansion confirms)
  upperLine: { time: string; price: number }[];  // upper trendline / flag channel top (2 pts)
  lowerLine: { time: string; price: number }[];  // lower trendline / flag channel bottom (2 pts)
  poleLine?: { time: string; price: number }[];  // flag/pennant pole (flagpole), 2 pts
}

// Data-driven edge (synced from atlas-research/reports/stocks/pattern_edge.json).
// target/low are % moves from entry; bars = median bars to the favorable peak.
const PATTERN_EDGE: Record<string, { direction: "long" | "short"; target: number; low: number; bars: number; win: number; n: number; flipped: boolean }> = {
  rising_wedge:        { direction: "short", target: 3.92, low: -3.44, bars: 5, win: 50.7, n: 72484, flipped: false },
  falling_wedge:       { direction: "long",  target: 5.16, low: -4.11, bars: 6, win: 53.8, n: 74215, flipped: false },
  ascending_triangle:  { direction: "long",  target: 3.70, low: -3.79, bars: 6, win: 50.8, n: 33649, flipped: false },
  descending_triangle: { direction: "long",  target: 5.13, low: -4.53, bars: 6, win: 51.9, n: 33924, flipped: true },
  symmetric_triangle:  { direction: "long",  target: 4.15, low: -4.16, bars: 6, win: 50.7, n: 39645, flipped: false },
  rectangle:           { direction: "long",  target: 4.40, low: -4.03, bars: 6, win: 52.4, n: 17650, flipped: false },
  bull_flag:           { direction: "long",  target: 4.17, low: -4.18, bars: 6, win: 50.6, n: 40975, flipped: false },
  bear_flag:           { direction: "long",  target: 5.72, low: -5.26, bars: 6, win: 52.9, n: 35833, flipped: true },
};

const LABELS: Record<string, string> = {
  rising_wedge: "Rising Wedge", falling_wedge: "Falling Wedge",
  ascending_triangle: "Ascending Triangle", descending_triangle: "Descending Triangle",
  symmetric_triangle: "Symmetric Triangle", rectangle: "Rectangle / Range",
  bull_flag: "Bull Flag", bear_flag: "Bear Flag",
};

interface Pivot { idx: number; price: number; kind: "H" | "L"; }

/** Interleaved swing pivots (highs & lows) over the bars, window each side. */
function swingPivots(bars: OHLCVBar[], window = 3): Pivot[] {
  const n = bars.length; const piv: Pivot[] = [];
  for (let i = window; i < n - window; i++) {
    let isHigh = true, isLow = true;
    for (let j = i - window; j <= i + window; j++) {
      if (j === i) continue;
      if (bars[j].high >= bars[i].high) isHigh = false;
      if (bars[j].low  <= bars[i].low)  isLow  = false;
    }
    if (isHigh) piv.push({ idx: i, price: bars[i].high, kind: "H" });
    else if (isLow) piv.push({ idx: i, price: bars[i].low, kind: "L" });
  }
  return piv;
}

/** Least-squares slope+intercept through (idx, price) points. */
function fitLine(pts: { idx: number; price: number }[]): { slope: number; ic: number } | null {
  if (pts.length < 2) return null;
  const n = pts.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const p of pts) { sx += p.idx; sy += p.price; sxx += p.idx * p.idx; sxy += p.idx * p.price; }
  const d = n * sxx - sx * sx;
  if (Math.abs(d) < 1e-9) return null;
  const slope = (n * sxy - sx * sy) / d;
  return { slope, ic: (sy - slope * sx) / n };
}

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

function relVol(bars: OHLCVBar[]): number | null {
  const last = bars.length - 1;
  if (last <= 20) return null;
  let s = 0; for (let k = last - 20; k < last; k++) s += bars[k].volume;
  const avg = s / 20;
  return avg > 0 ? bars[last].volume / avg : null;
}

function buildForming(geo: string, px: number, breakoutLevel: number, barsTo: number,
                      rvol: number | null, upper: { time: string; price: number }[],
                      lower: { time: string; price: number }[],
                      pole?: { time: string; price: number }[]): FormingPattern {
  const e = PATTERN_EDGE[geo];
  // The historical move plays out AFTER the breakout, so measure target/exit from the
  // breakout level (the projected entry), not the current mid-pattern price. For a long
  // this keeps target > breakout > exit; for a short, target < breakout < exit.
  const ref = breakoutLevel > 0 ? breakoutLevel : px;
  const dirSign = e.direction === "long" ? 1 : -1;
  const target = ref * (1 + dirSign * Math.abs(e.target) / 100);
  const expectedLow = ref * (1 - dirSign * Math.abs(e.low) / 100);
  let conf = Math.min(95, 40 + (e.win - 50) * 1.5 + (e.n >= 1000 ? 10 : 0));
  if (rvol && rvol > 1.3) conf = Math.min(99, conf + 8);
  return {
    name: geo, label: `${LABELS[geo]} (forming)`, status: "forming",
    direction: e.direction, flipped: e.flipped,
    breakoutLevel: r4(breakoutLevel), barsToBreakout: e.bars || barsTo,
    target: r4(target), expectedLow: r4(expectedLow),
    confidence: Math.round(conf), winRate: e.win, sampleN: e.n,
    rvol: rvol ? Math.round(rvol * 100) / 100 : null,
    upperLine: upper, lowerLine: lower, ...(pole ? { poleLine: pole } : {}),
  };
}

/**
 * Forming FLAG / PENNANT: a sharp POLE (swing low -> swing high) followed by a tight
 * CONSOLIDATION (the flag) that has NOT yet broken out of the pole high. Returns the
 * pole line + the flag channel so the chart can draw the actual shape.
 */
function detectFormingFlag(bars: OHLCVBar[]): FormingPattern | null {
  const piv = swingPivots(bars, 2);
  if (piv.length < 2) return null;
  const last = bars.length - 1;
  // find the most recent strong pole: an L pivot then an H pivot, >=4% in <=15 bars,
  // whose high is recent enough that a flag could still be forming after it.
  for (let i = piv.length - 1; i >= 1; i--) {
    const hiP = piv[i], loP = piv[i - 1];
    if (hiP.kind !== "H" || loP.kind !== "L") continue;
    const pole = (hiP.price - loP.price) / loP.price;
    const poleBars = hiP.idx - loP.idx;
    if (pole < 0.04 || poleBars > 15 || poleBars < 1) continue;
    const flagBars = last - hiP.idx;
    if (flagBars < 3 || flagBars > 15) continue;             // flag must be forming, not stale
    // flag window: bars after the pole high
    const seg = bars.slice(hiP.idx, last + 1);
    const segHi = Math.max(...seg.map(b => b.high));
    const segLo = Math.min(...seg.map(b => b.low));
    const px = bars[last].close;
    // still inside the flag (not yet broken out above the pole high) and a real pullback
    if (segHi > hiP.price * 1.005) return null;              // already broke out -> not forming
    const pullback = (hiP.price - segLo) / (hiP.price - loP.price);
    if (pullback < 0.1 || pullback > 0.8) return null;       // healthy flag retraces 10–80% of pole
    // channel lines over the flag bars (top through highs, bottom through lows)
    const fpts = seg.map((b, k) => ({ idx: hiP.idx + k, hi: b.high, lo: b.low }));
    const top = fitLine(fpts.map(p => ({ idx: p.idx, price: p.hi })));
    const bot = fitLine(fpts.map(p => ({ idx: p.idx, price: p.lo })));
    if (!top || !bot) return null;
    const geo = pole > 0 ? "bull_flag" : "bear_flag";
    const breakout = hiP.price;                              // breakout = pole high
    const upper = [{ time: bars[hiP.idx].time, price: r4(top.slope * hiP.idx + top.ic) },
                   { time: bars[last].time,    price: r4(top.slope * last + top.ic) }];
    const lower = [{ time: bars[hiP.idx].time, price: r4(bot.slope * hiP.idx + bot.ic) },
                   { time: bars[last].time,    price: r4(bot.slope * last + bot.ic) }];
    const poleLine = [{ time: bars[loP.idx].time, price: r4(loP.price) },
                      { time: bars[hiP.idx].time, price: r4(hiP.price) }];
    return buildForming(geo, px, breakout, Math.max(2, Math.round(poleBars / 2)),
                        relVol(bars), upper, lower, poleLine);
  }
  return null;
}

/**
 * Detect forming (not-yet-broken-out) flags / wedges / triangles / rectangles on the
 * right edge and project breakout, target, expected low, and bars-to-fulfilment.
 */
export function detectFormingPatterns(bars: OHLCVBar[]): FormingPattern[] {
  const out: FormingPattern[] = [];
  if (bars.length < 30) return out;

  // Flags first (pole + channel is the most recognisable forming shape).
  const flag = detectFormingFlag(bars);
  if (flag) out.push(flag);

  const piv = swingPivots(bars, 3);
  if (piv.length < 4) return out;

  const w = piv.slice(-4);
  const highs = w.filter(p => p.kind === "H");
  const lows  = w.filter(p => p.kind === "L");
  if (highs.length < 2 || lows.length < 2) return out;
  const hi = fitLine(highs), lo = fitLine(lows);
  if (!hi || !lo) return out;

  const hline = (j: number) => hi.slope * j + hi.ic;
  const lline = (j: number) => lo.slope * j + lo.ic;
  const i0 = w[0].idx, i1 = w[w.length - 1].idx;
  const last = bars.length - 1;
  const w0 = hline(i0) - lline(i0), w1 = hline(i1) - lline(i1);
  if (w0 <= 0 || w1 <= 0) return out;

  const px = bars[last].close;
  const rvol = relVol(bars);  // volume expansion confirms a forming pattern

  const hiChg = hline(i1) - hline(i0);
  const loChg = lline(i1) - lline(i0);
  const FLAT = 0.20 * w0;
  const converging = w1 < w0 * 0.75;
  const parallel   = w1 >= w0 * 0.75 && w1 <= w0 * 1.3;

  let geo: string | null = null;
  if (converging && lline(last) < px && px < hline(last)) {
    if (hi.slope > 0 && lo.slope > 0 && lo.slope > hi.slope) geo = "rising_wedge";
    else if (hi.slope < 0 && lo.slope < 0 && hi.slope < lo.slope) geo = "falling_wedge";
    else if (Math.abs(hiChg) < FLAT && loChg >= FLAT) geo = "ascending_triangle";
    else if (Math.abs(loChg) < FLAT && hiChg <= -FLAT) geo = "descending_triangle";
    else geo = "symmetric_triangle";
  } else if (parallel && Math.abs(hiChg) < FLAT && Math.abs(loChg) < FLAT) {
    geo = "rectangle";
  }
  if (!geo) return out;

  const isLong = PATTERN_EDGE[geo].direction === "long";
  const breakoutLevel = isLong ? hline(last) : lline(last);
  // bars to breakout: where converging lines meet (apex), capped; else median
  const conv = (w0 - w1) / Math.max(i1 - i0, 1);
  const barsTo = conv > 1e-9 ? Math.max(1, Math.min(Math.round(w1 / conv), 30)) : 10;
  const upper = [{ time: bars[i0].time, price: r4(hline(i0)) }, { time: bars[last].time, price: r4(hline(last)) }];
  const lower = [{ time: bars[i0].time, price: r4(lline(i0)) }, { time: bars[last].time, price: r4(lline(last)) }];
  out.push(buildForming(geo, px, breakoutLevel, barsTo, rvol, upper, lower));
  return out;
}

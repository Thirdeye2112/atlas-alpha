import { fetchOHLCV, type OHLCVBar } from "./marketData.js";
import { ohlcvCache } from "./cache.js";
import { logger } from "./logger.js";

// ─── Config ───────────────────────────────────────────────────────────────────

const SWING_LOOKBACK     = 25;   // bars to look back to find the pivot
const MAX_FORWARD_BARS   = 50;   // max bars forward to hunt for retrace
const COMPARABLE_TOL     = 0.60; // accept moves within ±60% of current move magnitude
const MIN_MOVE_PCT       = 0.40; // ignore trivial moves (< 0.4%)
const MIN_COMPARABLE     = 5;    // need at least 5 analogues for stats

// Period to fetch per interval (more bars → richer history)
const PERIOD_FOR_INTERVAL: Record<string, string> = {
  "1h":  "2y",
  "1d":  "5y",
  "1wk": "5y",
};

// Bar-width in minutes (used to estimate date from medianBars)
const BAR_MINUTES: Record<string, number> = {
  "1h":  60,
  "1d":  1440,
  "1wk": 7 * 1440,
};

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RetracementTarget {
  level:       50 | 75 | 100;
  price:       number;           // exact price at this retrace level
  hitRate:     number | null;    // % of comparable moves that reached this level
  medianBars:  number | null;    // median bars to reach it (among those that did)
  expectedDate: string | null;   // rough calendar estimate
  comparableN: number;
}

export interface RetracementForecast {
  ticker:    string;
  interval:  string;
  currentMove: {
    direction:    "up" | "down";
    pivotDate:    string;
    pivotPrice:   number;
    currentPrice: number;
    movePct:      number;   // absolute % magnitude of move
    moveBars:     number;   // bars elapsed since pivot
  };
  targets:           RetracementTarget[];
  comparableMovesN:  number;
  analyzedBars:      number;
  note:              string | null;
  cachedAt:          string;
}

// ─── Pivot detection ─────────────────────────────────────────────────────────
// Given a slice of bars, find the most extreme high/low and the direction of
// the move from that pivot to the last bar.

interface SwingResult {
  direction:  "up" | "down";
  pivotIdx:   number;   // index within the slice
  pivotPrice: number;
  movePct:    number;
}

function detectSwing(slice: OHLCVBar[]): SwingResult {
  const last = slice[slice.length - 1];
  const cur  = last.close;

  // Find highest high and lowest low across the lookback window
  let hiPrice = -Infinity, hiIdx = 0;
  let loPrice =  Infinity, loIdx = 0;
  for (let i = 0; i < slice.length - 1; i++) {   // exclude last bar
    if (slice[i].high > hiPrice) { hiPrice = slice[i].high; hiIdx = i; }
    if (slice[i].low  < loPrice) { loPrice = slice[i].low;  loIdx = i; }
  }

  const movePctFromLow  = (cur - loPrice) / loPrice * 100;   // bullish move
  const movePctFromHigh = (hiPrice - cur) / hiPrice * 100;   // bearish move

  if (movePctFromLow >= movePctFromHigh) {
    return { direction: "up", pivotIdx: loIdx, pivotPrice: loPrice, movePct: movePctFromLow };
  } else {
    return { direction: "down", pivotIdx: hiIdx, pivotPrice: hiPrice, movePct: movePctFromHigh };
  }
}

// ─── Retrace target prices ────────────────────────────────────────────────────

function retracePrices(
  direction:  "up" | "down",
  pivotPrice: number,
  curPrice:   number,
): Record<50 | 75 | 100, number> {
  const move = curPrice - pivotPrice;  // positive for up, negative for down
  return {
    50:  curPrice - move * 0.50,   // halfway back to pivot
    75:  curPrice - move * 0.75,   // three-quarters back
    100: pivotPrice,               // fully back
  };
}

// ─── Median helper ────────────────────────────────────────────────────────────

function median(arr: number[]): number | null {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}

// ─── Calendar date estimate ───────────────────────────────────────────────────

function estimateDate(medianBars: number | null, interval: string): string | null {
  if (medianBars === null) return null;
  const minutes = BAR_MINUTES[interval] ?? 1440;
  const msAhead = medianBars * minutes * 60_000;
  return new Date(Date.now() + msAhead).toISOString().slice(0, 10);
}

// ─── Main computation ─────────────────────────────────────────────────────────

export async function computeRetracementForecast(
  ticker:   string,
  interval  = "1d",
): Promise<RetracementForecast> {
  const cacheKey = `retr:${ticker}:${interval}`;
  const cached = ohlcvCache.get<RetracementForecast>(cacheKey);
  if (cached) return cached;

  const period = PERIOD_FOR_INTERVAL[interval] ?? "2y";
  const bars   = await fetchOHLCV(ticker, period, interval);

  if (bars.length < SWING_LOOKBACK + 10) {
    throw new Error(`Insufficient OHLCV data for ${ticker} (${bars.length} bars)`);
  }

  logger.debug({ ticker, interval, bars: bars.length }, "retracement: computing");

  // ── Detect current swing ────────────────────────────────────────────────────
  const lookbackSlice = bars.slice(-SWING_LOOKBACK);
  const swing = detectSwing(lookbackSlice);

  const pivotBarIdx = bars.length - SWING_LOOKBACK + swing.pivotIdx;
  const pivotBar    = bars[pivotBarIdx];
  const lastBar     = bars[bars.length - 1];
  const moveBars    = bars.length - 1 - pivotBarIdx;

  const currentMove = {
    direction:    swing.direction,
    pivotDate:    pivotBar.time,
    pivotPrice:   swing.pivotPrice,
    currentPrice: lastBar.close,
    movePct:      Math.round(swing.movePct * 100) / 100,
    moveBars,
  };

  // Trivial move guard
  let note: string | null = null;
  if (swing.movePct < MIN_MOVE_PCT) {
    note = `Move from pivot is only ${swing.movePct.toFixed(2)}% — too small for reliable retracement analysis.`;
  }

  const targets50Bars:  number[] = [];
  const targets75Bars:  number[] = [];
  const targets100Bars: number[] = [];
  let comparableMovesN = 0;

  // ── Scan history for comparable moves ───────────────────────────────────────
  // For each bar from SWING_LOOKBACK to bars.length-MAX_FORWARD_BARS-1, compute
  // the swing at that point and check if it's comparable to the current move.
  const scanEnd = bars.length - MAX_FORWARD_BARS - 1;
  for (let i = SWING_LOOKBACK; i < scanEnd; i++) {
    const slice = bars.slice(i - SWING_LOOKBACK, i + 1);
    const s     = detectSwing(slice);

    if (s.direction !== swing.direction) continue;
    if (s.movePct < MIN_MOVE_PCT) continue;

    const ratio = Math.abs(s.movePct - swing.movePct) / swing.movePct;
    if (ratio > COMPARABLE_TOL) continue;

    comparableMovesN++;

    // Compute retrace target prices for this historical move
    const histPivotPrice = s.pivotPrice;
    const histCurPrice   = bars[i].close;
    const tgt = retracePrices(s.direction, histPivotPrice, histCurPrice);

    let hit50 = false, hit75 = false, hit100 = false;
    let bar50: number | null = null;
    let bar75: number | null = null;
    let bar100: number | null = null;

    for (let j = i + 1; j <= i + MAX_FORWARD_BARS && j < bars.length; j++) {
      const fwd = bars[j];
      const barsElapsed = j - i;

      if (!hit50) {
        const reached = s.direction === "up"
          ? fwd.low  <= tgt[50]
          : fwd.high >= tgt[50];
        if (reached) { hit50 = true; bar50 = barsElapsed; }
      }
      if (!hit75) {
        const reached = s.direction === "up"
          ? fwd.low  <= tgt[75]
          : fwd.high >= tgt[75];
        if (reached) { hit75 = true; bar75 = barsElapsed; }
      }
      if (!hit100) {
        const reached = s.direction === "up"
          ? fwd.low  <= tgt[100]
          : fwd.high >= tgt[100];
        if (reached) { hit100 = true; bar100 = barsElapsed; }
      }

      if (hit50 && hit75 && hit100) break;
    }

    if (hit50  && bar50  !== null) targets50Bars.push(bar50);
    if (hit75  && bar75  !== null) targets75Bars.push(bar75);
    if (hit100 && bar100 !== null) targets100Bars.push(bar100);
  }

  const curTgt = retracePrices(swing.direction, swing.pivotPrice, lastBar.close);

  function makeTarget(
    level: 50 | 75 | 100,
    barsList: number[],
  ): RetracementTarget {
    const hitRate    = comparableMovesN >= MIN_COMPARABLE
      ? Math.round(barsList.length / comparableMovesN * 100)
      : null;
    const med = median(barsList);
    return {
      level,
      price:        Math.round(curTgt[level] * 100) / 100,
      hitRate,
      medianBars:   med !== null ? Math.round(med) : null,
      expectedDate: estimateDate(med !== null ? Math.round(med) : null, interval),
      comparableN:  barsList.length,
    };
  }

  const result: RetracementForecast = {
    ticker,
    interval,
    currentMove,
    targets: [
      makeTarget(50,  targets50Bars),
      makeTarget(75,  targets75Bars),
      makeTarget(100, targets100Bars),
    ],
    comparableMovesN,
    analyzedBars: bars.length,
    note,
    cachedAt: new Date().toISOString(),
  };

  ohlcvCache.set(cacheKey, result);
  logger.info({ ticker, interval, comparableMovesN, movePct: swing.movePct }, "retracement: complete");
  return result;
}

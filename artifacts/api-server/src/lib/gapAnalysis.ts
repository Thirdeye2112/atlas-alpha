import {
  RSI, MACD, BollingerBands, SMA, ATR, OBV,
} from "technicalindicators";
import { fetchOHLCV, type OHLCVBar } from "./marketData.js";
import { SCANNER_UNIVERSE } from "./scannerUniverse.js";
import { logger } from "./logger.js";

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface PreGapFeatures {
  rsi: number;              // RSI at T-1 (0-100)
  rsiTrend: number;         // RSI[T-1] - RSI[T-6] (momentum shift)
  macdHistPct: number;      // MACD histogram / close * 100
  bbPosition: number;       // (close-bbLow)/(bbHigh-bbLow), 0=lower, 1=upper band
  bbWidthPct: number;       // (bbHigh-bbLow)/bbMid * 100 — squeeze when low
  atrPct: number;           // ATR / close * 100
  relVol5: number;          // avg_vol(5d) / avg_vol(20d) — compression < 1
  relVol1: number;          // vol[T-1] / avg_vol(20d)
  consecutiveDays: number;  // positive = consecutive up days, negative = down
  priceVsSma20: number;     // % above/below SMA20
  priceVsSma50: number;     // % above/below SMA50
  priceVsSma200: number;    // % above/below SMA200
  prevWick: number;         // (close-low)/(high-low) at T-1
  prevDayChangePct: number; // % change on the day before the gap
}

export interface GapEvent {
  ticker: string;
  date: string;
  gapPct: number;
  direction: "up" | "down";
  priorClose: number;
  openPrice: number;
  closePrice: number;
  volumeX: number;          // relative to 20-day avg at time of gap
  features: PreGapFeatures;
  ft1Pct: number;           // (close[T] - open[T]) / open[T] * 100 — same-day continuation
  ft5Pct: number | null;    // (close[T+5] - open[T]) / open[T] * 100
}

export interface FactorStat {
  factor: keyof PreGapFeatures;
  label: string;
  description: string;
  unit: string;
  baselineMean: number;
  baselineStd: number;
  gapUpMean: number;
  gapDownMean: number;
  gapUpEffect: number;    // (gapUpMean - baselineMean) / baselineStd (Cohen-d like)
  gapDownEffect: number;
  gapUpN: number;
  gapDownN: number;
  baselineN: number;
}

export interface FollowThroughStats {
  n: number;
  sameDayMean: number;   // mean % change from open to close on gap day
  day5Mean: number | null;
  gapFillRate5d: number; // % where price returned to prior close within 5 days
}

export interface SetupBacktest {
  setupDays: number;        // days where ATR≥3.2%, BB≥15%, RVOL≥1.2x all met
  gapWithin1d: number;      // of those, how many had a gap the very next day
  gapWithin2d: number;      // gap within 2 trading days
  gapWithin3d: number;      // gap within 3 trading days (first occurrence only)
  hitRate1d: number;        // gapWithin1d / setupDays * 100
  hitRate2d: number;
  hitRate3d: number;
  avgGapMagnitude: number;  // avg |gapPct| of the first gap after a setup day
  randomBaseline1d: number; // % of ALL days (no filter) that had a gap next day — baseline
  liftRatio3d: number;      // hitRate3d / randomBaseline1d — how much the filter lifts probability
}

export interface GapAnalysisResult {
  metadata: {
    tickers: number;
    totalGaps: number;
    gapUpCount: number;
    gapDownCount: number;
    threshold: number;
    period: string;
    analyzedAt: string;
  };
  factorRanking: FactorStat[];
  followThrough: {
    gapUp: FollowThroughStats;
    gapDown: FollowThroughStats;
  };
  recentGaps: GapEvent[];
  setupBacktest: SetupBacktest;
}

// ─── Indicator helpers ────────────────────────────────────────────────────────

function padLeft<T>(arr: T[], targetLen: number, fill: T): T[] {
  const need = targetLen - arr.length;
  return need <= 0 ? arr : [...Array(need).fill(fill), ...arr];
}

function rsiArr(closes: number[], period = 14): number[] {
  if (closes.length < period + 1) return Array(closes.length).fill(NaN);
  return padLeft(RSI.calculate({ values: closes, period }), closes.length, NaN);
}

function smaArr(values: number[], period: number): number[] {
  if (values.length < period) return Array(values.length).fill(NaN);
  return padLeft(SMA.calculate({ values, period }), values.length, NaN);
}

function macdHistArr(closes: number[]): number[] {
  if (closes.length < 34) return Array(closes.length).fill(NaN);
  const raw = MACD.calculate({
    values: closes,
    fastPeriod: 12, slowPeriod: 26, signalPeriod: 9,
    SimpleMAOscillator: false, SimpleMASignal: false,
  });
  return padLeft(raw.map(r => r.histogram ?? 0), closes.length, NaN);
}

interface BBPoint { upper: number; middle: number; lower: number; }
const BB_NAN: BBPoint = { upper: NaN, middle: NaN, lower: NaN };

function bbArr(closes: number[], period = 20): BBPoint[] {
  if (closes.length < period) return Array(closes.length).fill(BB_NAN);
  const raw = BollingerBands.calculate({ values: closes, period, stdDev: 2 });
  return padLeft(raw as BBPoint[], closes.length, BB_NAN);
}

function atrArr(highs: number[], lows: number[], closes: number[], period = 14): number[] {
  if (closes.length < period) return Array(closes.length).fill(NaN);
  return padLeft(
    ATR.calculate({ high: highs, low: lows, close: closes, period }),
    closes.length, NaN
  );
}

function obvArr(closes: number[], volumes: number[]): number[] {
  return OBV.calculate({ close: closes, volume: volumes });
}

// ─── Statistics helpers ───────────────────────────────────────────────────────

function arrayMean(arr: number[]): number {
  if (!arr.length) return NaN;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function arrayStd(arr: number[], m: number): number {
  if (arr.length < 2) return 1;
  return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / (arr.length - 1)) || 1;
}

function r2(n: number): number { return Math.round(n * 100) / 100; }

// ─── Per-ticker analysis ──────────────────────────────────────────────────────

interface SetupBacktestCounters {
  setupDays: number;
  gapWithin1d: number;
  gapWithin2d: number;
  gapWithin3d: number;
  totalMagnitude: number;
  magnitudeCount: number;
  totalDays: number;
  totalGapDays: number;
}

type Cohorts = Record<keyof PreGapFeatures, { baseline: number[]; gapUp: number[]; gapDown: number[] }>;

const FACTOR_KEYS: Array<keyof PreGapFeatures> = [
  "rsi", "rsiTrend", "macdHistPct", "bbPosition", "bbWidthPct",
  "atrPct", "relVol5", "relVol1", "consecutiveDays",
  "priceVsSma20", "priceVsSma50", "priceVsSma200",
  "prevWick", "prevDayChangePct",
];

function makeCohorts(): Cohorts {
  return Object.fromEntries(
    FACTOR_KEYS.map(k => [k, { baseline: [], gapUp: [], gapDown: [] }])
  ) as unknown as Cohorts;
}

async function analyzeTickerGaps(
  ticker: string,
  threshold: number,
  cohorts: Cohorts,
  allGaps: GapEvent[],
  setupBt: SetupBacktestCounters
): Promise<void> {
  let bars: OHLCVBar[];
  try {
    bars = await fetchOHLCV(ticker, "1y", "1d");
  } catch {
    return;
  }
  if (bars.length < 60) return;

  const n = bars.length;
  const opens   = bars.map(b => b.open);
  const highs   = bars.map(b => b.high);
  const lows    = bars.map(b => b.low);
  const closes  = bars.map(b => b.close);
  const volumes = bars.map(b => b.volume);

  const rsi14   = rsiArr(closes, 14);
  const macdH   = macdHistArr(closes);
  const bb20    = bbArr(closes, 20);
  const atr14   = atrArr(highs, lows, closes, 14);
  const sma20   = smaArr(closes, 20);
  const sma50   = smaArr(closes, 50);
  const sma200  = smaArr(closes, 200);
  const obv     = obvArr(closes, volumes);

  for (let i = 40; i < n - 5; i++) {
    const j = i - 1; // T-1 index (features extracted here)
    // Skip if core indicators aren't available
    if (isNaN(rsi14[j]) || isNaN(macdH[j]) || isNaN(sma20[j]) || isNaN(sma50[j])) continue;

    // ── Gap detection ────────────────────────────────────────────────────────
    const gapPct = ((opens[i] - closes[j]) / closes[j]) * 100;
    const isGap = Math.abs(gapPct) >= threshold;
    const dir: "up" | "down" = gapPct >= 0 ? "up" : "down";

    // ── Pre-gap feature extraction at j (T-1) ──────────────────────────────
    // RSI trend
    const rsiTrend = j >= 5 && !isNaN(rsi14[j - 5]) ? rsi14[j] - rsi14[j - 5] : 0;

    // MACD histogram %
    const macdHistPct = closes[j] > 0 ? (macdH[j] / closes[j]) * 100 : 0;

    // Bollinger Band position and width
    const bbj = bb20[j];
    const bbRange = bbj.upper - bbj.lower;
    const bbPosition = bbRange > 0 ? (closes[j] - bbj.lower) / bbRange : 0.5;
    const bbWidthPct = bbj.middle > 0 ? (bbRange / bbj.middle) * 100 : 5;

    // ATR %
    const atrPct = !isNaN(atr14[j]) && closes[j] > 0 ? (atr14[j] / closes[j]) * 100 : 2;

    // Relative volume
    const volSlice20 = volumes.slice(Math.max(0, j - 20), j);
    const avgVol20 = volSlice20.length ? arrayMean(volSlice20) : volumes[j];
    const avgVol5  = arrayMean(volumes.slice(Math.max(0, j - 5), j));
    const relVol5  = avgVol20 > 0 ? avgVol5 / avgVol20 : 1;
    const relVol1  = avgVol20 > 0 ? volumes[j] / avgVol20 : 1;

    // Consecutive day streak ending at j
    let consecutive = 0;
    for (let k = j; k > Math.max(0, j - 10); k--) {
      if (closes[k] > closes[k - 1]) {
        if (consecutive < 0) break;
        consecutive++;
      } else if (closes[k] < closes[k - 1]) {
        if (consecutive > 0) break;
        consecutive--;
      } else {
        break;
      }
    }

    // SMA distances
    const priceVsSma20  = !isNaN(sma20[j])  && sma20[j] > 0  ? (closes[j] - sma20[j])  / sma20[j]  * 100 : 0;
    const priceVsSma50  = !isNaN(sma50[j])  && sma50[j] > 0  ? (closes[j] - sma50[j])  / sma50[j]  * 100 : 0;
    const priceVsSma200 = !isNaN(sma200[j]) && sma200[j] > 0 ? (closes[j] - sma200[j]) / sma200[j] * 100 : 0;

    // Prior wick and day change
    const range = highs[j] - lows[j];
    const prevWick = range > 0 ? (closes[j] - lows[j]) / range : 0.5;
    const prevDayChangePct = j >= 1 ? (closes[j] - closes[j - 1]) / closes[j - 1] * 100 : 0;

    const features: PreGapFeatures = {
      rsi: rsi14[j],
      rsiTrend,
      macdHistPct,
      bbPosition,
      bbWidthPct,
      atrPct,
      relVol5,
      relVol1,
      consecutiveDays: consecutive,
      priceVsSma20,
      priceVsSma50,
      priceVsSma200: isNaN(priceVsSma200) ? 0 : priceVsSma200,
      prevWick,
      prevDayChangePct,
    };

    // ── Accumulate into cohorts ──────────────────────────────────────────────
    for (const key of FACTOR_KEYS) {
      const val = features[key];
      if (!isFinite(val)) continue;
      if (isGap) {
        cohorts[key][dir === "up" ? "gapUp" : "gapDown"].push(val);
      } else {
        cohorts[key].baseline.push(val);
      }
    }

    // ── Setup backtest: conditions at j → did a gap follow within 3 days? ───
    // Thresholds from research (ATR +1.40σ, BB +1.14σ, RVOL +0.72σ effect sizes)
    setupBt.totalDays++;
    if (isGap) setupBt.totalGapDays++;
    if (atrPct >= 3.2 && bbWidthPct >= 15 && relVol1 >= 1.2) {
      setupBt.setupDays++;
      // Check if a gap ≥ threshold occurs in the next 1, 2, or 3 trading days
      let found = false;
      for (let ahead = 0; ahead <= 2 && !found; ahead++) {
        const nextI = i + ahead;
        if (nextI >= n) break;
        const prevClose = ahead === 0 ? closes[j] : closes[nextI - 1];
        const nextGapPct = ((opens[nextI] - prevClose) / prevClose) * 100;
        if (Math.abs(nextGapPct) >= threshold) {
          if (ahead === 0) setupBt.gapWithin1d++;
          if (ahead <= 1) setupBt.gapWithin2d++;
          setupBt.gapWithin3d++;
          setupBt.totalMagnitude += Math.abs(nextGapPct);
          setupBt.magnitudeCount++;
          found = true;
        }
      }
    }

    // ── Record gap event ─────────────────────────────────────────────────────
    if (isGap) {
      const ft1 = (closes[i] - opens[i]) / opens[i] * 100;
      const ft5 = i + 5 < n ? (closes[i + 5] - opens[i]) / opens[i] * 100 : null;
      allGaps.push({
        ticker,
        date: bars[i].time,
        gapPct: r2(gapPct),
        direction: dir,
        priorClose: closes[j],
        openPrice: opens[i],
        closePrice: closes[i],
        volumeX: r2(relVol1),
        features,
        ft1Pct: r2(ft1),
        ft5Pct: ft5 !== null ? r2(ft5) : null,
      });
    }
  }
}

// ─── Factor metadata ──────────────────────────────────────────────────────────

const FACTOR_META: Record<keyof PreGapFeatures, { label: string; description: string; unit: string }> = {
  rsi:              { label: "RSI (14)",               unit: "0-100", description: "Relative Strength Index — low (<35) = oversold, high (>65) = overbought" },
  rsiTrend:         { label: "RSI 5-Day Momentum",      unit: "pts",   description: "Change in RSI over prior 5 sessions — rising = momentum building" },
  macdHistPct:      { label: "MACD Histogram %",        unit: "%",     description: "MACD histogram as % of price — positive = bullish momentum" },
  bbPosition:       { label: "Bollinger %B",            unit: "0-1",   description: "Price position within Bollinger Bands (0=lower band, 1=upper band)" },
  bbWidthPct:       { label: "Bollinger Band Width",    unit: "%",     description: "Band width as % of price — tight (<3%) = coiling, breakout potential" },
  atrPct:           { label: "ATR % of Price",          unit: "%",     description: "Average True Range as % of price — measures recent volatility level" },
  relVol5:          { label: "5-Day Volume Ratio",      unit: "x",     description: "5-day avg volume vs 20-day avg — < 1 = compression, > 1 = expansion" },
  relVol1:          { label: "Prior Day Volume Ratio",  unit: "x",     description: "Day-before volume vs 20-day avg — spike may signal informed flow" },
  consecutiveDays:  { label: "Consecutive Day Streak",  unit: "days",  description: "Unbroken up (+) or down (-) streak entering the gap day" },
  priceVsSma20:     { label: "Price vs SMA20 %",        unit: "%",     description: "Distance from 20-day moving average — short-term trend extension" },
  priceVsSma50:     { label: "Price vs SMA50 %",        unit: "%",     description: "Distance from 50-day moving average — intermediate trend extension" },
  priceVsSma200:    { label: "Price vs SMA200 %",       unit: "%",     description: "Distance from 200-day average — structural trend context" },
  prevWick:         { label: "Prior Day Wick Ratio",    unit: "0-1",   description: "(Close−Low)/(High−Low) the day before — 1.0 = buyers closed at high" },
  prevDayChangePct: { label: "Prior Day Change %",      unit: "%",     description: "Price % change on the session immediately before the gap" },
};

// ─── Aggregation & ranking ────────────────────────────────────────────────────

function buildFactorStat(key: keyof PreGapFeatures, cohorts: Cohorts): FactorStat {
  const c = cohorts[key];
  const bMean = arrayMean(c.baseline);
  const bStd  = arrayStd(c.baseline, bMean);
  const upMean   = arrayMean(c.gapUp);
  const downMean = arrayMean(c.gapDown);
  const meta = FACTOR_META[key];
  return {
    factor: key,
    label: meta.label,
    description: meta.description,
    unit: meta.unit,
    baselineMean:  r2(bMean),
    baselineStd:   r2(bStd),
    gapUpMean:     r2(upMean),
    gapDownMean:   r2(downMean),
    gapUpEffect:   r2((upMean - bMean) / bStd),
    gapDownEffect: r2((downMean - bMean) / bStd),
    gapUpN:   c.gapUp.length,
    gapDownN: c.gapDown.length,
    baselineN: c.baseline.length,
  };
}

function buildFollowThrough(events: GapEvent[], threshold: number): FollowThroughStats {
  const n = events.length;
  if (!n) return { n: 0, sameDayMean: 0, day5Mean: null, gapFillRate5d: 0 };
  const sameDayMean = r2(arrayMean(events.map(e => e.ft1Pct)));
  const withFt5 = events.filter(e => e.ft5Pct !== null);
  const day5Mean = withFt5.length ? r2(arrayMean(withFt5.map(e => e.ft5Pct!))) : null;
  const filled = events.filter(e => {
    if (e.ft5Pct === null) return false;
    if (e.direction === "up") {
      // Gap filled if close[T+5] < priorClose (completely reversed)
      const expectedRetrace = -(e.gapPct - threshold * 0.5);
      return e.ft5Pct <= expectedRetrace;
    } else {
      const expectedRetrace = -(e.gapPct + threshold * 0.5);
      return e.ft5Pct >= expectedRetrace;
    }
  });
  return {
    n,
    sameDayMean,
    day5Mean,
    gapFillRate5d: r2(filled.length / n * 100),
  };
}

// ─── Result cache (6-hour TTL) ────────────────────────────────────────────────

interface CachedResult {
  result: GapAnalysisResult;
  expiresAt: number;
}

const resultCache = new Map<string, CachedResult>();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

// ─── Main exported function ───────────────────────────────────────────────────

export async function runGapAnalysis(threshold = 5): Promise<GapAnalysisResult> {
  const cacheKey = `gap-${threshold}`;
  const cached = resultCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    logger.info({ threshold }, "Gap analysis: returning cached result");
    return cached.result;
  }

  logger.info({ threshold, tickers: SCANNER_UNIVERSE.length }, "Gap analysis: starting computation");
  const cohorts = makeCohorts();
  const allGaps: GapEvent[] = [];
  const tickers = SCANNER_UNIVERSE;
  const setupBt: SetupBacktestCounters = {
    setupDays: 0, gapWithin1d: 0, gapWithin2d: 0, gapWithin3d: 0,
    totalMagnitude: 0, magnitudeCount: 0, totalDays: 0, totalGapDays: 0,
  };

  // Process in batches of 8 — fetchOHLCV is mostly cache reads at this point
  for (let i = 0; i < tickers.length; i += 8) {
    const batch = tickers.slice(i, i + 8);
    await Promise.all(
      batch.map(t =>
        analyzeTickerGaps(t, threshold, cohorts, allGaps, setupBt).catch(err => {
          logger.warn({ ticker: t, err: err.message }, "Gap analysis: skipping ticker");
        })
      )
    );
  }

  // Build factor stats and rank by max |effect size|
  const factorRanking = FACTOR_KEYS
    .map(k => buildFactorStat(k, cohorts))
    .sort((a, b) =>
      Math.max(Math.abs(b.gapUpEffect), Math.abs(b.gapDownEffect)) -
      Math.max(Math.abs(a.gapUpEffect), Math.abs(a.gapDownEffect))
    );

  const gapUps   = allGaps.filter(e => e.direction === "up");
  const gapDowns = allGaps.filter(e => e.direction === "down");

  const recentGaps = [...allGaps]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 60);

  // Build setup backtest result
  const randomBaseline1d = setupBt.totalDays > 0
    ? r2(setupBt.totalGapDays / setupBt.totalDays * 100)
    : 0;
  const hitRate3d = setupBt.setupDays > 0
    ? r2(setupBt.gapWithin3d / setupBt.setupDays * 100) : 0;
  const setupBacktest: SetupBacktest = {
    setupDays:       setupBt.setupDays,
    gapWithin1d:     setupBt.gapWithin1d,
    gapWithin2d:     setupBt.gapWithin2d,
    gapWithin3d:     setupBt.gapWithin3d,
    hitRate1d:       setupBt.setupDays > 0 ? r2(setupBt.gapWithin1d / setupBt.setupDays * 100) : 0,
    hitRate2d:       setupBt.setupDays > 0 ? r2(setupBt.gapWithin2d / setupBt.setupDays * 100) : 0,
    hitRate3d,
    avgGapMagnitude: setupBt.magnitudeCount > 0 ? r2(setupBt.totalMagnitude / setupBt.magnitudeCount) : 0,
    randomBaseline1d,
    liftRatio3d:     randomBaseline1d > 0 ? r2(hitRate3d / randomBaseline1d) : 0,
  };

  const result: GapAnalysisResult = {
    metadata: {
      tickers: tickers.length,
      totalGaps: allGaps.length,
      gapUpCount: gapUps.length,
      gapDownCount: gapDowns.length,
      threshold,
      period: "1y",
      analyzedAt: new Date().toISOString(),
    },
    factorRanking,
    followThrough: {
      gapUp:   buildFollowThrough(gapUps,   threshold),
      gapDown: buildFollowThrough(gapDowns, threshold),
    },
    recentGaps,
    setupBacktest,
  };

  resultCache.set(cacheKey, { result, expiresAt: Date.now() + CACHE_TTL_MS });
  logger.info(
    { gaps: allGaps.length, up: gapUps.length, down: gapDowns.length },
    "Gap analysis: complete"
  );
  return result;
}

export function clearGapAnalysisCache(): void {
  resultCache.clear();
}

import { fetchOHLCV, fetchQuote } from "./marketData.js";
import {
  calcTrend, calcMomentum, calcVolume, calcVolatility, calcOptions,
  calcRelativeStrength, calcRegimeIndicators,
} from "./indicators.js";
import { calcAtlasScore } from "./scoring.js";
import { calibrationStore } from "./calibrationStore.js";
import { logger } from "./logger.js";

// ── Stat helpers ──────────────────────────────────────────────────────────────

function rank(arr: number[]): number[] {
  const sorted = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(arr.length);
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j < sorted.length - 1 && sorted[j + 1].v === sorted[j].v) j++;
    const r = (i + j + 2) / 2;
    for (let k = i; k <= j; k++) ranks[sorted[k].i] = r;
    i = j + 1;
  }
  return ranks;
}

function pearsonIC(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 5) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  const num = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
  const dx = Math.sqrt(xs.reduce((s, x) => s + (x - mx) ** 2, 0));
  const dy = Math.sqrt(ys.reduce((s, y) => s + (y - my) ** 2, 0));
  return dx * dy > 0 ? num / (dx * dy) : 0;
}

export function spearmanIC(xs: number[], ys: number[]): number {
  if (xs.length < 5) return 0;
  return pearsonIC(rank(xs), rank(ys));
}

function r3(n: number) { return Math.round(n * 1000) / 1000; }
function r2(n: number) { return Math.round(n * 100) / 100; }

function avg(arr: number[]): number | null {
  return arr.length ? r2(arr.reduce((s, v) => s + v, 0) / arr.length) : null;
}

function hitRate(pts: Array<{ fwdReturn: number }>, positive: boolean): number | null {
  if (!pts.length) return null;
  return Math.round(pts.filter(d => positive ? d.fwdReturn > 0 : d.fwdReturn < 0).length / pts.length * 100);
}

export function icLabel(absIC: number): string {
  return absIC >= 0.10 ? "strong" : absIC >= 0.05 ? "moderate" : absIC >= 0.02 ? "weak" : "noise";
}

// Gradient-descent logistic regression
// Fits P(fwdReturn>0 | score) = sigmoid(slope * score + intercept)
function fitLogistic(scores: number[], binary: number[]): { slope: number; intercept: number } {
  if (scores.length < 20) return { slope: 0.08, intercept: -4.0 };
  let slope = 0.0, intercept = 0.0;
  const lr = 0.0005;
  const n = scores.length;
  for (let iter = 0; iter < 3000; iter++) {
    let ds = 0, di = 0;
    for (let i = 0; i < n; i++) {
      const z = Math.max(-15, Math.min(15, slope * scores[i] + intercept));
      const pred = 1 / (1 + Math.exp(-z));
      const err = pred - binary[i];
      ds += err * scores[i];
      di += err;
    }
    slope -= lr * ds / n;
    intercept -= lr * di / n;
  }
  return { slope: r3(slope), intercept: r3(intercept) };
}

function sigmoid(slope: number, intercept: number, score: number): number {
  const z = Math.max(-15, Math.min(15, slope * score + intercept));
  return Math.round((1 / (1 + Math.exp(-z))) * 100);
}

function capBucket(marketCap: number | null): string {
  if (!marketCap) return "unknown";
  if (marketCap >= 200e9) return "mega";
  if (marketCap >= 10e9) return "large";
  if (marketCap >= 2e9)  return "mid";
  return "small";
}

const CAP_NOTES: Record<string, string> = {
  mega:    "Mega-cap: expect negative IC at short horizons (mean-reversion effect). Try 20–60D horizons.",
  large:   "Large-cap: momentum IC typically near zero. Signal works better on sector ETFs.",
  mid:     "Mid-cap: momentum signals more reliable — less mean-reversion pressure.",
  small:   "Small-cap: highest IC potential but wider confidence intervals due to thin liquidity.",
  unknown: "Market cap unknown — IC interpretation depends on ticker type.",
};

interface DataPoint {
  date: string; score: number; fwdReturn: number;
  trendScore: number; momentumScore: number; volumeScore: number;
  rsScore: number; regimeScore: number;
}

export interface BacktestOutput {
  ticker: string;
  horizon: number;
  marketCap: number | null;
  marketCapBucket: string;
  marketCapNote: string;
  ic: number;
  icRating: string;
  rankIC: number;
  rankICRating: string;
  icTStat: number;
  totalObservations: number;
  calibratedSlope: number;
  calibratedIntercept: number;
  categoryIC: { trend: number; momentum: number; volume: number; relativeStrength: number; regime: number };
  optimalWeights: { trend: number; momentum: number; volume: number; relativeStrength: number; regime: number } | null;
  currentWeights: { trend: number; momentum: number; volume: number; relativeStrength: number; regime: number };
  bull:    { count: number; hitRate: number | null; avgReturn: number | null };
  neutral: { count: number; hitRate: number | null; avgReturn: number | null };
  bear:    { count: number; hitRate: number | null; avgReturn: number | null };
  deciles: Array<{ bucket: string; count: number; hitRate: number | null; avgReturn: number | null }>;
  scatter: Array<{ x: number; y: number; date: string }>;
  cachedAt: string;
}

export async function runBacktest(ticker: string, horizon: number): Promise<BacktestOutput> {
  const sym = ticker.toUpperCase();

  const [bars, spyBars, qqqBars, iwmBars, quote] = await Promise.all([
    fetchOHLCV(sym, "2y", "1d"),
    fetchOHLCV("SPY", "2y", "1d"),
    fetchOHLCV("QQQ", "2y", "1d"),
    fetchOHLCV("IWM", "2y", "1d"),
    fetchQuote(sym).catch(() => null),
  ]);

  const MIN_BARS = 210;
  if (bars.length < MIN_BARS + horizon) {
    throw new Error(`Insufficient data: need ${MIN_BARS + horizon} bars, got ${bars.length}`);
  }

  const dataPoints: DataPoint[] = [];

  for (let i = MIN_BARS; i < bars.length - horizon; i++) {
    const slice    = bars.slice(0, i + 1);
    const spySlice = spyBars.slice(0, Math.min(i + 1, spyBars.length));
    const qqqSlice = qqqBars.slice(0, Math.min(i + 1, qqqBars.length));
    const iwmSlice = iwmBars.slice(0, Math.min(i + 1, iwmBars.length));

    const price  = slice[slice.length - 1].close;
    const avgVol = slice.slice(-20).reduce((s, b) => s + b.volume, 0) / 20;

    const trend      = calcTrend(slice, price);
    const momentum   = calcMomentum(slice);
    const volume     = calcVolume(slice, avgVol);
    const volatility = calcVolatility(slice, price);
    const options    = calcOptions(momentum, volume, volatility, price);
    const rs         = calcRelativeStrength(sym, slice, spySlice, qqqSlice, iwmSlice, null);
    const spyTrend   = calcTrend(spySlice, spySlice[spySlice.length - 1]?.close ?? 500);
    const regime     = calcRegimeIndicators(spySlice, spyTrend);
    const atlas      = calcAtlasScore(trend, momentum, volume, options, rs, regime.regimeScore, volatility.expectedMovePercent);

    const entry    = bars[i].close;
    const exit     = bars[i + horizon]?.close ?? entry;
    const fwdReturn = (exit / entry - 1) * 100;

    dataPoints.push({
      date: bars[i].time as string,
      score: atlas.overall,
      fwdReturn,
      trendScore:    atlas.trendScore,
      momentumScore: atlas.momentumScore,
      volumeScore:   atlas.volumeScore,
      rsScore:       atlas.relativeStrengthScore,
      regimeScore:   atlas.marketRegimeScore,
    });
  }

  const scores  = dataPoints.map(d => d.score);
  const returns = dataPoints.map(d => d.fwdReturn);
  const n = dataPoints.length;

  // IC metrics
  const ic      = r3(pearsonIC(scores, returns));
  const rankIC  = r3(spearmanIC(scores, returns));
  const icTStat = n > 2
    ? r3(rankIC * Math.sqrt(n - 2) / Math.sqrt(Math.max(1 - rankIC ** 2, 1e-9)))
    : 0;

  // Per-category IC
  const categoryIC = {
    trend:           r3(spearmanIC(dataPoints.map(d => d.trendScore),    returns)),
    momentum:        r3(spearmanIC(dataPoints.map(d => d.momentumScore), returns)),
    volume:          r3(spearmanIC(dataPoints.map(d => d.volumeScore),   returns)),
    relativeStrength:r3(spearmanIC(dataPoints.map(d => d.rsScore),       returns)),
    regime:          r3(spearmanIC(dataPoints.map(d => d.regimeScore),   returns)),
  };

  // IC²-weighted optimal weights
  const catVals = [categoryIC.trend, categoryIC.momentum, categoryIC.volume, categoryIC.relativeStrength, categoryIC.regime];
  const icSq    = catVals.map(v => v * v);
  const totalSq = icSq.reduce((a, b) => a + b, 0);
  const optimalWeights = totalSq > 0.001 ? {
    trend:           Math.round(icSq[0] / totalSq * 100),
    momentum:        Math.round(icSq[1] / totalSq * 100),
    volume:          Math.round(icSq[2] / totalSq * 100),
    relativeStrength:Math.round(icSq[3] / totalSq * 100),
    regime:          Math.round(icSq[4] / totalSq * 100),
  } : null;

  // Logistic calibration
  const binary = returns.map(r => r > 0 ? 1 : 0);
  const { slope: calibratedSlope, intercept: calibratedIntercept } = fitLogistic(scores, binary);

  // Write to calibration store (keeps the fitted function for real-time use)
  calibrationStore.set(sym, {
    ticker: sym,
    slope: calibratedSlope,
    intercept: calibratedIntercept,
    calibratedProbability: (score: number) => sigmoid(calibratedSlope, calibratedIntercept, score),
    observations: n,
    horizon,
    rankIC,
    icRating: icLabel(Math.abs(rankIC)),
    fittedAt: new Date().toISOString(),
  });

  logger.info({ ticker: sym, horizon, rankIC, observations: n, slope: calibratedSlope }, "Calibration fitted");

  // Buckets
  const bull    = dataPoints.filter(d => d.score >= 60);
  const neutral = dataPoints.filter(d => d.score > 40 && d.score < 60);
  const bear    = dataPoints.filter(d => d.score <= 40);

  // Decile table
  const deciles = Array.from({ length: 10 }, (_, d) => {
    const low = d * 10;
    const pts = dataPoints.filter(p => d === 9 ? p.score >= low : (p.score >= low && p.score < low + 10));
    return {
      bucket: `${low}–${low + 10}`,
      count: pts.length,
      hitRate: hitRate(pts, true),
      avgReturn: avg(pts.map(p => p.fwdReturn)),
    };
  });

  // Scatter (every 3rd point)
  const scatter = dataPoints
    .filter((_, i) => i % 3 === 0)
    .map(d => ({ x: d.score, y: r2(d.fwdReturn), date: d.date }));

  const marketCap       = quote?.marketCap ?? null;
  const marketCapBucket = capBucket(marketCap);

  return {
    ticker: sym,
    horizon,
    marketCap,
    marketCapBucket,
    marketCapNote: CAP_NOTES[marketCapBucket],
    ic,
    icRating:     icLabel(Math.abs(ic)),
    rankIC,
    rankICRating: icLabel(Math.abs(rankIC)),
    icTStat,
    totalObservations: n,
    calibratedSlope,
    calibratedIntercept,
    categoryIC,
    optimalWeights,
    currentWeights: { trend: 30, momentum: 20, volume: 15, relativeStrength: 15, regime: 10 },
    bull:    { count: bull.length,    hitRate: hitRate(bull,    true),  avgReturn: avg(bull.map(d => d.fwdReturn)) },
    neutral: { count: neutral.length, hitRate: hitRate(neutral, true),  avgReturn: avg(neutral.map(d => d.fwdReturn)) },
    bear:    { count: bear.length,    hitRate: hitRate(bear,    false), avgReturn: avg(bear.map(d => d.fwdReturn)) },
    deciles,
    scatter,
    cachedAt: new Date().toISOString(),
  };
}

/** Lightweight background calibration — runs a 10D backtest for a ticker and
 *  writes the fitted logistic params to calibrationStore. Call fire-and-forget. */
export async function runCalibrationBackground(ticker: string): Promise<void> {
  const sym = ticker.toUpperCase();
  try {
    await runBacktest(sym, 10);
  } catch (err) {
    logger.warn({ ticker: sym, err }, "Background calibration failed");
    calibrationStore.markError(sym);
  }
}

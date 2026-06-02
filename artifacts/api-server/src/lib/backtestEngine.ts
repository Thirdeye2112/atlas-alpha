import { fetchOHLCV, fetchQuote } from "./marketData.js";
import {
  calcTrend, calcMomentum, calcVolume, calcVolatility, calcOptions,
  calcRelativeStrength, calcRegimeIndicators, calcExhaustion,
} from "./indicators.js";
import { calcAtlasScore } from "./scoring.js";
import { calibrationStore } from "./calibrationStore.js";
import { logger } from "./logger.js";
import { isStructurallyDistorted, getAssetType } from "./scannerUniverse.js";

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

/**
 * Winsorize array at given tail percentile (default p5/p95).
 * Used only for IC computation — raw returns are kept for display.
 */
function winsorize(arr: number[], tailPct: number = 0.05): number[] {
  if (arr.length < 4) return arr;
  const sorted = [...arr].sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * tailPct)] ?? sorted[0]!;
  const hi = sorted[Math.floor(sorted.length * (1 - tailPct))] ?? sorted[sorted.length - 1]!;
  return arr.map(v => Math.max(lo, Math.min(hi, v)));
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

/** Bootstrap 90% CI for Brier score via 200 resamples with replacement. */
function brierCI(
  scores: number[],
  binary: number[],
  slope: number,
  intercept: number,
  nResamples = 200,
): { low: number; high: number } | null {
  const n = scores.length;
  if (n < 20) return null;
  const samples: number[] = [];
  for (let s = 0; s < nResamples; s++) {
    let bs = 0;
    for (let i = 0; i < n; i++) {
      const idx = Math.floor(Math.random() * n);
      const p = sigmoid(slope, intercept, scores[idx]) / 100;
      bs += (p - binary[idx]) ** 2;
    }
    samples.push(bs / n);
  }
  samples.sort((a, b) => a - b);
  return {
    low:  r3(samples[Math.floor(nResamples * 0.05)]),
    high: r3(samples[Math.floor(nResamples * 0.95)]),
  };
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

type RegimeBucket = "risk_on" | "neutral" | "risk_off";

interface DataPoint {
  date: string; score: number; fwdReturn: number;
  trendScore: number; momentumScore: number; volumeScore: number;
  rsScore: number; regimeScore: number;
  regimeBucket: RegimeBucket;
}

/**
 * Tiered round-trip execution cost by market-cap bucket.
 * Mega/large: tighter spreads; small/unknown: wider spreads.
 */
function slippageBpsForCap(bucket: string): number {
  switch (bucket) {
    case "mega":    return 3;
    case "large":   return 5;
    case "mid":     return 8;
    case "small":   return 15;
    default:        return 5;   // ETFs / unknown
  }
}

/**
 * Non-overlapping subsampler.
 * Returns every `step`-th element — ensures forward-return windows don't
 * overlap, eliminating the autocorrelation that inflates t-statistics.
 */
function nonOverlapping<T>(arr: T[], step: number): T[] {
  if (step <= 1) return arr;
  return arr.filter((_, i) => i % step === 0);
}

// Winsorization percentile used for IC computation (p5/p95)
const WINSOR_PCT = 0.05;

export interface RollingICPoint {
  date: string;
  ic: number;
  n: number;
}

export interface BacktestOutput {
  ticker: string;
  horizon: number;
  marketCap: number | null;
  marketCapBucket: string;
  marketCapNote: string;
  isDistorted: boolean;
  assetType: string;
  ic: number;
  icRating: string;
  rankIC: number;
  rankICRating: string;
  icTStat: number;
  totalObservations: number;
  calibratedSlope: number;
  calibratedIntercept: number;
  slippageBps: number;
  brierScore: number | null;
  brierScoreCI: { low: number; high: number } | null;
  brierIsOos: boolean;
  winsorThresholdPct: number;
  inSampleIC: number;
  outOfSampleIC: number;
  icDegradation: number;
  rollingIC: RollingICPoint[];
  oosPeriods: Array<{ label: string; start: string; end: string; ic: number; n: number }>;
  regimeIC: {
    riskOn:   number | null; riskOnN:  number;
    neutral:  number | null; neutralN: number;
    riskOff:  number | null; riskOffN: number;
  };
  categoryIC: { trend: number; momentum: number; volume: number; relativeStrength: number; regime: number };
  optimalWeights: { trend: number; momentum: number; volume: number; relativeStrength: number; regime: number } | null;
  currentWeights: { trend: number; momentum: number; volume: number; relativeStrength: number; regime: number };
  bull:    { count: number; hitRate: number | null; hitRateNet: number | null; avgReturn: number | null };
  neutral: { count: number; hitRate: number | null; hitRateNet: number | null; avgReturn: number | null };
  bear:    { count: number; hitRate: number | null; hitRateNet: number | null; avgReturn: number | null };
  deciles: Array<{ bucket: string; count: number; hitRate: number | null; avgReturn: number | null }>;
  scatter: Array<{ x: number; y: number; date: string }>;
  timeline: Array<{ date: string; score: number; fwdReturn: number; direction: "bull" | "neutral" | "bear"; correct: boolean }>;
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

  // Resolve market-cap bucket early so slippage can be tier-aware
  const marketCap       = quote?.marketCap ?? null;
  const marketCapBucket = capBucket(marketCap);
  const slippageBps     = slippageBpsForCap(marketCapBucket);
  const slippagePct     = slippageBps / 100;

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
    const exhaustion = calcExhaustion(slice, momentum, volume, trend, volatility);
    const atlas      = calcAtlasScore(trend, momentum, volume, options, rs, regime.regimeScore, volatility.expectedMovePercent, exhaustion);

    const entry     = bars[i].close;
    const exit      = bars[i + horizon]?.close ?? entry;
    const fwdReturn = (exit / entry - 1) * 100;

    const regimeBucket: RegimeBucket =
      regime.regimeScore >= 60 ? "risk_on" : regime.regimeScore >= 40 ? "neutral" : "risk_off";

    dataPoints.push({
      date: bars[i].time as string,
      score: atlas.overall,
      fwdReturn,
      trendScore:    atlas.trendScore,
      momentumScore: atlas.momentumScore,
      volumeScore:   atlas.volumeScore,
      rsScore:       atlas.relativeStrengthScore,
      regimeScore:   atlas.marketRegimeScore,
      regimeBucket,
    });
  }

  const scores  = dataPoints.map(d => d.score);
  const returns = dataPoints.map(d => d.fwdReturn);
  const n = dataPoints.length;

  // ── Winsorize returns for IC computation only (p5/p95) ────────────────────
  // Raw returns are kept in dataPoints for display (scatter, timeline, deciles).
  const winsorizedReturns = winsorize(returns, WINSOR_PCT);

  // ── IS / OOS split ────────────────────────────────────────────────────────
  // Strict temporal split: first half = in-sample, second half = out-of-sample.
  const splitIdx  = Math.floor(n / 2);
  const isPoints  = dataPoints.slice(0, splitIdx);
  const oosPoints = dataPoints.slice(splitIdx);

  const isWin  = winsorize(isPoints.map(d => d.fwdReturn),  WINSOR_PCT);
  const oosWin = winsorize(oosPoints.map(d => d.fwdReturn), WINSOR_PCT);

  const inSampleIC    = isPoints.length  >= 10 ? r3(spearmanIC(isPoints.map(d => d.score),  isWin))  : 0;
  const outOfSampleIC = oosPoints.length >= 10 ? r3(spearmanIC(oosPoints.map(d => d.score), oosWin)) : 0;
  const icDegradation = r3(inSampleIC - outOfSampleIC);
  const oosPeriods = [
    { label: "In-sample",     start: isPoints[0]?.date  ?? "", end: isPoints[isPoints.length - 1]?.date   ?? "", ic: inSampleIC,    n: isPoints.length  },
    { label: "Out-of-sample", start: oosPoints[0]?.date ?? "", end: oosPoints[oosPoints.length - 1]?.date ?? "", ic: outOfSampleIC, n: oosPoints.length },
  ];

  // ── Rolling IC (63-bar / ~3-month windows, 21-bar / ~1-month step) ───────
  // Produces a time series of IC quality — shows whether signal edge is
  // improving, stable, or decaying over the backtest period.
  const ROLL_WIN  = 63;  // ~3 months of trading days
  const ROLL_STEP = 21;  // ~1 month step (monthly resolution)
  const rollingIC: RollingICPoint[] = [];
  for (let start = 0; start + ROLL_WIN <= dataPoints.length; start += ROLL_STEP) {
    const w        = dataPoints.slice(start, start + ROLL_WIN);
    const wScores  = w.map(d => d.score);
    const wReturns = winsorize(w.map(d => d.fwdReturn), WINSOR_PCT);
    rollingIC.push({
      date: w[w.length - 1]?.date ?? "",
      ic:   w.length >= 10 ? r3(spearmanIC(wScores, wReturns)) : 0,
      n:    w.length,
    });
  }

  // ── IC metrics (winsorized) ───────────────────────────────────────────────
  const ic     = r3(pearsonIC(scores, winsorizedReturns));
  const rankIC = r3(spearmanIC(scores, winsorizedReturns));

  // t-stat uses non-overlapping subsamples to avoid autocorrelation from
  // overlapping H-day forward-return windows inflating significance.
  const niPoints  = nonOverlapping(dataPoints, Math.max(1, horizon));
  const niScores  = niPoints.map(d => d.score);
  const niReturns = winsorize(niPoints.map(d => d.fwdReturn), WINSOR_PCT);
  const niIC      = r3(spearmanIC(niScores, niReturns));
  const niN       = niPoints.length;
  const icTStat   = niN > 2
    ? r3(niIC * Math.sqrt(niN - 2) / Math.sqrt(Math.max(1 - niIC ** 2, 1e-9)))
    : 0;

  // ── Regime-conditioned IC ─────────────────────────────────────────────────
  const riskOnPts  = dataPoints.filter(d => d.regimeBucket === "risk_on");
  const neutralPts = dataPoints.filter(d => d.regimeBucket === "neutral");
  const riskOffPts = dataPoints.filter(d => d.regimeBucket === "risk_off");

  const regimeIC = {
    riskOn:   riskOnPts.length  >= 10 ? r3(spearmanIC(riskOnPts.map(d => d.score),  winsorize(riskOnPts.map(d => d.fwdReturn),  WINSOR_PCT))) : null,
    riskOnN:  riskOnPts.length,
    neutral:  neutralPts.length >= 10 ? r3(spearmanIC(neutralPts.map(d => d.score), winsorize(neutralPts.map(d => d.fwdReturn), WINSOR_PCT))) : null,
    neutralN: neutralPts.length,
    riskOff:  riskOffPts.length >= 10 ? r3(spearmanIC(riskOffPts.map(d => d.score), winsorize(riskOffPts.map(d => d.fwdReturn), WINSOR_PCT))) : null,
    riskOffN: riskOffPts.length,
  };

  // ── Per-category IC (winsorized) ──────────────────────────────────────────
  const categoryIC = {
    trend:           r3(spearmanIC(dataPoints.map(d => d.trendScore),    winsorizedReturns)),
    momentum:        r3(spearmanIC(dataPoints.map(d => d.momentumScore), winsorizedReturns)),
    volume:          r3(spearmanIC(dataPoints.map(d => d.volumeScore),   winsorizedReturns)),
    relativeStrength:r3(spearmanIC(dataPoints.map(d => d.rsScore),       winsorizedReturns)),
    regime:          r3(spearmanIC(dataPoints.map(d => d.regimeScore),   winsorizedReturns)),
  };

  // ── IC²-weighted optimal weights ──────────────────────────────────────────
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

  // ── Calibration: fit on IS half only (eliminates data leakage) ───────────
  const isScores = isPoints.map(d => d.score);
  const isBinary = isPoints.map(d => d.fwdReturn > 0 ? 1 : 0);
  const { slope: calibratedSlope, intercept: calibratedIntercept } = fitLogistic(isScores, isBinary);

  // ── Brier score: evaluated on OOS half only (true out-of-sample quality) ──
  const oosScores = oosPoints.map(d => d.score);
  const oosBinary = oosPoints.map(d => d.fwdReturn > 0 ? 1 : 0);
  const brierScore = oosBinary.length > 0
    ? r3(oosBinary.reduce((s, y, i) => {
        const p = sigmoid(calibratedSlope, calibratedIntercept, oosScores[i]) / 100;
        return s + (p - y) ** 2;
      }, 0) / oosBinary.length)
    : null;

  const brierScoreCI = brierScore !== null
    ? brierCI(oosScores, oosBinary, calibratedSlope, calibratedIntercept)
    : null;

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
    fitSource: "live",
    optimalWeights: optimalWeights ?? null,
  }, { brierScore: brierScore ?? undefined });

  logger.info({ ticker: sym, horizon, rankIC, observations: n, slope: calibratedSlope, brierScore, brierIsOos: true }, "Calibration fitted (IS-only, OOS Brier)");

  // ── Universe flags ────────────────────────────────────────────────────────
  const distorted = isStructurallyDistorted(sym);
  const assetType = getAssetType(sym) ?? "equity";

  // ── Buckets ───────────────────────────────────────────────────────────────
  const bull    = dataPoints.filter(d => d.score >= 60);
  const neutral = dataPoints.filter(d => d.score > 40 && d.score < 60);
  const bear    = dataPoints.filter(d => d.score <= 40);

  function hitRateNet(pts: Array<{ fwdReturn: number }>, direction: "long" | "short"): number | null {
    if (!pts.length) return null;
    const threshold = direction === "long" ? slippagePct : -slippagePct;
    const hits = direction === "long"
      ? pts.filter(d => d.fwdReturn > threshold).length
      : pts.filter(d => d.fwdReturn < threshold).length;
    return Math.round(hits / pts.length * 100);
  }

  // ── Decile table ──────────────────────────────────────────────────────────
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

  // ── Scatter (every 3rd point, raw returns for display) ───────────────────
  const scatter = dataPoints
    .filter((_, i) => i % 3 === 0)
    .map(d => ({ x: d.score, y: r2(d.fwdReturn), date: d.date }));

  // ── Timeline (every observation, raw returns) ─────────────────────────────
  const timeline = dataPoints.map(d => {
    const dir: "bull" | "neutral" | "bear" = d.score >= 60 ? "bull" : d.score <= 40 ? "bear" : "neutral";
    const correct =
      dir === "bull"    ? d.fwdReturn > 0 :
      dir === "bear"    ? d.fwdReturn < 0 :
      Math.abs(d.fwdReturn) < 2;
    return { date: d.date, score: d.score, fwdReturn: r2(d.fwdReturn), direction: dir, correct };
  });

  return {
    ticker: sym,
    horizon,
    marketCap,
    marketCapBucket,
    marketCapNote: CAP_NOTES[marketCapBucket],
    isDistorted: distorted,
    assetType,
    ic,
    icRating:     icLabel(Math.abs(ic)),
    rankIC,
    rankICRating: icLabel(Math.abs(rankIC)),
    icTStat,
    totalObservations: n,
    calibratedSlope,
    calibratedIntercept,
    slippageBps,
    brierScore,
    brierScoreCI,
    brierIsOos: true,
    winsorThresholdPct: WINSOR_PCT,
    inSampleIC,
    outOfSampleIC,
    icDegradation,
    rollingIC,
    oosPeriods,
    regimeIC,
    categoryIC,
    optimalWeights,
    currentWeights: { trend: 24, momentum: 18, volume: 13, relativeStrength: 20, regime: 4 },
    bull:    { count: bull.length,    hitRate: hitRate(bull,    true),  hitRateNet: hitRateNet(bull,    "long"),  avgReturn: avg(bull.map(d => d.fwdReturn)) },
    neutral: { count: neutral.length, hitRate: hitRate(neutral, true),  hitRateNet: hitRateNet(neutral, "long"),  avgReturn: avg(neutral.map(d => d.fwdReturn)) },
    bear:    { count: bear.length,    hitRate: hitRate(bear,    false), hitRateNet: hitRateNet(bear,    "short"), avgReturn: avg(bear.map(d => d.fwdReturn)) },
    deciles,
    scatter,
    timeline,
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
    calibrationStore.markError(sym, 10);
  }
}

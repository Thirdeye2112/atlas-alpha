import { fetchOHLCV, type OHLCVBar } from "./marketData.js";
import { ohlcvCache } from "./cache.js";
import { logger } from "./logger.js";

// ─── Per-interval config ──────────────────────────────────────────────────────
// Thresholds scale with bar size: a "significant" first-bar move on a daily chart
// (~0.8%) means something very different from one on a 1-min chart (~0.06%).

interface IntervalConfig {
  minutes:         number;  // bar width in minutes
  minFirstBarPct:  number;  // min |first-bar return| % to start tracking a run
  minRunMovePct:   number;  // min peak-to-start move % to record a run
  maxRunBars:      number;  // cap on run length (prevents runs spanning days on intraday)
}

const INTERVAL_CONFIG: Record<string, IntervalConfig> = {
  "1m":  { minutes: 1,    minFirstBarPct: 0.06, minRunMovePct: 0.10, maxRunBars: 60  },
  "5m":  { minutes: 5,    minFirstBarPct: 0.12, minRunMovePct: 0.20, maxRunBars: 78  },
  "15m": { minutes: 15,   minFirstBarPct: 0.20, minRunMovePct: 0.35, maxRunBars: 26  },
  "30m": { minutes: 30,   minFirstBarPct: 0.28, minRunMovePct: 0.45, maxRunBars: 13  },
  "1h":  { minutes: 60,   minFirstBarPct: 0.40, minRunMovePct: 0.60, maxRunBars: 13  },
  "1d":  { minutes: 1440, minFirstBarPct: 0.80, minRunMovePct: 1.00, maxRunBars: 20  },
};

const RETRACE_THRESHOLD = 0.50;  // fraction of peak move that defines "run over" (all intervals)

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Run {
  startTime:    string;
  direction:    "up" | "down";
  startPrice:   number;
  peakPrice:    number;
  totalMovePct: number;           // |peak − start| / start * 100
  totalBars:    number;           // bars from start to peak
  durationMin:  number;           // totalBars × intervalMinutes
  vel3BarAvg:   number;           // avg |return| per bar over first 3 bars
  firstBarPct:  number;           // |return| of first bar (%)
  retrace50Bars: number | null;   // bars from peak to 50% retrace
  retrace50Min:  number | null;   // minutes from peak to 50% retrace
  rvolAtStart:   number;          // relative volume at run start vs session avg
}

export interface RunCorrelations {
  velocityVsRetrace50:  number | null;  // r: init velocity vs time-to-50%-retrace
  distanceVsRetrace50:  number | null;  // r: total distance vs time-to-50%-retrace
  durationVsRetrace50:  number | null;  // r: run duration vs time-to-50%-retrace
  n: number;                            // runs with retrace data (denominator)
}

export interface RunStats {
  totalRuns:          number;
  upCount:            number;
  downCount:          number;
  avgMovePct:         number;
  avgDurationMin:     number;
  medianRetrace50Min: number | null;
  pctWithRetrace:     number;
}

export interface PatternInsight {
  behavior:   "momentum" | "mean-reversion" | "noisy";
  confidence: "high" | "moderate" | "low";
  summary:    string;
  keyFinding: string;
}

export interface RunDynamicsResult {
  ticker:     string;
  interval:   string;
  period:     string;
  totalBars:  number;
  runs:       Run[];
  correlations: {
    up:   RunCorrelations;
    down: RunCorrelations;
    all:  RunCorrelations;
  };
  stats:      RunStats;
  insight:    PatternInsight;
  analyzedAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pearsonR(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 4) return null;
  const mx = xs.reduce((a, b) => a + b) / n;
  const my = ys.reduce((a, b) => a + b) / n;
  const num = xs.map((x, i) => (x - mx) * (ys[i] - my)).reduce((a, b) => a + b);
  const dx  = Math.sqrt(xs.map(x => (x - mx) ** 2).reduce((a, b) => a + b));
  const dy  = Math.sqrt(ys.map(y => (y - my) ** 2).reduce((a, b) => a + b));
  if (dx * dy === 0) return null;
  return Math.max(-1, Math.min(1, num / (dx * dy)));
}

function median(arr: number[]): number | null {
  if (arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}

function buildCorrelations(runs: Run[]): RunCorrelations {
  const withRetrace = runs.filter(r => r.retrace50Bars !== null);
  const n  = withRetrace.length;
  const vs = withRetrace.map(r => r.vel3BarAvg);
  const ds = withRetrace.map(r => r.totalMovePct);
  const bs = withRetrace.map(r => r.totalBars);
  const rt = withRetrace.map(r => r.retrace50Bars as number);
  return {
    velocityVsRetrace50: pearsonR(vs, rt),
    distanceVsRetrace50: pearsonR(ds, rt),
    durationVsRetrace50: pearsonR(bs, rt),
    n,
  };
}

function deriveInsight(
  up:   RunCorrelations,
  down: RunCorrelations,
  all:  RunCorrelations,
  stats: RunStats,
): PatternInsight {
  const dist  = all.distanceVsRetrace50 ?? 0;
  const vel   = all.velocityVsRetrace50 ?? 0;
  const hasData = all.n >= 6;

  if (!hasData) {
    return {
      behavior:   "noisy",
      confidence: "low",
      summary:    "Insufficient retrace observations for reliable conclusions.",
      keyFinding: `Only ${all.n} runs had a confirmed 50% retrace in this window. Extend to a longer lookback for more signal.`,
    };
  }

  // Momentum: large runs take longer to retrace (positive dist correlation)
  if (dist >= 0.40) {
    const conf: PatternInsight["confidence"] = dist >= 0.70 ? "high" : "moderate";
    return {
      behavior:   "momentum",
      confidence: conf,
      summary:    "Momentum regime — larger runs sustain longer before retracing.",
      keyFinding: `Distance↔retrace correlation r=${dist.toFixed(2)}: a bigger move buys more time before the 50% pullback. Trade with the move; let winners run.`,
    };
  }

  // Mean-reversion: fast velocity means quick retrace (negative vel correlation)
  if (vel <= -0.30) {
    const conf: PatternInsight["confidence"] = vel <= -0.55 ? "high" : "moderate";
    return {
      behavior:   "mean-reversion",
      confidence: conf,
      summary:    "Mean-reversion regime — fast spikes get faded quickly.",
      keyFinding: `Velocity↔retrace correlation r=${vel.toFixed(2)}: the harder the initial push, the faster it snaps back. Fade aggressive opening moves; scale in against the spike.`,
    };
  }

  return {
    behavior:   "noisy",
    confidence: "low",
    summary:    "No dominant regime — runs retrace unpredictably at this timeframe.",
    keyFinding: `Distance r=${dist.toFixed(2)}, velocity r=${vel.toFixed(2)}. Neither factor explains retrace timing reliably. Wider stop-losses and faster targets are safer here.`,
  };
}

// ─── Run detection ────────────────────────────────────────────────────────────

function detectRuns(bars: OHLCVBar[], cfg: IntervalConfig): Run[] {
  if (bars.length < 10) return [];

  const { minutes: intervalMin, minFirstBarPct, minRunMovePct, maxRunBars } = cfg;

  const closes  = bars.map(b => b.close as number);
  const volumes = bars.map(b => b.volume as number);
  const avgVol  = volumes.reduce((a, b) => a + b, 0) / volumes.length;

  const returns: number[] = [0];
  for (let i = 1; i < bars.length; i++) {
    returns.push(((closes[i] - closes[i - 1]) / closes[i - 1]) * 100);
  }

  const runs: Run[] = [];
  let i = 0;

  while (i < bars.length - 5) {
    const r0 = returns[i + 1] ?? 0;
    if (Math.abs(r0) < minFirstBarPct) { i++; continue; }

    const direction = r0 > 0 ? 1 : -1;
    const startPrice = closes[i];
    let peakPrice = startPrice;
    let peakIdx = i;

    let j = i + 1;
    while (j < bars.length && j - i <= maxRunBars) {
      const price     = closes[j];
      const movePct   = ((price - startPrice) / startPrice) * 100 * direction;
      const peakMove  = ((peakPrice - startPrice) / startPrice) * 100 * direction;

      if (movePct > peakMove) { peakPrice = price; peakIdx = j; }

      const absPeak = Math.abs((peakPrice - startPrice) / startPrice * 100);
      const retracedPct = absPeak > 0 ? (absPeak - movePct * direction) / absPeak : 0;

      if (retracedPct >= RETRACE_THRESHOLD && absPeak >= minRunMovePct) {
        break;
      }
      j++;
    }

    // Recalculate cleanly
    const totalMovePct = Math.abs(((peakPrice - startPrice) / startPrice) * 100);
    const totalBars    = peakIdx - i;

    if (totalMovePct < minRunMovePct || totalBars < 2) { i++; continue; }

    // Velocity: avg |return| over first 3 bars
    const vel3 = [1, 2, 3]
      .map(k => Math.abs(returns[i + k] ?? 0))
      .reduce((a, b) => a + b, 0) / 3;

    // Time to 50% retrace from peak (search up to 2× maxRunBars ahead)
    const retrace50Target = totalMovePct * RETRACE_THRESHOLD;
    let retrace50Bars: number | null = null;
    for (let k = peakIdx + 1; k < Math.min(peakIdx + maxRunBars * 2, bars.length); k++) {
      const pullback = Math.abs(((closes[k] - peakPrice) / peakPrice) * 100);
      if (pullback >= retrace50Target) {
        retrace50Bars = k - peakIdx;
        break;
      }
    }

    // Relative volume at run start (5-bar window vs session avg)
    const windowVol = volumes.slice(i, Math.min(i + 5, volumes.length)).reduce((a, b) => a + b, 0);
    const windowAvg = avgVol * Math.min(5, volumes.length - i);
    const rvol = windowAvg > 0 ? windowVol / windowAvg : 1;

    runs.push({
      startTime:    String(bars[i].time),
      direction:    direction > 0 ? "up" : "down",
      startPrice:   +startPrice.toFixed(4),
      peakPrice:    +peakPrice.toFixed(4),
      totalMovePct: +totalMovePct.toFixed(4),
      totalBars,
      durationMin:  totalBars * intervalMin,
      vel3BarAvg:   +vel3.toFixed(5),
      firstBarPct:  +Math.abs(r0).toFixed(5),
      retrace50Bars,
      retrace50Min:  retrace50Bars !== null ? retrace50Bars * intervalMin : null,
      rvolAtStart:   +rvol.toFixed(2),
    });

    i = Math.max(peakIdx, i + 3);
  }

  return runs;
}

// ─── Main export ──────────────────────────────────────────────────────────────

const CACHE_KEY_PREFIX = "run-dynamics:";
const CACHE_TTL = 900; // 15 min — matches OHLCV cache

export async function runDynamicsAnalysis(
  ticker: string,
  period = "5d",
  interval = "5m",
): Promise<RunDynamicsResult> {
  const cacheKey = `${CACHE_KEY_PREFIX}${ticker}:${period}:${interval}`;
  const cached = ohlcvCache.get<RunDynamicsResult>(cacheKey);
  if (cached) {
    logger.debug({ ticker }, "run-dynamics cache hit");
    return cached;
  }

  logger.info({ ticker, period, interval }, "run-dynamics: fetching intraday data");
  const bars = await fetchOHLCV(ticker, period, interval);

  if (bars.length < 10) {
    throw new Error(`Insufficient intraday data for ${ticker} (${bars.length} bars)`);
  }

  const cfg  = INTERVAL_CONFIG[interval] ?? INTERVAL_CONFIG["5m"];
  const runs = detectRuns(bars, cfg);
  const upRuns   = runs.filter(r => r.direction === "up");
  const downRuns = runs.filter(r => r.direction === "down");

  const corrUp   = buildCorrelations(upRuns);
  const corrDown = buildCorrelations(downRuns);
  const corrAll  = buildCorrelations(runs);

  const retraceMinutes = runs
    .filter(r => r.retrace50Min !== null)
    .map(r => r.retrace50Min as number);

  const stats: RunStats = {
    totalRuns:          runs.length,
    upCount:            upRuns.length,
    downCount:          downRuns.length,
    avgMovePct:         runs.length
      ? +(runs.reduce((a, r) => a + r.totalMovePct, 0) / runs.length).toFixed(3)
      : 0,
    avgDurationMin:     runs.length
      ? +(runs.reduce((a, r) => a + r.durationMin, 0) / runs.length).toFixed(1)
      : 0,
    medianRetrace50Min: median(retraceMinutes),
    pctWithRetrace:     runs.length
      ? +((retraceMinutes.length / runs.length) * 100).toFixed(1)
      : 0,
  };

  const insight = deriveInsight(corrUp, corrDown, corrAll, stats);

  const result: RunDynamicsResult = {
    ticker,
    interval,
    period,
    totalBars: bars.length,
    runs,
    correlations: { up: corrUp, down: corrDown, all: corrAll },
    stats,
    insight,
    analyzedAt: new Date().toISOString(),
  };

  ohlcvCache.set(cacheKey, result, CACHE_TTL);
  logger.info({ ticker, runs: runs.length }, "run-dynamics: analysis complete");
  return result;
}

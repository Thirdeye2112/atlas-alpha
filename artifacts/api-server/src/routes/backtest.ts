import { Router, type IRouter } from "express";
import { fetchOHLCV } from "../lib/marketData.js";
import {
  calcTrend,
  calcMomentum,
  calcVolume,
  calcVolatility,
  calcOptions,
  calcRelativeStrength,
  calcRegimeIndicators,
} from "../lib/indicators.js";
import { calcAtlasScore } from "../lib/scoring.js";
import NodeCache from "node-cache";

const backtestCache = new NodeCache({ stdTTL: 3600 });

const router: IRouter = Router();

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

function spearmanIC(xs: number[], ys: number[]): number {
  if (xs.length < 5) return 0;
  return pearsonIC(rank(xs), rank(ys));
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function avg(arr: number[]): number | null {
  return arr.length ? Math.round((arr.reduce((s, v) => s + v, 0) / arr.length) * 100) / 100 : null;
}

function hitRate(pts: Array<{ fwdReturn: number }>, positive: boolean): number | null {
  if (!pts.length) return null;
  return Math.round(pts.filter(d => positive ? d.fwdReturn > 0 : d.fwdReturn < 0).length / pts.length * 100);
}

function icRating(absIC: number): string {
  return absIC >= 0.10 ? "strong" : absIC >= 0.05 ? "moderate" : absIC >= 0.02 ? "weak" : "noise";
}

router.get("/backtest/ic", async (req, res): Promise<void> => {
  const ticker = String(req.query.ticker ?? "SPY").toUpperCase();
  const horizon = Math.max(1, Math.min(60, Number(req.query.horizon ?? 10)));
  const cacheKey = `backtest:${ticker}:${horizon}`;

  const cached = backtestCache.get(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  const [bars, spyBars, qqqBars, iwmBars] = await Promise.all([
    fetchOHLCV(ticker, "2y", "1d"),
    fetchOHLCV("SPY", "2y", "1d"),
    fetchOHLCV("QQQ", "2y", "1d"),
    fetchOHLCV("IWM", "2y", "1d"),
  ]);

  const MIN_BARS = 210;
  if (bars.length < MIN_BARS + horizon) {
    res.status(400).json({ error: `Insufficient data: need ${MIN_BARS + horizon} bars, got ${bars.length}` });
    return;
  }

  const dataPoints: Array<{ date: string; score: number; fwdReturn: number }> = [];

  for (let i = MIN_BARS; i < bars.length - horizon; i++) {
    const slice = bars.slice(0, i + 1);
    const spySlice = spyBars.slice(0, Math.min(i + 1, spyBars.length));
    const qqqSlice = qqqBars.slice(0, Math.min(i + 1, qqqBars.length));
    const iwmSlice = iwmBars.slice(0, Math.min(i + 1, iwmBars.length));

    const price = slice[slice.length - 1].close;
    const avgVol = slice.slice(-20).reduce((s, b) => s + b.volume, 0) / 20;

    const trend = calcTrend(slice, price);
    const momentum = calcMomentum(slice);
    const volume = calcVolume(slice, avgVol);
    const volatility = calcVolatility(slice, price);
    const options = calcOptions(momentum, volume, volatility, price);
    const rs = calcRelativeStrength(ticker, slice, spySlice, qqqSlice, iwmSlice, null);
    const spyTrend = calcTrend(spySlice, spySlice[spySlice.length - 1]?.close ?? 500);
    const regime = calcRegimeIndicators(spySlice, spyTrend);
    const atlasScore = calcAtlasScore(trend, momentum, volume, options, rs, regime.regimeScore, volatility.expectedMovePercent);

    const entryPrice = bars[i].close;
    const exitPrice = bars[i + horizon]?.close ?? entryPrice;
    const fwdReturn = (exitPrice / entryPrice - 1) * 100;

    dataPoints.push({ date: bars[i].time as string, score: atlasScore.overall, fwdReturn });
  }

  const scores = dataPoints.map(d => d.score);
  const returns = dataPoints.map(d => d.fwdReturn);

  const ic = round3(pearsonIC(scores, returns));
  const rankIC = round3(spearmanIC(scores, returns));
  const n = dataPoints.length;
  const icTStat = n > 2 ? round3(rankIC * Math.sqrt(n - 2) / Math.sqrt(Math.max(1 - rankIC ** 2, 1e-9))) : 0;

  const bull = dataPoints.filter(d => d.score >= 60);
  const neutral = dataPoints.filter(d => d.score > 40 && d.score < 60);
  const bear = dataPoints.filter(d => d.score <= 40);

  const deciles = Array.from({ length: 10 }, (_, d) => {
    const low = d * 10;
    const high = (d + 1) * 10;
    const pts = dataPoints.filter(p => d === 9 ? p.score >= low : (p.score >= low && p.score < high));
    return {
      bucket: `${low}–${high}`,
      count: pts.length,
      hitRate: hitRate(pts, true),
      avgReturn: avg(pts.map(p => p.fwdReturn)),
    };
  });

  const scatter = dataPoints
    .filter((_, i) => i % 3 === 0)
    .map(d => ({ x: d.score, y: Math.round(d.fwdReturn * 100) / 100, date: d.date }));

  const result = {
    ticker,
    horizon,
    ic,
    icRating: icRating(Math.abs(ic)),
    rankIC,
    rankICRating: icRating(Math.abs(rankIC)),
    icTStat,
    totalObservations: n,
    bull: {
      count: bull.length,
      hitRate: hitRate(bull, true),
      avgReturn: avg(bull.map(d => d.fwdReturn)),
    },
    neutral: {
      count: neutral.length,
      hitRate: hitRate(neutral, true),
      avgReturn: avg(neutral.map(d => d.fwdReturn)),
    },
    bear: {
      count: bear.length,
      hitRate: hitRate(bear, false),
      avgReturn: avg(bear.map(d => d.fwdReturn)),
    },
    deciles,
    scatter,
    cachedAt: new Date().toISOString(),
  };

  backtestCache.set(cacheKey, result);
  res.json(result);
});

export default router;

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

function avg(arr: number[]): number | null {
  return arr.length ? Math.round((arr.reduce((s, v) => s + v, 0) / arr.length) * 100) / 100 : null;
}

function hitRate(pts: Array<{ fwdReturn: number }>, positive: boolean): number | null {
  if (!pts.length) return null;
  return Math.round(pts.filter(d => positive ? d.fwdReturn > 0 : d.fwdReturn < 0).length / pts.length * 100);
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
  const ic = Math.round(pearsonIC(scores, returns) * 1000) / 1000;
  const absIC = Math.abs(ic);
  const icRating = absIC >= 0.10 ? "strong" : absIC >= 0.05 ? "moderate" : absIC >= 0.02 ? "weak" : "noise";

  const bull = dataPoints.filter(d => d.score >= 60);
  const neutral = dataPoints.filter(d => d.score > 40 && d.score < 60);
  const bear = dataPoints.filter(d => d.score <= 40);

  const scatter = dataPoints
    .filter((_, i) => i % 3 === 0)
    .map(d => ({ x: d.score, y: Math.round(d.fwdReturn * 100) / 100, date: d.date }));

  const result = {
    ticker,
    horizon,
    ic,
    icRating,
    totalObservations: dataPoints.length,
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
    scatter,
    cachedAt: new Date().toISOString(),
  };

  backtestCache.set(cacheKey, result);
  res.json(result);
});

export default router;

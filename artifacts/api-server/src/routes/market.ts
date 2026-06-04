import { Router, type IRouter } from "express";
import { fetchQuote, fetchOHLCV } from "../lib/marketData.js";
import { marketCache } from "../lib/cache.js";
import { calcTrend, calcRegimeIndicators } from "../lib/indicators.js";
import { getOrStartScanJob } from "../lib/scanJob.js";
import { getUniverse } from "../lib/scannerUniverse.js";

const router: IRouter = Router();

router.get("/market/overview", async (req, res): Promise<void> => {
  const cached = marketCache.get("overview");
  if (cached) {
    res.json(cached);
    return;
  }

  // 1y bars for SPY (vol percentile needs full year).
  // HYG/LQD 3-month bars for credit spread momentum; ^VIX3M for term structure.
  const [spy, qqq, iwm, vix, spyBars, hygBars, lqdBars, vix3mQuote] = await Promise.all([
    fetchQuote("SPY"),
    fetchQuote("QQQ"),
    fetchQuote("IWM"),
    fetchQuote("^VIX"),
    fetchOHLCV("SPY", "1y", "1d"),
    fetchOHLCV("HYG", "3mo", "1d").catch(() => []),
    fetchOHLCV("LQD", "3mo", "1d").catch(() => []),
    fetchQuote("^VIX3M").catch(() => null),
  ]);

  const toMarketQuote = (q: typeof spy) => ({
    ticker: q.ticker,
    price: q.price,
    change: q.change,
    changePercent: q.changePercent,
    volume: q.volume,
  });

  // ── Credit spread factor: HYG/LQD 20D ratio momentum (0–100) ─────────────
  // Rising HYG/LQD ratio = credit spreads tightening = risk-on environment.
  let creditSpreadFactor: number | undefined;
  if (hygBars.length >= 21 && lqdBars.length >= 21) {
    const minLen = Math.min(hygBars.length, lqdBars.length);
    const latest = hygBars[minLen - 1].close / lqdBars[minLen - 1].close;
    const prior  = hygBars[minLen - 21].close / lqdBars[minLen - 21].close;
    const momentum20D = (latest / prior - 1) * 100; // percentage
    // -2% → factor 0 (credit widening, risk-off); +2% → factor 100 (credit improving, risk-on)
    creditSpreadFactor = Math.max(0, Math.min(100, (momentum20D + 2) / 4 * 100));
  }

  // ── VIX term structure factor: VIX3M / VIX ratio (0–100) ────────────────
  // Normal contango (ratio > 1) = calm; backwardation (ratio < 1) = fear.
  let vixTermStructureFactor: number | undefined;
  if (vix3mQuote && vix.price > 0) {
    const vts = vix3mQuote.price / vix.price;
    // 0.80 → factor 0 (strong backwardation/fear); 1.30 → factor 100 (strong contango/calm)
    vixTermStructureFactor = Math.max(0, Math.min(100, (vts - 0.80) / 0.50 * 100));
  }

  const spyTrend = calcTrend(spyBars, spy.price);
  const regime = calcRegimeIndicators(spyBars, spyTrend, { creditSpreadFactor, vixTermStructureFactor });
  const vixPrice = vix.price;

  let marketRegime: "risk_on" | "neutral" | "risk_off" = "neutral";
  let marketRegimeScore = regime.regimeScore;

  // VIX override: spike above 30 always triggers risk_off regardless of trend
  if (vixPrice > 30) {
    marketRegime = "risk_off";
    marketRegimeScore = Math.min(marketRegimeScore, 30);
  } else if (regime.regimeScore > 60 && vixPrice < 20) {
    marketRegime = "risk_on";
  } else if (regime.regimeScore < 40) {
    marketRegime = "risk_off";
  }

  // Breadth from the scanner job's in-memory analyses (always fresh — 30-min TTL).
  // We read from job.analyses rather than analysisCache because the cache TTL (5 min)
  // is shorter than the scanner job TTL (30 min), causing breadth to go null between scans.
  const job = getOrStartScanJob();
  const jobAnalyses = job.analyses;
  let aboveSma50 = 0, aboveSma200 = 0;
  for (const a of jobAnalyses) {
    const price = a.quote.price as number;
    if (a.trend.sma50  > 0 && price > a.trend.sma50)  aboveSma50++;
    if (a.trend.sma200 > 0 && price > a.trend.sma200) aboveSma200++;
  }
  const breadthTotal  = jobAnalyses.length;
  const pctAboveSma50  = breadthTotal >= 20 ? Math.round(aboveSma50  / breadthTotal * 100) : null;
  const pctAboveSma200 = breadthTotal >= 20 ? Math.round(aboveSma200 / breadthTotal * 100) : null;

  const overview = {
    spy: toMarketQuote(spy),
    qqq: toMarketQuote(qqq),
    iwm: toMarketQuote(iwm),
    vix: toMarketQuote(vix),
    marketRegime,
    marketRegimeScore: Math.round(Math.max(0, Math.min(100, marketRegimeScore))),
    adx: regime.adx,
    adxTrending: regime.adxTrending,
    realizedVol20: regime.realizedVol20,
    realizedVolPct: regime.realizedVolPct,
    creditSpreadFactor: regime.creditSpreadFactor,
    vixTermStructureFactor: regime.vixTermStructureFactor,
    pctAboveSma50,
    pctAboveSma200,
    breadthUniverse: breadthTotal > 0 ? breadthTotal : null,
    universe: {
      size: getUniverse().length,
      note: "Current large/mid-cap constituents + ETFs. Point-in-time historical membership not tracked — backtests exclude delisted names.",
    },
    timestamp: new Date().toISOString(),
  };

  marketCache.set("overview", overview);
  res.json(overview);
});

export default router;

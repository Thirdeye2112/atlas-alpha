import { Router, type IRouter } from "express";
import { fetchQuote, fetchOHLCV } from "../lib/marketData.js";
import { marketCache } from "../lib/cache.js";
import { calcTrend, calcRegimeIndicators } from "../lib/indicators.js";
import { getCachedBreadth } from "../lib/analysisEngine.js";

const router: IRouter = Router();

router.get("/market/overview", async (req, res): Promise<void> => {
  const cached = marketCache.get("overview");
  if (cached) {
    res.json(cached);
    return;
  }

  // 1y bars for SPY so realized vol percentile has a full year of history
  const [spy, qqq, iwm, vix, spyBars] = await Promise.all([
    fetchQuote("SPY"),
    fetchQuote("QQQ"),
    fetchQuote("IWM"),
    fetchQuote("^VIX"),
    fetchOHLCV("SPY", "1y", "1d"),
  ]);

  const toMarketQuote = (q: typeof spy) => ({
    ticker: q.ticker,
    price: q.price,
    change: q.change,
    changePercent: q.changePercent,
    volume: q.volume,
  });

  const spyTrend = calcTrend(spyBars, spy.price);
  const regime = calcRegimeIndicators(spyBars, spyTrend);
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

  // Breadth from cached scanner analyses (null until scanner has run)
  const breadth = getCachedBreadth();

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
    pctAboveSma50:  breadth.pctAboveSma50,
    pctAboveSma200: breadth.pctAboveSma200,
    breadthUniverse: breadth.total > 0 ? breadth.total : null,
    timestamp: new Date().toISOString(),
  };

  marketCache.set("overview", overview);
  res.json(overview);
});

export default router;

import { Router, type IRouter } from "express";
import { fetchQuote } from "../lib/marketData.js";
import { marketCache } from "../lib/cache.js";
import { calcTrend } from "../lib/indicators.js";
import { fetchOHLCV } from "../lib/marketData.js";

const router: IRouter = Router();

router.get("/market/overview", async (req, res): Promise<void> => {
  const cached = marketCache.get("overview");
  if (cached) {
    res.json(cached);
    return;
  }

  const [spy, qqq, iwm, vix, spyBars] = await Promise.all([
    fetchQuote("SPY"),
    fetchQuote("QQQ"),
    fetchQuote("IWM"),
    fetchQuote("^VIX"),
    fetchOHLCV("SPY", "3mo", "1d"),
  ]);

  const toMarketQuote = (q: typeof spy) => ({
    ticker: q.ticker,
    price: q.price,
    change: q.change,
    changePercent: q.changePercent,
    volume: q.volume,
  });

  const spyTrend = calcTrend(spyBars, spy.price);
  const vixPrice = vix.price;

  let marketRegime: "risk_on" | "neutral" | "risk_off" = "neutral";
  let marketRegimeScore = 50;
  if (spyTrend.trendAlignmentScore > 65 && vixPrice < 20) {
    marketRegime = "risk_on";
    marketRegimeScore = 70 + (65 - vixPrice);
  } else if (spyTrend.trendAlignmentScore < 35 || vixPrice > 30) {
    marketRegime = "risk_off";
    marketRegimeScore = 30 - Math.max(0, vixPrice - 20);
  } else {
    marketRegimeScore = spyTrend.trendAlignmentScore;
  }
  marketRegimeScore = Math.max(0, Math.min(100, marketRegimeScore));

  const overview = {
    spy: toMarketQuote(spy),
    qqq: toMarketQuote(qqq),
    iwm: toMarketQuote(iwm),
    vix: toMarketQuote(vix),
    marketRegime,
    marketRegimeScore: Math.round(marketRegimeScore),
    advancingStocks: null,
    decliningStocks: null,
    newHighs: null,
    newLows: null,
    timestamp: new Date().toISOString(),
  };

  marketCache.set("overview", overview);
  res.json(overview);
});

export default router;

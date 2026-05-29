import { Router, type IRouter } from "express";
import { fetchQuote, fetchOHLCV } from "../lib/marketData.js";
import { runFullAnalysis, runHistoricalAnalysis } from "../lib/analysisEngine.js";
import { calibrationStore } from "../lib/calibrationStore.js";
import { GetStockQuoteParams, GetStockAnalysisParams, GetStockOhlcvParams } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/stock/:ticker/quote", async (req, res): Promise<void> => {
  const params = GetStockQuoteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  try {
    const quote = await fetchQuote(params.data.ticker.toUpperCase());
    res.json(quote);
  } catch (err) {
    req.log.warn({ err, ticker: params.data.ticker }, "Quote fetch failed");
    res.status(404).json({ error: `Ticker not found: ${params.data.ticker}` });
  }
});

router.get("/stock/:ticker/analysis", async (req, res): Promise<void> => {
  const params = GetStockAnalysisParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  try {
    const analysis = await runFullAnalysis(params.data.ticker);
    const sym = params.data.ticker.toUpperCase();

    // Overlay calibration data fresh on every request (not cached — calibration
    // updates async and we want the UI to reflect it without requiring a cache flush)
    const calStatus = calibrationStore.status(sym);
    const calEntry  = calibrationStore.getFitted(sym);
    const calibratedProbability = calEntry
      ? calEntry.calibratedProbability(analysis.atlasScore.overall)
      : null;

    res.json({
      ...analysis,
      calibration: {
        status: calStatus,
        calibratedProbability,
        slope:        calEntry?.slope        ?? null,
        intercept:    calEntry?.intercept     ?? null,
        observations: calEntry?.observations  ?? null,
        horizon:      calEntry?.horizon       ?? null,
        rankIC:       calEntry?.rankIC        ?? null,
        icRating:     calEntry?.icRating      ?? null,
        fittedAt:     calEntry?.fittedAt      ?? null,
      },
    });
  } catch (err) {
    req.log.warn({ err, ticker: params.data.ticker }, "Analysis failed");
    res.status(404).json({ error: `Could not analyze ticker: ${params.data.ticker}` });
  }
});

router.get("/stock/:ticker/historical-analysis", async (req, res): Promise<void> => {
  const ticker = (req.params.ticker as string).toUpperCase();
  const asOf   = typeof req.query.asOf === "string" ? req.query.asOf : "";
  if (!asOf || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    res.status(400).json({ error: "asOf query param required (YYYY-MM-DD)" });
    return;
  }
  try {
    const analysis = await runHistoricalAnalysis(ticker, asOf);
    // Historical analyses don't get calibration overlay (point-in-time replay)
    res.json({ ...analysis, calibration: null });
  } catch (err) {
    req.log.warn({ err, ticker, asOf }, "Historical analysis failed");
    res.status(404).json({ error: `Could not analyze ${ticker} as of ${asOf}` });
  }
});

router.get("/stock/:ticker/ohlcv", async (req, res): Promise<void> => {
  const params = GetStockOhlcvParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const period   = typeof req.query.period   === "string" ? req.query.period   : "3mo";
  const interval = typeof req.query.interval === "string" ? req.query.interval : "1d";
  try {
    const bars = await fetchOHLCV(params.data.ticker.toUpperCase(), period, interval);
    res.json(bars);
  } catch (err) {
    req.log.warn({ err, ticker: params.data.ticker }, "OHLCV fetch failed");
    res.status(404).json({ error: `No OHLCV data for ${params.data.ticker}` });
  }
});

export default router;

import YahooFinanceClass from "yahoo-finance2";
import { quoteCache, ohlcvCache } from "./cache.js";
import { logger } from "./logger.js";

const yahooFinance = new YahooFinanceClass({ suppressNotices: ["yahooSurvey"] });

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const code = (err as { code?: number })?.code;
      if (code === 429 && attempt < maxRetries - 1) {
        await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
  throw new Error("unreachable");
}

export interface YahooQuote {
  ticker: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  open: number;
  high: number;
  low: number;
  previousClose: number;
  volume: number;
  avgVolume: number;
  marketCap: number | null;
  week52High: number;
  week52Low: number;
  beta: number | null;
  pe: number | null;
  eps: number | null;
  sector: string | null;
  industry: string | null;
  timestamp: string;
}

export interface OHLCVBar {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export async function fetchQuote(ticker: string): Promise<YahooQuote> {
  const cached = quoteCache.get<YahooQuote>(ticker);
  if (cached) return cached;

  const q = await withRetry(() => yahooFinance.quote(ticker));

  const result: YahooQuote = {
    ticker: q.symbol ?? ticker,
    name: q.longName ?? q.shortName ?? ticker,
    price: q.regularMarketPrice ?? 0,
    change: q.regularMarketChange ?? 0,
    changePercent: q.regularMarketChangePercent ?? 0,
    open: q.regularMarketOpen ?? q.regularMarketPrice ?? 0,
    high: q.regularMarketDayHigh ?? q.regularMarketPrice ?? 0,
    low: q.regularMarketDayLow ?? q.regularMarketPrice ?? 0,
    previousClose: q.regularMarketPreviousClose ?? 0,
    volume: q.regularMarketVolume ?? 0,
    avgVolume: q.averageDailyVolume3Month ?? q.averageDailyVolume10Day ?? 0,
    marketCap: q.marketCap ?? null,
    week52High: q.fiftyTwoWeekHigh ?? 0,
    week52Low: q.fiftyTwoWeekLow ?? 0,
    beta: q.beta ?? null,
    pe: q.trailingPE ?? null,
    eps: q.epsTrailingTwelveMonths ?? null,
    sector: null,
    industry: null,
    timestamp: new Date().toISOString(),
  };

  try {
    const summary = await yahooFinance.quoteSummary(ticker, { modules: ["assetProfile"] });
    result.sector = summary.assetProfile?.sector ?? null;
    result.industry = summary.assetProfile?.industry ?? null;
  } catch {
    // sector/industry optional
  }

  quoteCache.set(ticker, result);
  return result;
}

export async function fetchOHLCV(ticker: string, period = "3mo", interval = "1d"): Promise<OHLCVBar[]> {
  const key = `${ticker}:${period}:${interval}`;
  const cached = ohlcvCache.get<OHLCVBar[]>(key);
  if (cached) return cached;

  const end = new Date();
  const start = new Date();

  const intradayIntervals = new Set(["1m","2m","5m","15m","30m","60m","90m","1h"]);
  const isIntraday = intradayIntervals.has(interval);

  if (period === "max") {
    start.setFullYear(end.getFullYear() - 20);
  } else {
    switch (period) {
      case "1d":  start.setDate(end.getDate() - 1); break;
      case "5d":  start.setDate(end.getDate() - 5); break;
      case "1mo": start.setMonth(end.getMonth() - 1); break;
      case "3mo": start.setMonth(end.getMonth() - 3); break;
      case "6mo": start.setMonth(end.getMonth() - 6); break;
      case "1y":  start.setFullYear(end.getFullYear() - 1); break;
      case "2y":  start.setFullYear(end.getFullYear() - 2); break;
      case "5y":  start.setFullYear(end.getFullYear() - 5); break;
      default:    start.setMonth(end.getMonth() - 3);
    }
  }

  const validIntervals = ["1m","2m","5m","15m","30m","60m","90m","1h","1d","5d","1wk","1mo","3mo"] as const;
  type ValidInterval = typeof validIntervals[number];
  const mappedInterval: ValidInterval = (validIntervals.includes(interval as ValidInterval) ? interval : "1d") as ValidInterval;

  const historical = await withRetry(() => yahooFinance.chart(ticker, {
    period1: start,
    period2: end,
    interval: mappedInterval,
  }));

  const bars: OHLCVBar[] = (historical.quotes ?? [])
    .filter(q => q.open != null && q.close != null)
    .map(q => {
      const date = q.date instanceof Date ? q.date : new Date(String(q.date));
      const time = isIntraday
        ? date.toISOString()
        : date.toISOString().split("T")[0];
      return {
        time,
        open: q.open ?? 0,
        high: q.high ?? 0,
        low: q.low ?? 0,
        close: q.close ?? 0,
        volume: q.volume ?? 0,
      };
    });

  ohlcvCache.set(key, bars);
  return bars;
}

export async function fetchMultipleQuotes(tickers: string[]): Promise<Map<string, YahooQuote>> {
  const results = new Map<string, YahooQuote>();
  const toFetch = tickers.filter(t => !quoteCache.get<YahooQuote>(t));
  const cached = tickers.filter(t => quoteCache.get<YahooQuote>(t));

  for (const t of cached) {
    const c = quoteCache.get<YahooQuote>(t);
    if (c) results.set(t, c);
  }

  const batchSize = 20;
  for (let i = 0; i < toFetch.length; i += batchSize) {
    const batch = toFetch.slice(i, i + batchSize);
    await Promise.allSettled(
      batch.map(async ticker => {
        try {
          const q = await fetchQuote(ticker);
          results.set(ticker, q);
        } catch (err) {
          logger.warn({ ticker, err }, "Failed to fetch quote");
        }
      })
    );
  }

  return results;
}

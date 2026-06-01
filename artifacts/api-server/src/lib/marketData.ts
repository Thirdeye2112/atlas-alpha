import YahooFinanceClass from "yahoo-finance2";
import { quoteCache, ohlcvCache } from "./cache.js";
import { persistQuote, persistOhlcv } from "./dbCache.js";
import { getOrFetchBars } from "./ohlcvStore.js";
import { logger } from "./logger.js";

const yahooFinance = new YahooFinanceClass({ suppressNotices: ["yahooSurvey"] });

// ── Global concurrency limiter ────────────────────────────────────────────────
// Caps total concurrent Yahoo Finance calls across warmup + scanner + individual
// requests so we never saturate the external API or the proxy connection pool.
class Semaphore {
  private slots: number;
  private queue: Array<() => void> = [];
  constructor(slots: number) { this.slots = slots; }
  acquire(): Promise<void> {
    if (this.slots > 0) { this.slots--; return Promise.resolve(); }
    return new Promise(resolve => this.queue.push(resolve));
  }
  release(): void {
    const next = this.queue.shift();
    if (next) { next(); } else { this.slots++; }
  }
}
const yahooSem = new Semaphore(8); // max 8 concurrent Yahoo Finance calls

/** Rate-limited, retrying wrapper for all Yahoo Finance calls. */
async function yahooCall<T>(fn: () => Promise<T>): Promise<T> {
  await yahooSem.acquire();
  try {
    return await withRetry(fn);
  } finally {
    yahooSem.release();
  }
}

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
  earningsTimestamp: number | null;
  // Extended hours — null when market is in regular session or data unavailable
  marketState: string | null;           // "REGULAR" | "PRE" | "POST" | "POSTPOST" | "PREPRE" | "CLOSED"
  preMarketPrice: number | null;
  preMarketChangePercent: number | null;
  postMarketPrice: number | null;
  postMarketChangePercent: number | null;
}

export interface OHLCVBar {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type DataWarningCode =
  | "zero_volume"
  | "bar_integrity"
  | "outlier_return"
  | "duplicate_timestamp"
  | "session_gap";

export interface DataWarning {
  code: DataWarningCode;
  index: number;
  time: string;
  detail: string;
}

/**
 * Validates an OHLCV bar array for common data quality issues.
 * Returns an array of warnings (empty = clean data).
 * Does NOT throw — callers decide whether to drop flagged bars.
 */
export function validateOHLCV(bars: OHLCVBar[]): DataWarning[] {
  const warnings: DataWarning[] = [];
  const seenTimes = new Map<string, number>();

  // Trailing 60-bar volatility for outlier detection
  const getTrailingVol = (idx: number): number => {
    const start = Math.max(0, idx - 60);
    const slice = bars.slice(start, idx);
    if (slice.length < 10) return Infinity; // not enough history — skip outlier check
    const returns = slice.map((b, i) =>
      i === 0 ? 0 : Math.log(b.close / slice[i - 1].close)
    ).slice(1);
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
    return Math.sqrt(variance);
  };

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];

    // Duplicate timestamps
    if (seenTimes.has(bar.time)) {
      warnings.push({ code: "duplicate_timestamp", index: i, time: bar.time, detail: `Duplicate of bar at index ${seenTimes.get(bar.time)}` });
    }
    seenTimes.set(bar.time, i);

    // Zero or negative volume (skip ETFs that can have zero-vol on halted sessions)
    if (bar.volume <= 0) {
      warnings.push({ code: "zero_volume", index: i, time: bar.time, detail: `Volume=${bar.volume}` });
    }

    // Bar integrity: high must be >= max(open, close), low <= min(open, close)
    const expectedHigh = Math.max(bar.open, bar.close);
    const expectedLow  = Math.min(bar.open, bar.close);
    if (bar.high < expectedHigh * 0.999 || bar.low > expectedLow * 1.001) {
      warnings.push({ code: "bar_integrity", index: i, time: bar.time,
        detail: `H=${bar.high.toFixed(2)} L=${bar.low.toFixed(2)} O=${bar.open.toFixed(2)} C=${bar.close.toFixed(2)}` });
    }

    // Outlier single-bar return (> 8σ of trailing 60-day vol)
    if (i > 0) {
      const ret = Math.abs(Math.log(bar.close / bars[i - 1].close));
      const sigma = getTrailingVol(i);
      if (sigma < Infinity && ret > 8 * sigma && ret > 0.15) {
        warnings.push({ code: "outlier_return", index: i, time: bar.time,
          detail: `Return=${(ret * 100).toFixed(1)}% is >${(ret / sigma).toFixed(1)}σ` });
      }
    }

    // Session gap: more than 5 calendar days between consecutive daily bars
    if (i > 0 && !bar.time.includes("T")) { // daily bars only
      const prev = new Date(bars[i - 1].time);
      const curr = new Date(bar.time);
      const gapDays = (curr.getTime() - prev.getTime()) / 86_400_000;
      if (gapDays > 7) {
        warnings.push({ code: "session_gap", index: i, time: bar.time,
          detail: `${gapDays.toFixed(0)}-day gap from ${bars[i - 1].time}` });
      }
    }
  }

  return warnings;
}

export async function fetchQuote(ticker: string): Promise<YahooQuote> {
  const cached = quoteCache.get<YahooQuote>(ticker);
  if (cached) return cached;

  // Fire quote + sector lookup in parallel — saves ~500ms vs sequential
  const [qResult, summaryResult] = await Promise.allSettled([
    yahooCall(() => yahooFinance.quote(ticker)),
    yahooCall(() => yahooFinance.quoteSummary(ticker, { modules: ["assetProfile"] })),
  ]);

  if (qResult.status === "rejected") throw qResult.reason;
  const q = qResult.value;
  const summary = summaryResult.status === "fulfilled" ? summaryResult.value : null;

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
    sector: summary?.assetProfile?.sector ?? null,
    industry: summary?.assetProfile?.industry ?? null,
    timestamp: new Date().toISOString(),
    earningsTimestamp: (q as unknown as { earningsTimestamp?: number }).earningsTimestamp ?? null,
    marketState: (q as unknown as { marketState?: string }).marketState ?? null,
    preMarketPrice: (q as unknown as { preMarketPrice?: number }).preMarketPrice ?? null,
    preMarketChangePercent: (q as unknown as { preMarketChangePercent?: number }).preMarketChangePercent ?? null,
    postMarketPrice: (q as unknown as { postMarketPrice?: number }).postMarketPrice ?? null,
    postMarketChangePercent: (q as unknown as { postMarketChangePercent?: number }).postMarketChangePercent ?? null,
  };

  quoteCache.set(ticker, result);
  persistQuote(ticker, result as unknown as object); // fire-and-forget DB write
  return result;
}

// Approximate number of trading days for each period (used for cache seeding)
const PERIOD_TRADING_DAYS: Record<string, number> = {
  "1d": 1, "5d": 5, "1mo": 21, "3mo": 63,
  "6mo": 126, "1y": 252, "2y": 504, "5y": 1260,
};

/**
 * After fetching OHLCV for a longer period, populate shorter-period cache keys
 * by slicing the tail of the data. This means `runFullAnalysis` (which fetches 1y)
 * automatically pre-warms the 3mo/6mo keys that the chart later requests — so
 * the chart hits cache instead of firing a second Yahoo Finance call.
 */
function seedShorterPeriods(ticker: string, period: string, interval: string, bars: OHLCVBar[]): void {
  if (interval !== "1d") return; // only seed daily data
  const fetchedDays = PERIOD_TRADING_DAYS[period];
  if (!fetchedDays) return;

  for (const [seedPeriod, seedDays] of Object.entries(PERIOD_TRADING_DAYS)) {
    if (seedDays >= fetchedDays) continue; // only seed shorter periods
    const seedKey = `${ticker}:${seedPeriod}:1d`;
    if (ohlcvCache.has(seedKey)) continue; // don't overwrite existing cache
    const slice = bars.slice(-seedDays);
    if (slice.length > 0) {
      ohlcvCache.set(seedKey, slice);
    }
  }
}

const INTRADAY_INTERVALS = new Set(["1m","2m","5m","15m","30m","60m","90m","1h"]);
const VALID_INTERVALS = ["1m","2m","5m","15m","30m","60m","90m","1h","1d","5d","1wk","1mo","3mo"] as const;
type ValidInterval = typeof VALID_INTERVALS[number];

/**
 * Raw Yahoo Finance OHLCV fetch — no caching, no DB.
 * Exported so ohlcvStore.ts can inject it as a callback and warmup.ts can call it directly.
 */
export async function fetchYahooRaw(
  ticker:   string,
  period1:  Date,
  period2:  Date,
  interval = "1d",
): Promise<OHLCVBar[]> {
  const isIntraday = INTRADAY_INTERVALS.has(interval);
  const mapped: ValidInterval = (VALID_INTERVALS.includes(interval as ValidInterval) ? interval : "1d") as ValidInterval;

  const historical = await yahooCall(() => yahooFinance.chart(ticker, {
    period1,
    period2,
    interval: mapped,
  }));

  return (historical.quotes ?? [])
    .filter(q => q.open != null && q.close != null)
    .map(q => {
      const d = q.date instanceof Date ? q.date : new Date(String(q.date));
      return {
        time:   isIntraday ? d.toISOString() : d.toISOString().split("T")[0],
        open:   q.open   ?? 0,
        high:   q.high   ?? 0,
        low:    q.low    ?? 0,
        close:  q.close  ?? 0,
        volume: q.volume ?? 0,
      };
    });
}

export async function fetchOHLCV(ticker: string, period = "3mo", interval = "1d"): Promise<OHLCVBar[]> {
  const key = `${ticker}:${period}:${interval}`;

  const isIntraday = INTRADAY_INTERVALS.has(interval);

  // Compute the expected start date first so we can validate cache coverage.
  const end   = new Date();
  const start = new Date();
  if (period === "max") {
    start.setFullYear(end.getFullYear() - 20);
  } else {
    switch (period) {
      case "1d":  start.setDate(end.getDate() - 1);         break;
      case "5d":  start.setDate(end.getDate() - 5);         break;
      case "1mo": start.setMonth(end.getMonth() - 1);       break;
      case "3mo": start.setMonth(end.getMonth() - 3);       break;
      case "6mo": start.setMonth(end.getMonth() - 6);       break;
      case "1y":  start.setFullYear(end.getFullYear() - 1); break;
      case "2y":  start.setFullYear(end.getFullYear() - 2); break;
      case "5y":  start.setFullYear(end.getFullYear() - 5); break;
      default:    start.setMonth(end.getMonth() - 3);
    }
  }

  // Cache hit — but validate coverage: the cached blob may have been seeded with a
  // shorter history (e.g. 2Y of data stored under the "5y" key from an older backfill).
  // If the first bar is more than 45 days later than `start`, treat the cache as stale.
  const cached = ohlcvCache.get<OHLCVBar[]>(key);
  if (cached) {
    const firstBarTime = cached.length > 0 ? new Date(cached[0].time + "T12:00:00Z").getTime() : 0;
    const lagDays = (firstBarTime - start.getTime()) / 86_400_000;
    if (lagDays <= 45) {
      return cached; // cache covers the requested range
    }
    // Cache is stale for this period — evict and re-fetch
    ohlcvCache.del(key);
    logger.debug({ ticker, period, interval, lagDays: Math.round(lagDays) }, "OHLCV cache evicted — stale coverage");
  }

  let bars: OHLCVBar[];
  const fromDate = start.toISOString().split("T")[0];
  const toDate   = end.toISOString().split("T")[0];

  if (isIntraday) {
    // Intraday: no persistent store — always fetch live from Yahoo
    bars = await fetchYahooRaw(ticker, start, end, interval);
  } else {
    // Daily / weekly / monthly: DB-first strategy.
    // Each interval is stored separately (PK: ticker + date + interval).
    // getOrFetchBars handles gap-fills on both the tail AND the historical head,
    // so 5Y/ALL timeframes populate the DB on first request and serve from it after.
    bars = await getOrFetchBars(
      ticker, interval, fromDate, toDate,
      (t, p1, p2) => fetchYahooRaw(t, p1, p2, interval),
    );
  }

  ohlcvCache.set(key, bars);
  persistOhlcv(key, bars as unknown as object);
  if (interval === "1d") seedShorterPeriods(ticker, period, interval, bars);
  logger.debug({ ticker, period, interval, bars: bars.length }, "OHLCV fetched");
  return bars;
}

export async function fetchMultipleQuotes(tickers: string[]): Promise<Map<string, YahooQuote>> {
  const results = new Map<string, YahooQuote>();
  const toFetch = tickers.filter(t => !quoteCache.get<YahooQuote>(t));
  const cached  = tickers.filter(t =>  quoteCache.get<YahooQuote>(t));

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

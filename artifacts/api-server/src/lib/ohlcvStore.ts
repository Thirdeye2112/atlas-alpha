/**
 * Persistent OHLCV history store.
 *
 * The existing `ohlcv_cache` table is a short-lived JSONB blob store (15-min TTL).
 * This module adds `ohlcv_history` — a normalized per-bar table (ticker + date PK)
 * that persists indefinitely and enables incremental "gap-fill" updates:
 *
 *   getOrFetchDailyBars() — serve from DB, pull only missing tail from Yahoo
 *   runOhlcvBackfill()    — initial 2Y seeding + subsequent incremental sync
 *
 * `fetchYahoo` is injected as a callback by callers to avoid a circular import
 * with marketData.ts.
 */
import { db, ohlcvHistoryTable } from "@workspace/db";
import { eq, gte, lte, and, sql } from "drizzle-orm";
import { logger } from "./logger.js";
import type { OHLCVBar } from "./marketData.js";

// ── Date helpers ───────────────────────────────────────────────────────────────

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split("T")[0];
}

function todayStr(): string {
  return new Date().toISOString().split("T")[0];
}

/**
 * Is the stored data fresh enough to skip a Yahoo call?
 * Within 3 calendar days handles Fri close → Mon open, plus US market holidays.
 */
function isCurrent(lastDate: string): boolean {
  const diffMs = Date.now() - new Date(lastDate + "T12:00:00Z").getTime();
  return diffMs <= 3 * 86_400_000;
}

// ── Core DB operations ─────────────────────────────────────────────────────────

/** Read bars from the persistent store for a given ticker and optional date range. */
export async function getHistory(
  ticker:   string,
  fromDate?: string,
  toDate?:   string,
): Promise<OHLCVBar[]> {
  const conds = [eq(ohlcvHistoryTable.ticker, ticker)];
  if (fromDate) conds.push(gte(ohlcvHistoryTable.date, fromDate));
  if (toDate)   conds.push(lte(ohlcvHistoryTable.date, toDate));

  const rows = await db
    .select()
    .from(ohlcvHistoryTable)
    .where(and(...conds))
    .orderBy(ohlcvHistoryTable.date);

  return rows.map(r => ({
    time:   r.date,
    open:   r.open,
    high:   r.high,
    low:    r.low,
    close:  r.close,
    volume: r.volume,
  }));
}

/** Most recently stored date for a ticker, or null if no rows exist. */
export async function getLastDate(ticker: string): Promise<string | null> {
  const result = await db
    .select({ maxDate: sql<string | null>`MAX(${ohlcvHistoryTable.date})` })
    .from(ohlcvHistoryTable)
    .where(eq(ohlcvHistoryTable.ticker, ticker));
  return result[0]?.maxDate ?? null;
}

/** Bar counts for a list of tickers — used to decide what needs backfilling. */
export async function getBarCounts(tickers: string[]): Promise<Map<string, number>> {
  if (!tickers.length) return new Map();
  const rows = await db
    .select({
      ticker: ohlcvHistoryTable.ticker,
      count:  sql<number>`COUNT(*)::int`,
    })
    .from(ohlcvHistoryTable)
    .where(sql`${ohlcvHistoryTable.ticker} = ANY(ARRAY[${sql.join(tickers.map(t => sql`${t}`), sql`, `)}])`);
  return new Map(rows.map(r => [r.ticker, r.count]));
}

/**
 * Upsert a batch of daily bars for a ticker.
 * Processes in chunks of 500 to stay within PostgreSQL parameter limits.
 * On conflict (same ticker + date) updates OHLCV in case of adjustments.
 */
export async function upsertBars(ticker: string, bars: OHLCVBar[]): Promise<void> {
  if (!bars.length) return;

  const values = bars.map(b => ({
    ticker,
    date:   b.time,
    open:   b.open,
    high:   b.high,
    low:    b.low,
    close:  b.close,
    volume: b.volume,
  }));

  const CHUNK = 500;
  for (let i = 0; i < values.length; i += CHUNK) {
    await db
      .insert(ohlcvHistoryTable)
      .values(values.slice(i, i + CHUNK))
      .onConflictDoUpdate({
        target: [ohlcvHistoryTable.ticker, ohlcvHistoryTable.date],
        set: {
          open:   sql`excluded.open`,
          high:   sql`excluded.high`,
          low:    sql`excluded.low`,
          close:  sql`excluded.close`,
          volume: sql`excluded.volume`,
        },
      });
  }
}

// ── Smart fetch: DB-first, Yahoo gap-fill ─────────────────────────────────────

type YahooFetcher = (ticker: string, period1: Date, period2: Date) => Promise<OHLCVBar[]>;

/**
 * Return daily bars for [fromDate, toDate] using a DB-first strategy:
 *   1. If DB has recent data → serve directly (no Yahoo call)
 *   2. If DB is stale/empty → fetch only the missing tail from Yahoo, upsert, return from DB
 *   3. If DB ops fail → fall back to a direct Yahoo call
 */
export async function getOrFetchDailyBars(
  ticker:     string,
  fromDate:   string,
  toDate:     string,
  fetchYahoo: YahooFetcher,
): Promise<OHLCVBar[]> {
  try {
    const lastDate = await getLastDate(ticker);

    if (lastDate && isCurrent(lastDate)) {
      const bars = await getHistory(ticker, fromDate, toDate);
      if (bars.length > 0) return bars;
    }

    // Pull only the missing tail (or full range if no data at all)
    const fetchFrom = lastDate ? addDays(lastDate, 1) : fromDate;
    const fetchTo   = addDays(todayStr(), 1);

    if (fetchFrom <= fetchTo) {
      const newBars = await fetchYahoo(
        ticker,
        new Date(fetchFrom + "T12:00:00Z"),
        new Date(fetchTo   + "T12:00:00Z"),
      );
      if (newBars.length > 0) {
        await upsertBars(ticker, newBars);
        logger.debug({ ticker, count: newBars.length, from: fetchFrom }, "OHLCV history: upserted bars");
      }
    }

    const bars = await getHistory(ticker, fromDate, toDate);
    if (bars.length > 0) return bars;

    // DB came back empty after upsert (e.g. ticker had no data in Yahoo for that range)
    return fetchYahoo(
      ticker,
      new Date(fromDate + "T12:00:00Z"),
      new Date(toDate   + "T12:00:00Z"),
    );
  } catch (err) {
    logger.warn({ err, ticker }, "OHLCV history store error — falling back to Yahoo");
    return fetchYahoo(
      ticker,
      new Date(fromDate + "T12:00:00Z"),
      new Date(toDate   + "T12:00:00Z"),
    );
  }
}

// ── Background backfill job ────────────────────────────────────────────────────

export interface BackfillState {
  running:   boolean;
  done:      number;
  skipped:   number;
  failed:    number;
  total:     number;
  startedAt: string | null;
}

const backfillState: BackfillState = {
  running: false, done: 0, skipped: 0, failed: 0, total: 0, startedAt: null,
};

export function getBackfillState(): BackfillState { return { ...backfillState }; }

const MIN_BARS_FULL  = 400;  // fewer bars than this → needs a full 2Y backfill
const TWO_YEARS_DAYS = 732;  // 2 years + buffer for weekends / holidays
const BATCH_SIZE     = 5;
const BATCH_DELAY_MS = 1500;

/**
 * Background job: seeds every ticker in `tickers` with 2Y of daily bars and
 * keeps the history current via incremental gap-fills.
 *
 * Strategy per ticker:
 *  - Already current (≤3 days stale, ≥400 bars) → skip
 *  - Stale but has enough bars              → incremental fetch (lastDate+1 → today)
 *  - Missing / too few bars                 → full 2Y fetch
 */
export async function runOhlcvBackfill(
  tickers:    string[],
  fetchYahoo: YahooFetcher,
): Promise<void> {
  if (backfillState.running) {
    logger.warn("OHLCV backfill already running — skipping duplicate");
    return;
  }

  backfillState.running   = true;
  backfillState.done      = 0;
  backfillState.skipped   = 0;
  backfillState.failed    = 0;
  backfillState.total     = tickers.length;
  backfillState.startedAt = new Date().toISOString();

  const today     = todayStr();
  const twoYrsAgo = addDays(today, -TWO_YEARS_DAYS);

  const barCounts = await getBarCounts(tickers).catch(() => new Map<string, number>());

  logger.info({ total: tickers.length }, "OHLCV backfill: starting");

  for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
    const batch = tickers.slice(i, i + BATCH_SIZE);

    await Promise.allSettled(batch.map(async ticker => {
      try {
        const count    = barCounts.get(ticker) ?? 0;
        const lastDate = count > 0 ? await getLastDate(ticker) : null;
        const staleDays = lastDate
          ? Math.floor((Date.now() - new Date(lastDate + "T12:00:00Z").getTime()) / 86_400_000)
          : 999;

        if (lastDate && staleDays <= 3 && count >= MIN_BARS_FULL) {
          backfillState.skipped++;
          return;
        }

        const fetchFrom = (lastDate && count >= MIN_BARS_FULL)
          ? addDays(lastDate, 1)
          : twoYrsAgo;
        const fetchTo   = addDays(today, 1);

        const bars = await fetchYahoo(
          ticker,
          new Date(fetchFrom + "T12:00:00Z"),
          new Date(fetchTo   + "T12:00:00Z"),
        );
        if (bars.length > 0) await upsertBars(ticker, bars);
        backfillState.done++;
        logger.debug({ ticker, bars: bars.length, from: fetchFrom }, "OHLCV backfill: ticker done");
      } catch (err) {
        backfillState.failed++;
        logger.warn({ ticker, err }, "OHLCV backfill: ticker failed");
      }
    }));

    if (i + BATCH_SIZE < tickers.length) {
      await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  backfillState.running = false;
  logger.info(
    { done: backfillState.done, skipped: backfillState.skipped, failed: backfillState.failed },
    "OHLCV backfill: complete",
  );
}

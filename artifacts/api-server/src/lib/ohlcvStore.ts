/**
 * Persistent OHLCV history store.
 *
 * The `ohlcv_history` table stores per-bar data with a composite PK of
 * (ticker, date, interval).  Supported intervals: "1d", "1wk", "1mo".
 *
 * Public surface:
 *   getOrFetchBars()   — DB-first smart fetch; pulls only the missing edges from Yahoo
 *   runOhlcvBackfill() — initial 2Y daily seeding + incremental daily gap-fill
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
 * Freshness window varies by interval:
 *   "1d"  — stale after 3 calendar days (handles weekends + US holidays)
 *   "1wk" — stale after 7 days (a full trading week)
 *   "1mo" — stale after 35 days (a full calendar month)
 */
function isCurrent(lastDate: string, interval = "1d"): boolean {
  const diffMs = Date.now() - new Date(lastDate + "T12:00:00Z").getTime();
  const windowMs =
    interval === "1mo" ? 35 * 86_400_000 :
    interval === "1wk" ?  7 * 86_400_000 :
                          3 * 86_400_000;
  return diffMs <= windowMs;
}

// ── Core DB operations ─────────────────────────────────────────────────────────

/** Read bars from the persistent store for a given ticker, interval and optional date range. */
export async function getHistory(
  ticker:    string,
  interval = "1d",
  fromDate?: string,
  toDate?:   string,
): Promise<OHLCVBar[]> {
  const conds = [
    eq(ohlcvHistoryTable.ticker,   ticker),
    eq(ohlcvHistoryTable.interval, interval),
  ];
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

/** Most recently stored date for a (ticker, interval) pair. */
export async function getLastDate(ticker: string, interval = "1d"): Promise<string | null> {
  const result = await db
    .select({ maxDate: sql<string | null>`MAX(${ohlcvHistoryTable.date})` })
    .from(ohlcvHistoryTable)
    .where(and(
      eq(ohlcvHistoryTable.ticker,   ticker),
      eq(ohlcvHistoryTable.interval, interval),
    ));
  return result[0]?.maxDate ?? null;
}

/** Earliest stored date for a (ticker, interval) pair. */
export async function getFirstDate(ticker: string, interval = "1d"): Promise<string | null> {
  const result = await db
    .select({ minDate: sql<string | null>`MIN(${ohlcvHistoryTable.date})` })
    .from(ohlcvHistoryTable)
    .where(and(
      eq(ohlcvHistoryTable.ticker,   ticker),
      eq(ohlcvHistoryTable.interval, interval),
    ));
  return result[0]?.minDate ?? null;
}

/** Bar counts for a list of tickers at a given interval — used by the backfill job. */
export async function getBarCounts(
  tickers:  string[],
  interval = "1d",
): Promise<Map<string, number>> {
  if (!tickers.length) return new Map();
  const rows = await db
    .select({
      ticker: ohlcvHistoryTable.ticker,
      count:  sql<number>`COUNT(*)::int`,
    })
    .from(ohlcvHistoryTable)
    .where(and(
      sql`${ohlcvHistoryTable.ticker} = ANY(ARRAY[${sql.join(tickers.map(t => sql`${t}`), sql`, `)}])`,
      eq(ohlcvHistoryTable.interval, interval),
    ));
  return new Map(rows.map(r => [r.ticker, r.count]));
}

/**
 * Upsert a batch of bars for (ticker, interval).
 * Processes in chunks of 500 to stay within PostgreSQL parameter limits.
 */
export async function upsertBars(
  ticker:   string,
  interval: string,
  bars:     OHLCVBar[],
): Promise<void> {
  if (!bars.length) return;

  const values = bars.map(b => ({
    ticker,
    date:     b.time,
    interval,
    open:     b.open,
    high:     b.high,
    low:      b.low,
    close:    b.close,
    volume:   b.volume,
  }));

  const CHUNK = 500;
  for (let i = 0; i < values.length; i += CHUNK) {
    await db
      .insert(ohlcvHistoryTable)
      .values(values.slice(i, i + CHUNK))
      .onConflictDoUpdate({
        target: [ohlcvHistoryTable.ticker, ohlcvHistoryTable.date, ohlcvHistoryTable.interval],
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

// ── Smart fetch: DB-first, Yahoo gap-fill ──────────────────────────────────────

type YahooFetcher = (ticker: string, period1: Date, period2: Date) => Promise<OHLCVBar[]>;

/**
 * Return bars for [fromDate, toDate] at the given interval using a DB-first strategy:
 *   1. Check tail freshness — if stale, pull the missing tail from Yahoo and upsert
 *   2. Check head coverage — if DB doesn't go back far enough, fetch the historical gap
 *   3. Serve from DB
 *   4. On any DB error, fall back to a direct Yahoo call
 */
export async function getOrFetchBars(
  ticker:     string,
  interval:   string,
  fromDate:   string,
  toDate:     string,
  fetchYahoo: YahooFetcher,
): Promise<OHLCVBar[]> {
  try {
    const [lastDate, firstDate] = await Promise.all([
      getLastDate(ticker, interval),
      getFirstDate(ticker, interval),
    ]);

    const tailFresh = lastDate !== null && isCurrent(lastDate, interval);

    // ── Gap at the TAIL (recent data missing) ──────────────────────────────
    if (!tailFresh) {
      const fetchFrom = lastDate ? addDays(lastDate, 1) : fromDate;
      const fetchTo   = addDays(todayStr(), 1);
      if (fetchFrom <= fetchTo) {
        const newBars = await fetchYahoo(
          ticker,
          new Date(fetchFrom + "T12:00:00Z"),
          new Date(fetchTo   + "T12:00:00Z"),
        );
        if (newBars.length > 0) {
          await upsertBars(ticker, interval, newBars);
          logger.debug({ ticker, interval, count: newBars.length, from: fetchFrom }, "OHLCV history: tail upsert");
        }
      }
    }

    // ── Gap at the HEAD (requested range older than what's stored) ─────────
    // Allow a 10-day buffer for weekends / holidays before triggering a fetch.
    const needsHistory = firstDate === null || addDays(fromDate, 10) < firstDate;
    if (needsHistory) {
      const fetchFrom = fromDate;
      const fetchTo   = firstDate ? addDays(firstDate, -1) : addDays(todayStr(), 1);
      if (fetchFrom < fetchTo) {
        logger.debug({ ticker, interval, from: fetchFrom, to: fetchTo }, "OHLCV history: fetching historical gap");
        const oldBars = await fetchYahoo(
          ticker,
          new Date(fetchFrom + "T12:00:00Z"),
          new Date(fetchTo   + "T12:00:00Z"),
        );
        if (oldBars.length > 0) {
          await upsertBars(ticker, interval, oldBars);
          logger.debug({ ticker, interval, count: oldBars.length, from: fetchFrom }, "OHLCV history: head upsert");
        }
      }
    }

    const bars = await getHistory(ticker, interval, fromDate, toDate);
    if (bars.length > 0) return bars;

    // DB came back empty after upserts (e.g. ticker had no Yahoo data for range)
    return fetchYahoo(
      ticker,
      new Date(fromDate + "T12:00:00Z"),
      new Date(toDate   + "T12:00:00Z"),
    );
  } catch (err) {
    logger.warn({ err, ticker, interval }, "OHLCV history store error — falling back to Yahoo");
    return fetchYahoo(
      ticker,
      new Date(fromDate + "T12:00:00Z"),
      new Date(toDate   + "T12:00:00Z"),
    );
  }
}

// ── Legacy alias (daily only) ──────────────────────────────────────────────────

/** @deprecated Use getOrFetchBars with interval="1d" */
export async function getOrFetchDailyBars(
  ticker:     string,
  fromDate:   string,
  toDate:     string,
  fetchYahoo: YahooFetcher,
): Promise<OHLCVBar[]> {
  return getOrFetchBars(ticker, "1d", fromDate, toDate, fetchYahoo);
}

// ── Background backfill job (daily bars only) ──────────────────────────────────

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
 * Only operates on interval="1d". Weekly / monthly bars are populated
 * on-demand by getOrFetchBars when a user first views that timeframe.
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

  const barCounts = await getBarCounts(tickers, "1d").catch(() => new Map<string, number>());

  logger.info({ total: tickers.length }, "OHLCV backfill: starting");

  for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
    const batch = tickers.slice(i, i + BATCH_SIZE);

    await Promise.allSettled(batch.map(async ticker => {
      try {
        const count    = barCounts.get(ticker) ?? 0;
        const lastDate = count > 0 ? await getLastDate(ticker, "1d") : null;
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
        if (bars.length > 0) await upsertBars(ticker, "1d", bars);
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

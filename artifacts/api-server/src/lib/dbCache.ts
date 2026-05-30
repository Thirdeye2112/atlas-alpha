/**
 * PostgreSQL-backed persistent cache.
 * Writes every Yahoo Finance result to Postgres so a server restart re-hydrates
 * in-memory NodeCache instantly — no cold-start warming needed.
 */
import { db, quoteCacheTable, ohlcvCacheTable } from "@workspace/db";
import { gt } from "drizzle-orm";
import { quoteCache, ohlcvCache } from "./cache.js";
import { logger } from "./logger.js";

const QUOTE_TTL_MS = 60  * 1000;  // 1 min  — match NodeCache TTL
const OHLCV_TTL_MS = 900 * 1000;  // 15 min — match NodeCache TTL

/** Called once at startup. Hydrates in-memory caches from Postgres. */
export async function hydrateFromDb(): Promise<void> {
  try {
    const [quoteRows, ohlcvRows] = await Promise.all([
      db.select()
        .from(quoteCacheTable)
        .where(gt(quoteCacheTable.fetchedAt, new Date(Date.now() - QUOTE_TTL_MS))),
      db.select()
        .from(ohlcvCacheTable)
        .where(gt(ohlcvCacheTable.fetchedAt, new Date(Date.now() - OHLCV_TTL_MS))),
    ]);

    for (const row of quoteRows) {
      quoteCache.set(row.ticker, row.data);
    }
    for (const row of ohlcvRows) {
      ohlcvCache.set(row.id, row.data);
    }

    logger.info(
      { quotes: quoteRows.length, ohlcv: ohlcvRows.length },
      "DB cache hydrated"
    );
  } catch (err) {
    logger.warn({ err }, "DB cache hydration failed — falling back to cold start");
  }
}

/** Fire-and-forget: persist a quote to Postgres after a successful Yahoo fetch. */
export function persistQuote(ticker: string, data: object): void {
  db.insert(quoteCacheTable)
    .values({ ticker, data, fetchedAt: new Date() })
    .onConflictDoUpdate({
      target: quoteCacheTable.ticker,
      set: { data, fetchedAt: new Date() },
    })
    .catch(err => logger.warn({ err, ticker }, "Failed to persist quote to DB"));
}

/** Fire-and-forget: persist OHLCV bars to Postgres after a successful Yahoo fetch. */
export function persistOhlcv(key: string, data: object): void {
  db.insert(ohlcvCacheTable)
    .values({ id: key, data, fetchedAt: new Date() })
    .onConflictDoUpdate({
      target: ohlcvCacheTable.id,
      set: { data, fetchedAt: new Date() },
    })
    .catch(err => logger.warn({ err, key }, "Failed to persist OHLCV to DB"));
}

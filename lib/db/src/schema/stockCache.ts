import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";

export const quoteCacheTable = pgTable("quote_cache", {
  ticker:    text("ticker").primaryKey(),
  data:      jsonb("data").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});

export const ohlcvCacheTable = pgTable("ohlcv_cache", {
  id:        text("id").primaryKey(), // "TICKER:period:interval"
  data:      jsonb("data").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});

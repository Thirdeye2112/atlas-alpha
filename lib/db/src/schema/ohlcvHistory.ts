import { pgTable, text, date, real, bigint, primaryKey, index } from "drizzle-orm/pg-core";

export const ohlcvHistoryTable = pgTable(
  "ohlcv_history",
  {
    ticker:   text("ticker").notNull(),
    date:     date("date", { mode: "string" }).notNull(),
    /** Bar interval — "1d" | "1wk" | "1mo". Existing rows default to "1d". */
    interval: text("interval").notNull().default("1d"),
    open:     real("open").notNull(),
    high:     real("high").notNull(),
    low:      real("low").notNull(),
    close:    real("close").notNull(),
    volume:   bigint("volume", { mode: "number" }).notNull(),
  },
  (t) => ({
    pk:          primaryKey({ columns: [t.ticker, t.date, t.interval] }),
    tickerIdx:   index("ohlcv_history_ticker_idx").on(t.ticker),
    dateIdx:     index("ohlcv_history_date_idx").on(t.date),
    intervalIdx: index("ohlcv_history_interval_idx").on(t.interval),
  })
);

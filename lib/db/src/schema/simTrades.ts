import {
  pgTable, serial, varchar, integer, doublePrecision,
  boolean, text, timestamp, date, index, uniqueIndex,
} from "drizzle-orm/pg-core";

export const simTradesTable = pgTable("sim_trades", {
  id:              serial("id").primaryKey(),
  ticker:          varchar("ticker", { length: 10 }).notNull(),
  simDate:         date("sim_date", { mode: "string" }).notNull(),

  entryPrice:      doublePrecision("entry_price").notNull(),
  atlasScore:      integer("atlas_score").notNull(),
  scoreBucket:     varchar("score_bucket", { length: 20 }),

  trendScore:      integer("trend_score"),
  momentumScore:   integer("momentum_score"),
  volumeScore:     integer("volume_score"),
  rsScore:         integer("rs_score"),
  regimeScore:     integer("regime_score"),
  exhaustionScore: integer("exhaustion_score"),

  rsi:             doublePrecision("rsi"),
  rsiZone:         varchar("rsi_zone", { length: 20 }),
  rvol:            doublePrecision("rvol"),
  atrPct:          doublePrecision("atr_pct"),
  macdHist:        doublePrecision("macd_hist"),

  distributionTop:  boolean("distribution_top"),
  parabolicRise:    boolean("parabolic_rise"),
  exhaustionSignal: varchar("exhaustion_signal", { length: 50 }),

  gateEnter:       boolean("gate_enter").notNull(),
  gateReason:      text("gate_reason"),

  stopPrice:       doublePrecision("stop_price"),
  targetPrice:     doublePrecision("target_price"),

  pnl5d:           doublePrecision("pnl_5d"),
  pnl10d:          doublePrecision("pnl_10d"),
  pnl20d:          doublePrecision("pnl_20d"),
  stoppedOut:      boolean("stopped_out"),
  maxAdverseExc:   doublePrecision("max_adverse_exc"),

  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uq_sim_trade").on(t.ticker, t.simDate),
  index("sim_trades_ticker_idx").on(t.ticker),
  index("sim_trades_gate_idx").on(t.gateEnter),
  index("sim_trades_bucket_idx").on(t.scoreBucket),
]);

export type SimTrade       = typeof simTradesTable.$inferSelect;
export type InsertSimTrade = typeof simTradesTable.$inferInsert;

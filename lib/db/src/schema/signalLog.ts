import { pgTable, serial, text, integer, real, timestamp } from "drizzle-orm/pg-core";

export const signalLogTable = pgTable("signal_log", {
  id:              serial("id").primaryKey(),
  ticker:          text("ticker").notNull(),
  score:           integer("score").notNull(),
  trendScore:      integer("trend_score").notNull(),
  momentumScore:   integer("momentum_score").notNull(),
  volumeScore:     integer("volume_score").notNull(),
  rsScore:         integer("rs_score").notNull(),
  regimeScore:     integer("regime_score").notNull(),
  exhaustionScore: integer("exhaustion_score").notNull(),
  direction:       text("direction").notNull(),
  marketRegime:    text("market_regime"),
  scannerCategory: text("scanner_category"),
  scoreVersion:    text("score_version").notNull(),
  fwdReturn1d:     real("fwd_return_1d"),
  loggedAt:        timestamp("logged_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SignalLog = typeof signalLogTable.$inferSelect;
export type InsertSignalLog = typeof signalLogTable.$inferInsert;

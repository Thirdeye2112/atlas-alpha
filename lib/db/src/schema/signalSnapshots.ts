import {
  pgTable, serial, varchar, integer, doublePrecision,
  boolean, text, timestamp, date, jsonb, uniqueIndex,
} from "drizzle-orm/pg-core";

export const signalSnapshotsTable = pgTable("signal_snapshots", {
  id:                  serial("id").primaryKey(),
  ticker:              varchar("ticker", { length: 10 }).notNull(),
  snapshotDate:        date("snapshot_date", { mode: "string" }).notNull(),

  price:               doublePrecision("price"),
  score:               integer("score"),
  direction:           varchar("direction", { length: 20 }),
  bullishProbability:  doublePrecision("bullish_probability"),

  trendScore:          integer("trend_score"),
  momentumScore:       integer("momentum_score"),
  volumeScore:         integer("volume_score"),
  rsScore:             integer("rs_score"),
  regimeScore:         integer("regime_score"),
  exhaustionScore:     integer("exhaustion_score"),

  rankIc:              doublePrecision("rank_ic"),
  isContrarian:        boolean("is_contrarian"),
  calibratedProb:      doublePrecision("calibrated_prob"),

  rsi:                 doublePrecision("rsi"),
  rsiZone:             varchar("rsi_zone", { length: 20 }),
  rvol:                doublePrecision("rvol"),
  atrPct:              doublePrecision("atr_pct"),

  distributionCandles: integer("distribution_candles"),
  climaxBars:          integer("climax_bars"),
  downDayVolRatio:     doublePrecision("down_day_vol_ratio"),
  parabolicPct:        doublePrecision("parabolic_pct"),
  consecutiveRedDays:  integer("consecutive_red_days"),
  priceExtensionPct:   doublePrecision("price_extension_pct"),

  exhaustionSignal:    varchar("exhaustion_signal", { length: 50 }),
  distributionTop:     boolean("distribution_top"),
  parabolicRise:       boolean("parabolic_rise"),

  cyclePhase:          varchar("cycle_phase", { length: 30 }),
  cycleStrength:       integer("cycle_strength"),
  patterns:            jsonb("patterns").$type<string[]>().default([]),
  weeklyPatterns:      jsonb("weekly_patterns").$type<string[]>().default([]),
  pullbackClass:       varchar("pullback_class", { length: 30 }),

  smartGateEnter:      boolean("smart_gate_enter"),
  smartGateReason:     text("smart_gate_reason"),

  forwardReturn5d:     doublePrecision("forward_return_5d"),
  forwardReturn10d:    doublePrecision("forward_return_10d"),
  forwardReturn20d:    doublePrecision("forward_return_20d"),
  outcomeResolvedAt:   timestamp("outcome_resolved_at", { withTimezone: true }),

  createdAt:           timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uq_signal_snapshot").on(t.ticker, t.snapshotDate),
]);

export type SignalSnapshot       = typeof signalSnapshotsTable.$inferSelect;
export type InsertSignalSnapshot = typeof signalSnapshotsTable.$inferInsert;

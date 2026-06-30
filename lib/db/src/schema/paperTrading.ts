import { pgTable, text, serial, timestamp, doublePrecision, boolean, integer, jsonb, index, uniqueIndex, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const botConfigTable = pgTable("bot_config", {
  id:                  serial("id").primaryKey(),
  name:                text("name").notNull().default("Default Bot"),
  enabled:             boolean("enabled").notNull().default(false),
  entryCriteria:       jsonb("entry_criteria").notNull().default([]),
  maxPositions:        integer("max_positions").notNull().default(5),
  positionSizePct:     doublePrecision("position_size_pct").notNull().default(5.0),
  // Fixed-share sizing for LEARNING mode: when > 0, the bot buys exactly this many
  // shares of each pick (ignoring positionSizePct / virtualPortfolio %) so it can
  // track success/miss across many names with tiny, equal exposure. 0 = use % sizing.
  fixedShares:         integer("fixed_shares").notNull().default(0),
  exitScoreThreshold:  integer("exit_score_threshold").notNull().default(55),
  exitOnDirectionFlip: boolean("exit_on_direction_flip").notNull().default(true),
  maxHoldDays:         integer("max_hold_days").notNull().default(30),
  takeProfitPct:       doublePrecision("take_profit_pct").notNull().default(0),
  stopLossPct:         doublePrecision("stop_loss_pct").notNull().default(0),
  tickerWhitelist:     text("ticker_whitelist").notNull().default(""),
  aiGateEnabled:       boolean("ai_gate_enabled").notNull().default(false),
  virtualPortfolio:    doublePrecision("virtual_portfolio").notNull().default(100000.0),
  updatedAt:           timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertBotConfigSchema = createInsertSchema(botConfigTable).omit({ id: true, updatedAt: true });
export type InsertBotConfig = z.infer<typeof insertBotConfigSchema>;
export type BotConfig = typeof botConfigTable.$inferSelect;

export const paperTradesTable = pgTable("paper_trades", {
  id:                 serial("id").primaryKey(),
  ticker:             text("ticker").notNull(),
  name:               text("name").notNull(),
  entryPrice:         doublePrecision("entry_price").notNull(),
  entryScore:         integer("entry_score").notNull(),
  entryDirection:     text("entry_direction").notNull(),
  entryBullishProb:   doublePrecision("entry_bullish_prob"),
  entryRsi:           doublePrecision("entry_rsi"),
  entryRvol:          doublePrecision("entry_rvol"),
  entryMomentumScore: integer("entry_momentum_score"),
  entryTrendScore:    integer("entry_trend_score"),
  entryCriteria:      jsonb("entry_criteria").notNull().default([]),
  entryPatterns:      jsonb("entry_patterns").notNull().default([]),
  entryAt:            timestamp("entry_at", { withTimezone: true }).notNull().defaultNow(),
  exitPrice:          doublePrecision("exit_price"),
  exitScore:          integer("exit_score"),
  exitReason:         text("exit_reason"),
  exitAt:             timestamp("exit_at", { withTimezone: true }),
  pnlPercent:         doublePrecision("pnl_percent"),
  pnlDollar:          doublePrecision("pnl_dollar"),
  shares:             doublePrecision("shares"),
  positionValue:      doublePrecision("position_value"),
  // Smart entry / adaptive exit fields
  entryTrigger:       text("entry_trigger"),
  atrPctAtEntry:      doublePrecision("atr_pct_at_entry"),
  stopPrice:          doublePrecision("stop_price"),
  targetPrice:        doublePrecision("target_price"),
  trailingStopPrice:  doublePrecision("trailing_stop_price"),
  peakPrice:          doublePrecision("peak_price"),
  // T1/T2/T3 milestones (set at entry, used for stop ratcheting)
  t1Price:            doublePrecision("t1_price"),
  t2Price:            doublePrecision("t2_price"),
  t3Price:            doublePrecision("t3_price"),
  t1Hit:              boolean("t1_hit").notNull().default(false),
  t2Hit:              boolean("t2_hit").notNull().default(false),
  // Intelligence / scanner context
  scannerCategories:  jsonb("scanner_categories").default([]),
  status:             text("status").notNull().default("open"),
  aiNotes:            text("ai_notes"),
  decisionLog:        jsonb("decision_log"),
  createdAt:          timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_paper_trades_status").on(t.status),
  index("idx_paper_trades_ticker").on(t.ticker),
  index("idx_paper_trades_ticker_status").on(t.ticker, t.status),
  index("idx_paper_trades_exit_at").on(t.exitAt),
]);

export const insertPaperTradeSchema = createInsertSchema(paperTradesTable).omit({ id: true, createdAt: true });
export type InsertPaperTrade = z.infer<typeof insertPaperTradeSchema>;
export type PaperTrade = typeof paperTradesTable.$inferSelect;

// ── Bot adaptation log — tracks self-learning threshold changes ────────────────

export const botAdaptationLogTable = pgTable("bot_adaptation_log", {
  id:              serial("id").primaryKey(),
  adaptedAt:       timestamp("adapted_at", { withTimezone: true }).notNull().defaultNow(),
  trigger:         text("trigger").notNull().default("self_learning"),
  oldScoreMin:     doublePrecision("old_score_min").notNull(),
  newScoreMin:     doublePrecision("new_score_min").notNull(),
  actualWinRate:   doublePrecision("actual_win_rate"),
  expectedWinRate: doublePrecision("expected_win_rate"),
  tradesAnalyzed:  integer("trades_analyzed"),
  notes:           text("notes"),
});

export type BotAdaptationLog = typeof botAdaptationLogTable.$inferSelect;

// ── Per-pattern hit rate — persistent self-learning signal ────────────────────
// Updated on every paper trade close via upsert. Enables the bot to de-weight
// patterns with historically poor forward P&L rather than treating all equally.

export const patternPerformanceTable = pgTable("pattern_performance", {
  id:          serial("id").primaryKey(),
  pattern:     text("pattern").notNull(),
  direction:   text("direction").notNull(),   // 'bullish' | 'bearish' | 'neutral'
  horizon:     integer("horizon").notNull().default(5),
  totalTrades: integer("total_trades").notNull().default(0),
  wins:        integer("wins").notNull().default(0),
  losses:      integer("losses").notNull().default(0),
  avgPnlPct:   real("avg_pnl_pct"),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uq_pattern_perf_pattern_dir_horizon").on(t.pattern, t.direction, t.horizon),
  index("idx_pattern_perf_pattern").on(t.pattern),
]);

export type PatternPerformance = typeof patternPerformanceTable.$inferSelect;
export type InsertPatternPerformance = typeof patternPerformanceTable.$inferInsert;

// ── Position flip log — tracks reversal detection events ──────────────────────

export const positionFlipsTable = pgTable("position_flips", {
  id:             serial("id").primaryKey(),
  ticker:         text("ticker").notNull(),
  flipAt:         timestamp("flip_at", { withTimezone: true }).notNull().defaultNow(),
  fromDirection:  text("from_direction").notNull(),  // 'bullish' | 'bearish'
  toDirection:    text("to_direction").notNull(),
  closePrice:     doublePrecision("close_price").notNull(),
  closePnlPct:    doublePrecision("close_pnl_pct"),
  openPrice:      doublePrecision("open_price").notNull(),
  confidence:     integer("confidence").notNull(),
  signalsFired:   jsonb("signals_fired").notNull().default([]),
  reason:         text("reason"),
  fromTradeId:    integer("from_trade_id"),
  toTradeId:      integer("to_trade_id"),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_position_flips_ticker").on(t.ticker),
  index("idx_position_flips_flip_at").on(t.flipAt),
]);

export type PositionFlip = typeof positionFlipsTable.$inferSelect;
export type InsertPositionFlip = typeof positionFlipsTable.$inferInsert;

import { pgTable, text, serial, timestamp, doublePrecision, boolean, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const botConfigTable = pgTable("bot_config", {
  id:                  serial("id").primaryKey(),
  name:                text("name").notNull().default("Default Bot"),
  enabled:             boolean("enabled").notNull().default(false),
  entryCriteria:       jsonb("entry_criteria").notNull().default([]),
  maxPositions:        integer("max_positions").notNull().default(5),
  positionSizePct:     doublePrecision("position_size_pct").notNull().default(5.0),
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
  status:             text("status").notNull().default("open"),
  aiNotes:            text("ai_notes"),
  createdAt:          timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPaperTradeSchema = createInsertSchema(paperTradesTable).omit({ id: true, createdAt: true });
export type InsertPaperTrade = z.infer<typeof insertPaperTradeSchema>;
export type PaperTrade = typeof paperTradesTable.$inferSelect;

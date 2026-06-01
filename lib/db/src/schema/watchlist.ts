import { pgTable, text, serial, timestamp, doublePrecision } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const watchlistTable = pgTable("watchlist", {
  id: serial("id").primaryKey(),
  ticker: text("ticker").notNull().unique(),
  notes: text("notes"),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  // Broker position data (from CSV import)
  description: text("description"),
  quantity: doublePrecision("quantity"),
  costBasisTotal: doublePrecision("cost_basis_total"),
  avgCostBasis: doublePrecision("avg_cost_basis"),
  accountName: text("account_name"),
  todayGainLossDollar: doublePrecision("today_gain_loss_dollar"),
  todayGainLossPercent: doublePrecision("today_gain_loss_percent"),
  totalGainLossDollar: doublePrecision("total_gain_loss_dollar"),
  totalGainLossPercent: doublePrecision("total_gain_loss_percent"),
  percentOfAccount: doublePrecision("percent_of_account"),
});

export const insertWatchlistSchema = createInsertSchema(watchlistTable).omit({ id: true, addedAt: true });
export type InsertWatchlistEntry = z.infer<typeof insertWatchlistSchema>;
export type WatchlistEntry = typeof watchlistTable.$inferSelect;

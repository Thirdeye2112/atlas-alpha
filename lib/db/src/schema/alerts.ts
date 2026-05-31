import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";

export const alertsTable = pgTable("alerts", {
  id:              serial("id").primaryKey(),
  ticker:          text("ticker").notNull(),
  conditionType:   text("condition_type").notNull(), // 'score_above' | 'score_below' | 'direction_change'
  threshold:       integer("threshold"),             // for score_above / score_below
  lastKnownDir:    text("last_known_dir"),            // tracks previous direction for direction_change
  isActive:        boolean("is_active").notNull().default(true),
  lastTriggeredAt: timestamp("last_triggered_at", { withTimezone: true }),
  acknowledgedAt:  timestamp("acknowledged_at",   { withTimezone: true }),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Alert       = typeof alertsTable.$inferSelect;
export type InsertAlert = typeof alertsTable.$inferInsert;

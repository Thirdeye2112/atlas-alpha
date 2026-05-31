import { pgTable, serial, text, real, integer, timestamp } from "drizzle-orm/pg-core";

export const calibrationModelsTable = pgTable("calibration_models", {
  id:           serial("id").primaryKey(),
  ticker:       text("ticker").notNull(),
  horizon:      integer("horizon").notNull(),
  regime:       text("regime").notNull().default("all"),
  scoreVersion: text("score_version").notNull(),
  slope:        real("slope").notNull(),
  intercept:    real("intercept").notNull(),
  observations: integer("observations").notNull(),
  rankIc:       real("rank_ic").notNull(),
  icRating:     text("ic_rating").notNull(),
  logLoss:      real("log_loss"),
  brierScore:   real("brier_score"),
  fittedAt:     timestamp("fitted_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CalibrationModel = typeof calibrationModelsTable.$inferSelect;
export type InsertCalibrationModel = typeof calibrationModelsTable.$inferInsert;

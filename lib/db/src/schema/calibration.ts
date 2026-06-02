import { pgTable, serial, text, real, integer, timestamp, index } from "drizzle-orm/pg-core";

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
}, (t) => [
  // Primary query in initCalibrationFromDB: WHERE scoreVersion = $1 AND regime = 'all' ORDER BY fittedAt DESC
  index("idx_cal_version_regime_fitted").on(t.scoreVersion, t.regime, t.fittedAt),
  // Point lookups by ticker+horizon+scoreVersion when checking for existing fits
  index("idx_cal_ticker_horizon_version").on(t.ticker, t.horizon, t.scoreVersion),
]);

export type CalibrationModel = typeof calibrationModelsTable.$inferSelect;
export type InsertCalibrationModel = typeof calibrationModelsTable.$inferInsert;

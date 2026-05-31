import { db, calibrationModelsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { SCORE_VERSION } from "./scoring.js";
import { logger } from "./logger.js";

export type CalibrationStatus = "none" | "pending" | "cold-start" | "stale-fit" | "live-fit" | "error";

export interface CalibrationEntry {
  ticker: string;
  slope: number;
  intercept: number;
  calibratedProbability: (score: number) => number;
  observations: number;
  horizon: number;
  rankIC: number;
  icRating: string;
  fittedAt: string;
  fitSource: "live" | "db";
}

type StoreValue =
  | { status: "pending" | "error" }
  | ({ status: "live-fit" | "stale-fit" } & CalibrationEntry);

const store = new Map<string, StoreValue>();
let pendingCount = 0;
const MAX_CONCURRENT = 2;

function sigmoid(slope: number, intercept: number, score: number): number {
  const z = Math.max(-15, Math.min(15, slope * score + intercept));
  return Math.round((1 / (1 + Math.exp(-z))) * 100);
}

/** Load calibration rows from DB for the current SCORE_VERSION on server startup. */
export async function initCalibrationFromDB(): Promise<void> {
  try {
    const rows = await db
      .select()
      .from(calibrationModelsTable)
      .where(
        and(
          eq(calibrationModelsTable.scoreVersion, SCORE_VERSION),
          eq(calibrationModelsTable.regime, "all")
        )
      )
      .orderBy(desc(calibrationModelsTable.fittedAt));

    const seen = new Set<string>();
    let loaded = 0;

    for (const row of rows) {
      const key = `${row.ticker}:${row.horizon}`;
      if (seen.has(key)) continue; // take only the most recent per ticker+horizon
      seen.add(key);

      const entry: CalibrationEntry = {
        ticker:     row.ticker,
        slope:      row.slope,
        intercept:  row.intercept,
        calibratedProbability: (score: number) => sigmoid(row.slope, row.intercept, score),
        observations: row.observations,
        horizon:    row.horizon,
        rankIC:     row.rankIc,
        icRating:   row.icRating,
        fittedAt:   row.fittedAt.toISOString(),
        fitSource:  "db",
      };

      store.set(row.ticker, { status: "stale-fit", ...entry });
      loaded++;
    }

    logger.info({ loaded, scoreVersion: SCORE_VERSION }, "Calibration loaded from DB");
  } catch (err) {
    logger.warn({ err }, "Failed to load calibration from DB — cold-start mode");
  }
}

/** Persist a fitted calibration to DB (fire-and-forget, never throws). */
async function persistToDB(entry: CalibrationEntry, brierScore?: number, logLoss?: number): Promise<void> {
  try {
    await db.insert(calibrationModelsTable).values({
      ticker:       entry.ticker,
      horizon:      entry.horizon,
      regime:       "all",
      scoreVersion: SCORE_VERSION,
      slope:        entry.slope,
      intercept:    entry.intercept,
      observations: entry.observations,
      rankIc:       entry.rankIC,
      icRating:     entry.icRating,
      brierScore:   brierScore ?? null,
      logLoss:      logLoss ?? null,
    });
  } catch (err) {
    logger.warn({ err, ticker: entry.ticker }, "Failed to persist calibration to DB");
  }
}

export const calibrationStore = {
  get(ticker: string): StoreValue | undefined {
    return store.get(ticker.toUpperCase());
  },

  set(ticker: string, entry: CalibrationEntry, diagnostics?: { brierScore?: number; logLoss?: number }): void {
    const sym = ticker.toUpperCase();
    const prev = store.get(sym);
    if (prev?.status === "pending") pendingCount = Math.max(0, pendingCount - 1);
    store.set(sym, { status: "live-fit", ...entry, fitSource: "live" });

    // Fire-and-forget DB write
    void persistToDB(entry, diagnostics?.brierScore, diagnostics?.logLoss);
  },

  markPending(ticker: string): boolean {
    const sym = ticker.toUpperCase();
    if (store.has(sym)) return false;
    if (pendingCount >= MAX_CONCURRENT) return false;
    pendingCount++;
    store.set(sym, { status: "pending" });
    return true;
  },

  markError(ticker: string): void {
    const sym = ticker.toUpperCase();
    const prev = store.get(sym);
    if (prev?.status === "pending") pendingCount = Math.max(0, pendingCount - 1);
    store.set(sym, { status: "error" });
  },

  status(ticker: string): CalibrationStatus {
    const entry = store.get(ticker.toUpperCase());
    if (!entry) return "cold-start";
    return entry.status as CalibrationStatus;
  },

  getFitted(ticker: string): CalibrationEntry | null {
    const entry = store.get(ticker.toUpperCase());
    if (entry?.status === "live-fit" || entry?.status === "stale-fit") return entry;
    return null;
  },
};

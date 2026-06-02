import { db, calibrationModelsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { SCORE_VERSION, type WeightOverrides } from "./scoring.js";
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
  optimalWeights?: WeightOverrides | null;
}

type StoreValue =
  | { status: "pending" | "error" }
  | ({ status: "live-fit" | "stale-fit" } & CalibrationEntry);

// Store key format: `${TICKER}:${horizon}` — e.g. "AAPL:10", "TSLA:5"
// Using a composite key prevents horizon=5 and horizon=10 models from
// silently overwriting each other (the original bug: store only keyed by ticker).
const store = new Map<string, StoreValue>();
let pendingCount = 0;
const MAX_CONCURRENT = 2;

function sigmoid(slope: number, intercept: number, score: number): number {
  const z = Math.max(-15, Math.min(15, slope * score + intercept));
  return Math.round((1 / (1 + Math.exp(-z))) * 100);
}

function storeKey(ticker: string, horizon: number): string {
  return `${ticker.toUpperCase()}:${horizon}`;
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
      const key = storeKey(row.ticker, row.horizon);
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

      store.set(key, { status: "stale-fit", ...entry });
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
  /** Look up a store entry by ticker + horizon. */
  get(ticker: string, horizon: number): StoreValue | undefined {
    return store.get(storeKey(ticker, horizon));
  },

  /** Store a fitted calibration. Map key is derived from entry.horizon, so callers
   *  do not need to pass horizon separately — it is part of the CalibrationEntry. */
  set(ticker: string, entry: CalibrationEntry, diagnostics?: { brierScore?: number; logLoss?: number }): void {
    const key = storeKey(ticker, entry.horizon);
    const prev = store.get(key);
    if (prev?.status === "pending") pendingCount = Math.max(0, pendingCount - 1);
    store.set(key, { status: "live-fit", ...entry, fitSource: "live" });
    void persistToDB(entry, diagnostics?.brierScore, diagnostics?.logLoss);
  },

  /** Reserve a calibration slot for a ticker+horizon pair.
   *  Returns false if already tracked (any status) or concurrency limit hit. */
  markPending(ticker: string, horizon: number): boolean {
    const key = storeKey(ticker, horizon);
    if (store.has(key)) return false;
    if (pendingCount >= MAX_CONCURRENT) return false;
    pendingCount++;
    store.set(key, { status: "pending" });
    return true;
  },

  /** Mark a calibration as failed (e.g. insufficient data for the given horizon). */
  markError(ticker: string, horizon: number): void {
    const key = storeKey(ticker, horizon);
    const prev = store.get(key);
    if (prev?.status === "pending") pendingCount = Math.max(0, pendingCount - 1);
    store.set(key, { status: "error" });
  },

  /** Current calibration status for a ticker+horizon pair. */
  status(ticker: string, horizon: number): CalibrationStatus {
    const entry = store.get(storeKey(ticker, horizon));
    if (!entry) return "cold-start";
    return entry.status as CalibrationStatus;
  },

  /** Returns the fitted entry if available (live-fit or stale-fit), otherwise null. */
  getFitted(ticker: string, horizon: number): CalibrationEntry | null {
    const entry = store.get(storeKey(ticker, horizon));
    if (entry?.status === "live-fit" || entry?.status === "stale-fit") return entry;
    return null;
  },
};

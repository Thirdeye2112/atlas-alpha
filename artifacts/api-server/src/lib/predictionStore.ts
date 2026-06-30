// predictionStore.ts
// In-memory cache of the research V4 model's latest predictions (the champion
// return_regressor, trained on all 47 features), keyed by ticker. Loaded from the
// atlas_research DB on startup and refreshed periodically, so calcAtlasScore can
// fuse the ML rank synchronously without a per-ticker DB query in scanner loops.
import { Pool } from "pg";
import { logger } from "./logger.js";

interface PredEntry {
  rankPct: number;       // 0-100 cross-sectional rank (higher = more bullish)
  expectedReturn: number | null;
  date: string;
}

const store = new Map<string, PredEntry>();
let _pool: Pool | null = null;
let _asOf: string | null = null;

function getPool(): Pool | null {
  if (_pool) return _pool;
  const url = process.env["DATABASE_URL_RESEARCH"];
  if (!url) { logger.warn("predictionStore: DATABASE_URL_RESEARCH not set"); return null; }
  _pool = new Pool({ connectionString: url, max: 2 });
  _pool.on("error", (err) => logger.error({ err: err.message }, "predictionStore pool error"));
  return _pool;
}

// Champion ranking = the return_regressor's rank_percentile on the latest scored
// date (matches /api/research/predictions). rank_percentile may be stored 0-1 or
// 0-100; normalised to 0-100 here.
const LOAD_SQL = `
  SELECT ticker, rank_percentile, expected_return, date::text AS date
  FROM predictions
  WHERE model_name = 'return_regressor'
    AND date = (SELECT MAX(date) FROM predictions WHERE model_name = 'return_regressor')
    AND rank_percentile IS NOT NULL
`;

export async function refreshPredictions(): Promise<void> {
  const pool = getPool();
  if (!pool) return;
  try {
    const { rows } = await pool.query(LOAD_SQL);
    const next = new Map<string, PredEntry>();
    for (const r of rows as Array<{ ticker: string; rank_percentile: number; expected_return: number | null; date: string }>) {
      const raw = Number(r.rank_percentile);
      if (!Number.isFinite(raw)) continue;
      const rankPct = raw <= 1 ? raw * 100 : raw;          // normalise 0-1 -> 0-100
      next.set(r.ticker.toUpperCase(), {
        rankPct,
        expectedReturn: r.expected_return != null ? Number(r.expected_return) : null,
        date: r.date,
      });
    }
    store.clear();
    for (const [k, v] of next) store.set(k, v);
    _asOf = rows.length ? (rows[0] as { date: string }).date : null;
    logger.info({ loaded: store.size, asOf: _asOf }, "predictionStore refreshed from research DB");
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "predictionStore refresh failed");
  }
}

/** Initialise on startup and refresh every 6h (predictions update nightly). */
export async function initPredictions(): Promise<void> {
  await refreshPredictions();
  setInterval(() => { void refreshPredictions(); }, 6 * 60 * 60 * 1000).unref?.();
}

export const predictionStore = {
  /** 0-100 ML score for a ticker (rank_percentile), or null if no prediction. */
  getMlScore(ticker: string): number | null {
    const e = store.get(ticker.toUpperCase());
    return e ? e.rankPct : null;
  },
  getEntry(ticker: string): PredEntry | null {
    return store.get(ticker.toUpperCase()) ?? null;
  },
  asOf(): string | null { return _asOf; },
  size(): number { return store.size; },
};

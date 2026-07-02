// confluenceStore.ts
// In-memory cache of the VALIDATED confluence "confidence gate" per ticker, loaded from
// the atlas_research `deep_dive_events` table on startup (mirrors predictionStore). Only
// walk-forward-validated, direction-aligned modalities contribute, and only POSITIVELY —
// a null/absent pattern contributes exactly 0 (never a penalty). See
// atlas-research/reports/CONFLUENCE_CONFIDENCE_PLAN.md and reports/validity/
// {MODALITY_WALKFORWARD,CONFLUENCE_READ_CALIBRATION}.md.
//
// Validation summary: crossing the gate (any validated confluence present) ~doubles the
// 5-day edge (+0.33%->+0.66%) and adds ~3pp hit, holding OOS in 15/15 years. It is used
// ONLY to lift `confidenceScore` in scoring.ts, never the directional `overall`.
import { Pool } from "pg";
import { logger } from "./logger.js";

// Walk-forward OOS 5d edges (%) = the layer weights. 0 = not validated (raw candles etc).
const W_BULL_STRUCT: Record<string, number> = {
  bull_pennant: 0.79, falling_wedge: 0.60, hs_bottom: 0.29, descending_channel_break: 0.22,
};
const W_BEAR_STRUCT: Record<string, number> = {
  bear_pennant: 0.52, hs_top: 0.36, rising_wedge: 0.21, triple_top: 0.18,
};
const W_CANDLE_OVERSOLD = 0.26;   // oversold-gated bullish candle (raw candle = 0)
const OUT_OF_TREND_DAMP = 0.50;   // patterns less reliable when price < EMA200

export interface ConfluenceLayer {
  layer: string; signal: string; dir?: string; weight: number; validated: boolean; note?: string;
}
export interface ConfluenceRead {
  lift: number;          // positive-only long-side confidence lift (regime damp applied in scoring)
  tier: number;          // 0 = no validated signal; >=1 = gate crossed
  layers: ConfluenceLayer[];
  veto: string[];        // validated OPPOSITE-side patterns present (contrary evidence)
  asOf: string;
}

const store = new Map<string, ConfluenceRead>();
let _pool: Pool | null = null;
let _asOf: string | null = null;

function getPool(): Pool | null {
  if (_pool) return _pool;
  const url = process.env["DATABASE_URL_RESEARCH"];
  if (!url) { logger.warn("confluenceStore: DATABASE_URL_RESEARCH not set"); return null; }
  _pool = new Pool({ connectionString: url, max: 2 });
  _pool.on("error", (err) => logger.error({ err: err.message }, "confluenceStore pool error"));
  return _pool;
}

// Latest bar per ticker: the validated structure patterns + candle/oversold/trend context.
const LOAD_SQL = `
  WITH latest AS (SELECT ticker, MAX(ts) AS ts FROM deep_dive_events GROUP BY ticker)
  SELECT d.ticker,
         MAX(d.ts)::text AS ts,
         bool_or(d.above_ema200::int = 1)                         AS above200,
         bool_or(d.mr_oversold::int = 1)                          AS oversold,
         bool_or(d.event_type = 'candlestick')                    AS has_candle,
         array_agg(d.name)      FILTER (WHERE d.event_type='structure') AS structs,
         array_agg(d.direction) FILTER (WHERE d.event_type='structure') AS sdirs
  FROM deep_dive_events d JOIN latest l ON d.ticker = l.ticker AND d.ts = l.ts
  GROUP BY d.ticker
`;

function computeRead(
  structs: string[] | null, sdirs: string[] | null,
  hasCandle: boolean, oversold: boolean, above200: boolean, asOf: string,
): ConfluenceRead {
  const layers: ConfluenceLayer[] = [];
  const veto: string[] = [];
  let lift = 0;
  const names = structs ?? [], dirs = sdirs ?? [];
  for (let i = 0; i < names.length; i++) {
    const name = names[i], dr = dirs[i];
    if (dr === "long" && name in W_BULL_STRUCT) {
      lift += W_BULL_STRUCT[name];
      layers.push({ layer: "L3_structure", signal: name, dir: "long", weight: W_BULL_STRUCT[name], validated: true });
    } else if (dr === "short" && name in W_BEAR_STRUCT) {
      veto.push(name);
      layers.push({ layer: "L3_structure", signal: name, dir: "short", weight: 0, validated: true, note: "contrary evidence (veto)" });
    }
  }
  if (hasCandle) {
    if (oversold) {
      lift += W_CANDLE_OVERSOLD;
      layers.push({ layer: "L0_candle", signal: "bullish_candle_oversold", dir: "long", weight: W_CANDLE_OVERSOLD, validated: true });
    } else {
      layers.push({ layer: "L0_candle", signal: "candle_present", weight: 0, validated: false, note: "raw candle = coin-flip, 0 weight" });
    }
  }
  if (!above200) { lift *= OUT_OF_TREND_DAMP; layers.push({ layer: "L2_trend", signal: "below_ema200", weight: 0, validated: false, note: `out-of-trend x${OUT_OF_TREND_DAMP}` }); }
  else { layers.push({ layer: "L2_trend", signal: "above_ema200", weight: 0, validated: false, note: "in-trend" }); }
  lift = Math.round(lift * 1000) / 1000;
  const tier = lift <= 0 ? 0 : lift < 0.3 ? 1 : lift < 0.6 ? 2 : lift < 1.0 ? 3 : 4;
  return { lift, tier, layers, veto, asOf };
}

export async function refreshConfluence(): Promise<void> {
  const pool = getPool();
  if (!pool) return;
  try {
    const { rows } = await pool.query(LOAD_SQL);
    const next = new Map<string, ConfluenceRead>();
    for (const r of rows as Array<{ ticker: string; ts: string; above200: boolean; oversold: boolean; has_candle: boolean; structs: string[] | null; sdirs: string[] | null }>) {
      next.set(r.ticker.toUpperCase(), computeRead(r.structs, r.sdirs, r.has_candle, r.oversold, r.above200, r.ts));
    }
    store.clear();
    for (const [k, v] of next) store.set(k, v);
    _asOf = rows.length ? (rows[0] as { ts: string }).ts : null;
    logger.info({ loaded: store.size, asOf: _asOf }, "confluenceStore refreshed from research DB");
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "confluenceStore refresh failed");
  }
}

/** Initialise on startup and refresh every 6h (deep_dive_events updates nightly). */
export async function initConfluence(): Promise<void> {
  await refreshConfluence();
  setInterval(() => { void refreshConfluence(); }, 6 * 60 * 60 * 1000).unref?.();
}

export const confluenceStore = {
  /** Validated positive-only confidence lift for a ticker, or null if absent. */
  getLift(ticker: string): number | null {
    const e = store.get(ticker.toUpperCase());
    return e ? e.lift : null;
  },
  getRead(ticker: string): ConfluenceRead | null {
    return store.get(ticker.toUpperCase()) ?? null;
  },
  asOf(): string | null { return _asOf; },
  size(): number { return store.size; },
};

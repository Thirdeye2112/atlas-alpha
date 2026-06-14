/**
 * research-calibration.ts
 * -----------------------
 * Exposes Atlas Alpha calibration results stored in atlas_research DB.
 * Data is written by scripts/run_alpha_calibration.py in atlas-research.
 *
 * All endpoints are read-only. Uses DATABASE_URL_RESEARCH pool.
 *
 * Endpoints:
 *   GET /api/research/calibration/alpha-score
 *     Score bucket calibration (0-20 / 20-40 / 40-60 / 60-80 / 80-100)
 *
 *   GET /api/research/calibration/pattern/:pattern
 *     Single pattern calibration (e.g. "Bull Flag", "Golden Cross")
 *
 *   GET /api/research/calibration/signal/:signal
 *     Any signal key lookup (direction, exhaustion, smart_gate, component)
 *
 *   GET /api/research/calibration/summary
 *     All calibration rows ordered by hit_rate_5d DESC
 *
 *   GET /api/research/calibration/promoted
 *     Only promoted signals
 */

import { Router } from 'express'
import pg from 'pg'

const { Pool } = pg

let _pool: InstanceType<typeof Pool> | null = null

function getPool(): InstanceType<typeof Pool> {
  if (!_pool) {
    const url = process.env.DATABASE_URL_RESEARCH
    if (!url) throw new Error('DATABASE_URL_RESEARCH is not set.')
    _pool = new Pool({
      connectionString: url,
      max: 3,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    })
    _pool.on('error', err => console.error('[calibration] Pool error:', err.message))
  }
  return _pool
}

async function query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
  const client = await getPool().connect()
  try {
    const result = await client.query(sql, params)
    return result.rows as T[]
  } finally {
    client.release()
  }
}

// ---------------------------------------------------------------------------
// Shared column list
// ---------------------------------------------------------------------------

const CAL_COLS = `
  signal_type, signal_key,
  n_signals, n_resolved,
  hit_rate_1d, hit_rate_3d, hit_rate_5d, hit_rate_10d, hit_rate_20d,
  avg_return_1d, avg_return_3d, avg_return_5d, avg_return_10d, avg_return_20d,
  median_return_5d, std_return_5d, avg_drawdown_5d, sharpe_5d,
  year_breakdown, min_n_per_year, year_count,
  sanity_pass, permutation_p_value,
  status, notes, updated_at
`

function formatRow(r: Record<string, unknown>) {
  return {
    signalType:         r.signal_type,
    signalKey:          r.signal_key,
    nSignals:           r.n_signals,
    nResolved:          r.n_resolved,
    hitRates: {
      '1d':  r.hit_rate_1d  != null ? Number(r.hit_rate_1d)  : null,
      '3d':  r.hit_rate_3d  != null ? Number(r.hit_rate_3d)  : null,
      '5d':  r.hit_rate_5d  != null ? Number(r.hit_rate_5d)  : null,
      '10d': r.hit_rate_10d != null ? Number(r.hit_rate_10d) : null,
      '20d': r.hit_rate_20d != null ? Number(r.hit_rate_20d) : null,
    },
    avgReturns: {
      '1d':  r.avg_return_1d  != null ? Number(r.avg_return_1d)  : null,
      '3d':  r.avg_return_3d  != null ? Number(r.avg_return_3d)  : null,
      '5d':  r.avg_return_5d  != null ? Number(r.avg_return_5d)  : null,
      '10d': r.avg_return_10d != null ? Number(r.avg_return_10d) : null,
      '20d': r.avg_return_20d != null ? Number(r.avg_return_20d) : null,
    },
    medianReturn5d:  r.median_return_5d  != null ? Number(r.median_return_5d)  : null,
    stdReturn5d:     r.std_return_5d     != null ? Number(r.std_return_5d)     : null,
    avgDrawdown5d:   r.avg_drawdown_5d   != null ? Number(r.avg_drawdown_5d)   : null,
    sharpe5d:        r.sharpe_5d         != null ? Number(r.sharpe_5d)         : null,
    yearBreakdown:   r.year_breakdown ?? {},
    minNPerYear:     r.min_n_per_year != null ? Number(r.min_n_per_year) : null,
    yearCount:       r.year_count     != null ? Number(r.year_count)     : null,
    sanityPass:      r.sanity_pass,
    permutationPValue: r.permutation_p_value != null ? Number(r.permutation_p_value) : null,
    status:          r.status,
    notes:           r.notes,
    updatedAt:       r.updated_at,
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const calibrationRouter = Router()

/** GET /calibration/alpha-score — score bucket breakdown */
calibrationRouter.get('/calibration/alpha-score', async (_req, res) => {
  try {
    const bucketOrder = ["0-20", "20-40", "40-60", "60-80", "80-100"]
    const rows = await query(`
      SELECT ${CAL_COLS}
      FROM alpha_signal_calibrations
      WHERE signal_type = 'score_bucket'
      ORDER BY calibration_date DESC
    `)

    // Deduplicate: keep most recent row per signal_key
    const seen = new Map<string, Record<string, unknown>>()
    for (const r of rows) {
      if (!seen.has(r.signal_key as string)) seen.set(r.signal_key as string, r)
    }

    const ordered = bucketOrder
      .map(k => seen.get(k))
      .filter(Boolean)
      .map(r => formatRow(r!))

    res.json({ buckets: ordered, count: ordered.length })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(503).json({ error: msg })
  }
})

/** GET /calibration/pattern/:pattern — single pattern lookup */
calibrationRouter.get('/calibration/pattern/:pattern', async (req, res) => {
  try {
    const rows = await query(`
      SELECT ${CAL_COLS}
      FROM alpha_signal_calibrations
      WHERE signal_type = 'pattern'
        AND signal_key  = $1
      ORDER BY calibration_date DESC
      LIMIT 1
    `, [req.params.pattern])

    if (!rows.length) {
      return res.status(404).json({ error: `Pattern '${req.params.pattern}' not found in calibration data.` })
    }
    res.json(formatRow(rows[0]))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(503).json({ error: msg })
  }
})

/** GET /calibration/signal/:signal — any signal key lookup by signal_key */
calibrationRouter.get('/calibration/signal/:signal', async (req, res) => {
  try {
    const rows = await query(`
      SELECT ${CAL_COLS}
      FROM alpha_signal_calibrations
      WHERE signal_key = $1
      ORDER BY calibration_date DESC, signal_type
    `, [req.params.signal])

    if (!rows.length) {
      return res.status(404).json({ error: `Signal '${req.params.signal}' not found in calibration data.` })
    }
    res.json({ results: rows.map(formatRow), count: rows.length })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(503).json({ error: msg })
  }
})

/** GET /calibration/summary — all rows sorted by 5d hit rate */
calibrationRouter.get('/calibration/summary', async (req, res) => {
  try {
    const type = req.query.type as string | undefined
    const rows = await query(`
      SELECT ${CAL_COLS}
      FROM alpha_signal_calibrations
      WHERE ($1::text IS NULL OR signal_type = $1)
      ORDER BY calibration_date DESC, hit_rate_5d DESC NULLS LAST
    `, [type ?? null])

    // Deduplicate by (signal_type, signal_key) — keep most recent
    const seen = new Map<string, Record<string, unknown>>()
    for (const r of rows) {
      const k = `${r.signal_type}::${r.signal_key}`
      if (!seen.has(k)) seen.set(k, r)
    }

    const deduped = Array.from(seen.values()).map(formatRow)
    res.json({ results: deduped, count: deduped.length })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(503).json({ error: msg })
  }
})

/** GET /calibration/promoted — only promoted signals */
calibrationRouter.get('/calibration/promoted', async (_req, res) => {
  try {
    const rows = await query(`
      SELECT ${CAL_COLS}
      FROM alpha_signal_calibrations
      WHERE status = 'promoted'
      ORDER BY calibration_date DESC, hit_rate_5d DESC NULLS LAST
    `)

    // Deduplicate
    const seen = new Map<string, Record<string, unknown>>()
    for (const r of rows) {
      const k = `${r.signal_type}::${r.signal_key}`
      if (!seen.has(k)) seen.set(k, r)
    }

    const deduped = Array.from(seen.values()).map(formatRow)
    res.json({ promoted: deduped, count: deduped.length })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(503).json({ error: msg })
  }
})

/** GET /calibration/snapshots/stats — how many synced snapshots we have */
calibrationRouter.get('/calibration/snapshots/stats', async (_req, res) => {
  try {
    const rows = await query(`
      SELECT
        COUNT(*)::int                                         AS total,
        COUNT(return_5d)::int                                AS with_5d_return,
        MIN(snapshot_date)::text                             AS oldest,
        MAX(snapshot_date)::text                             AS newest,
        COUNT(DISTINCT ticker)::int                          AS tickers,
        ROUND(AVG(CASE WHEN positive_5d THEN 1.0 ELSE 0.0 END)::numeric, 4) AS overall_hit_rate_5d
      FROM alpha_signal_snapshots
    `)
    res.json(rows[0] ?? {})
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(503).json({ error: msg })
  }
})

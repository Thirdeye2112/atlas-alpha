/**
 * research-probability.ts
 * -------------------------
 * Probability engine endpoints backed by atlas_research DB.
 *
 * REGISTRATION (in routes/index.ts):
 *   import { probabilityRouter } from './research-probability.js'
 *   router.use('/research', probabilityRouter)
 *
 * Endpoints
 * ---------
 *   GET /api/research/probability/questions     – research_questions + spec counts
 *   GET /api/research/probability/results       – latest backtest results per spec
 *   GET /api/research/probability/signals       – promoted signals
 */

import { Router } from 'express'
import { Pool } from 'pg'

let _pool: Pool | null = null

function getPool(): Pool {
  if (!_pool) {
    const url = process.env['DATABASE_URL_RESEARCH']
    if (!url) throw new Error('DATABASE_URL_RESEARCH not set')
    _pool = new Pool({ connectionString: url, max: 3 })
    _pool.on('error', (err) => {
      console.error('[research-probability] Pool error:', err.message)
    })
  }
  return _pool
}

async function q<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const client = await getPool().connect()
  try {
    return (await client.query(sql, params)).rows as T[]
  } finally {
    client.release()
  }
}

export const probabilityRouter = Router()

// ---------------------------------------------------------------------------
// GET /api/research/probability/questions
// List all research questions with spec counts and latest run metadata.
// ---------------------------------------------------------------------------
probabilityRouter.get('/probability/questions', async (_req, res) => {
  try {
    const rows = await q(`
      SELECT
        rq.id,
        rq.name,
        rq.description,
        rq.category,
        rq.source,
        rq.created_at,
        COUNT(DISTINCT ts.id)                       AS spec_count,
        MAX(br.run_date)                            AS last_run_date,
        SUM(br.n_events)                            AS total_events,
        SUM(CASE WHEN br.promoted THEN 1 ELSE 0 END) AS promoted_count
      FROM research_questions rq
      LEFT JOIN test_specifications ts ON ts.question_id = rq.id
      LEFT JOIN (
        SELECT DISTINCT ON (spec_id) spec_id, run_date, n_events, promoted
        FROM backtest_runs
        ORDER BY spec_id, run_date DESC, id DESC
      ) br ON br.spec_id = ts.id
      GROUP BY rq.id
      ORDER BY rq.category, rq.name
    `)
    res.json(rows)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ---------------------------------------------------------------------------
// GET /api/research/probability/results
// Latest backtest results per spec, optionally filtered.
//
// Query params:
//   ticker         – filter by ticker (e.g. SPY)
//   condition_type – filter by condition (e.g. down_streak)
//   horizon        – return stats only for this horizon (default: all)
//   promoted_only  – if "true", only promoted runs
//   limit          – max rows (default 100)
// ---------------------------------------------------------------------------
probabilityRouter.get('/probability/results', async (req, res) => {
  try {
    const { ticker, condition_type, horizon, promoted_only, limit = '100' } = req.query as Record<string, string>

    const wheres: string[] = []
    const params: unknown[] = []
    let pi = 1

    if (ticker) {
      wheres.push(`ts.ticker = $${pi++}`)
      params.push(ticker.toUpperCase())
    }
    if (condition_type) {
      wheres.push(`ts.condition_type = $${pi++}`)
      params.push(condition_type)
    }
    if (promoted_only === 'true') {
      wheres.push(`br.promoted = TRUE`)
    }

    const where = wheres.length > 0 ? `WHERE ${wheres.join(' AND ')}` : ''

    // Fetch latest run per spec
    const rows = await q(`
      SELECT
        ts.id                 AS spec_id,
        ts.ticker,
        ts.condition_type,
        ts.params,
        ts.source             AS spec_source,
        rq.name               AS question_name,
        rq.category,
        br.id                 AS run_id,
        br.run_date,
        br.n_events,
        br.data_start,
        br.data_end,
        br.promoted,
        br.promoted_at,
        br.robustness_passed,
        br.robustness_notes,
        COALESCE(
          json_agg(
            json_build_object(
              'horizon',      bres.horizon_days,
              'n',            bres.n,
              'hit_rate',     ROUND(bres.hit_rate::numeric, 4),
              'avg_return',   ROUND(bres.avg_return::numeric, 4),
              'median_return',ROUND(bres.median_return::numeric, 4),
              'p25_return',   ROUND(bres.p25_return::numeric, 4),
              'p75_return',   ROUND(bres.p75_return::numeric, 4),
              'avg_max_runup',ROUND(bres.avg_max_runup::numeric, 4),
              'avg_max_dd',   ROUND(bres.avg_max_dd::numeric, 4)
            ) ORDER BY bres.horizon_days
          ) FILTER (WHERE bres.horizon_days IS NOT NULL),
          '[]'::json
        )                     AS horizons
      FROM test_specifications ts
      LEFT JOIN research_questions rq ON rq.id = ts.question_id
      JOIN LATERAL (
        SELECT * FROM backtest_runs
        WHERE spec_id = ts.id
        ORDER BY run_date DESC, id DESC
        LIMIT 1
      ) br ON TRUE
      LEFT JOIN backtest_results bres ON bres.run_id = br.id
      ${where}
      GROUP BY ts.id, rq.id, br.id,
               br.run_date, br.n_events, br.data_start, br.data_end,
               br.promoted, br.promoted_at, br.robustness_passed, br.robustness_notes
      ORDER BY br.run_date DESC, ts.ticker, ts.condition_type
      LIMIT $${pi}
    `, [...params, parseInt(limit, 10)])

    // Optionally filter horizon in response
    const h = horizon ? parseInt(horizon, 10) : null
    const out = rows.map((row: any) => ({
      ...row,
      params: (() => { try { return JSON.parse(row.params) } catch { return row.params } })(),
      horizons: h != null
        ? (row.horizons as any[]).filter((x: any) => x.horizon === h)
        : row.horizons,
    }))

    res.json(out)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ---------------------------------------------------------------------------
// GET /api/research/probability/signals
// Promoted signals — specs that passed quality gates.
//
// Query params:
//   ticker  – filter by ticker
//   limit   – max rows (default 50)
// ---------------------------------------------------------------------------
probabilityRouter.get('/probability/signals', async (req, res) => {
  try {
    const { ticker, limit = '50' } = req.query as Record<string, string>

    const wheres: string[] = ['br.promoted = TRUE']
    const params: unknown[] = []
    let pi = 1

    if (ticker) {
      wheres.push(`ts.ticker = $${pi++}`)
      params.push(ticker.toUpperCase())
    }

    const where = `WHERE ${wheres.join(' AND ')}`

    const rows = await q(`
      SELECT
        ts.id            AS spec_id,
        ts.ticker,
        ts.condition_type,
        ts.params,
        rq.name          AS question_name,
        br.run_date,
        br.n_events,
        br.promoted_at,
        br.robustness_notes,
        bres5.hit_rate   AS hit_rate_5d,
        bres5.avg_return AS avg_return_5d,
        bres20.hit_rate  AS hit_rate_20d,
        bres20.avg_return AS avg_return_20d
      FROM test_specifications ts
      LEFT JOIN research_questions rq ON rq.id = ts.question_id
      JOIN LATERAL (
        SELECT * FROM backtest_runs
        WHERE spec_id = ts.id AND promoted = TRUE
        ORDER BY run_date DESC, id DESC
        LIMIT 1
      ) br ON TRUE
      LEFT JOIN backtest_results bres5  ON bres5.run_id  = br.id AND bres5.horizon_days  = 5
      LEFT JOIN backtest_results bres20 ON bres20.run_id = br.id AND bres20.horizon_days = 20
      ${where}
      ORDER BY br.promoted_at DESC NULLS LAST, bres5.avg_return DESC NULLS LAST
      LIMIT $${pi}
    `, [...params, parseInt(limit, 10)])

    const out = rows.map((row: any) => ({
      ...row,
      params: (() => { try { return JSON.parse(row.params) } catch { return row.params } })(),
    }))

    res.json(out)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

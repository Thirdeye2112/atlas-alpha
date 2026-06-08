/**
 * research.ts
 * -----------
 * Read-only Research Lab API routes.
 * Connects to the atlas-research PostgreSQL instance (separate from Atlas Alpha's own DB).
 *
 * PLACEMENT: artifacts/api-server/src/routes/research.ts
 *
 * REGISTRATION: In artifacts/api-server/src/index.ts:
 *   import { mlResearchRouter } from './routes/research-ml.js'
 *   app.use('/api/research', mlResearchRouter)
 *
 * ENV VAR REQUIRED:
 *   DATABASE_URL_RESEARCH=postgresql://atlas:password@localhost:5432/atlas_research
 *
 * CHAMPION VIEW (Q1)
 * ------------------
 * model=champion (default) joins return_regressor + positive_classifier predictions
 * on the same (ticker, date), taking the best available signal from each model.
 * Degrades gracefully if only one model type exists.
 *
 * ADVANCED MODEL SELECTOR
 * -----------------------
 * model=champion        — combined view (default)
 * model=return          — return_regressor only
 * model=probability     — positive_classifier only
 * model=drawdown        — expected_drawdown sort
 * model=<any string>    — raw model_name filter
 *
 * All endpoints are read-only. No writes, no training triggers.
 */

import { Router } from 'express'
import { z } from 'zod/v4'
import pg from 'pg'

const { Pool } = pg

// ---------------------------------------------------------------------------
// Research DB connection pool
// ---------------------------------------------------------------------------

let _pool: InstanceType<typeof Pool> | null = null

function getPool(): InstanceType<typeof Pool> {
  if (!_pool) {
    const url = process.env.DATABASE_URL_RESEARCH
    if (!url) throw new Error('DATABASE_URL_RESEARCH is not set.')
    _pool = new Pool({
      connectionString: url,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    })
    _pool.on('error', (err) => {
      console.error('[research] Unexpected DB pool error:', err.message)
    })
  }
  return _pool
}

async function query<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  const client = await getPool().connect()
  try {
    const result = await client.query(sql, params)
    return result.rows as T[]
  } finally {
    client.release()
  }
}

// ---------------------------------------------------------------------------
// Model name resolution
// Q1: 'champion' pseudo-value joins both model types.
// ---------------------------------------------------------------------------

type ModelMode = 'champion' | 'return' | 'probability' | 'drawdown' | string

function resolveModelName(mode: string): { mode: ModelMode; name: string | null } {
  switch (mode) {
    case 'champion':    return { mode: 'champion',    name: null }
    case 'return':      return { mode: 'return',      name: 'return_regressor' }
    case 'probability': return { mode: 'probability', name: 'positive_classifier' }
    case 'drawdown':    return { mode: 'drawdown',    name: 'return_regressor' }
    default:            return { mode: mode,           name: mode }
  }
}

// ---------------------------------------------------------------------------
// Champion JOIN query
// Joins return_regressor + positive_classifier on (ticker, date).
// COALESCE handles the case where only one model has been trained.
// rank_percentile comes from whichever model is available (regressor preferred).
// ---------------------------------------------------------------------------

const CHAMPION_PREDICTIONS_SQL = `
  WITH reg AS (
    SELECT ticker, date, model_version,
           expected_return, probability_positive,
           expected_drawdown, confidence, rank_percentile
    FROM predictions
    WHERE date = $1 AND model_name = 'return_regressor'
  ),
  clf AS (
    SELECT ticker, date,
           probability_positive AS clf_prob,
           confidence           AS clf_conf,
           rank_percentile      AS clf_rank
    FROM predictions
    WHERE date = $1 AND model_name = 'positive_classifier'
  )
  SELECT
    COALESCE(reg.ticker, clf.ticker)        AS ticker,
    $1::text                                AS date,
    'champion'                              AS model_name,
    COALESCE(reg.model_version, 'v1')       AS model_version,
    reg.expected_return,
    COALESCE(clf.clf_prob, reg.probability_positive) AS probability_positive,
    reg.expected_drawdown,
    COALESCE(clf.clf_conf, reg.confidence)  AS confidence,
    COALESCE(reg.rank_percentile, clf.clf_rank) AS rank_percentile
  FROM reg
  FULL OUTER JOIN clf ON reg.ticker = clf.ticker
  WHERE (
    $2::double precision = 0
    OR COALESCE(clf.clf_prob, reg.probability_positive) >= $2
  )
  ORDER BY rank_percentile DESC NULLS LAST
  LIMIT $3
`

const CHAMPION_TICKER_HISTORY_SQL = `
  WITH reg AS (
    SELECT date, model_version, expected_return, probability_positive,
           expected_drawdown, confidence, rank_percentile
    FROM predictions
    WHERE ticker     = $1
      AND model_name = 'return_regressor'
      AND date       >= CURRENT_DATE - INTERVAL '1 day' * $2
  ),
  clf AS (
    SELECT date,
           probability_positive AS clf_prob,
           rank_percentile      AS clf_rank
    FROM predictions
    WHERE ticker     = $1
      AND model_name = 'positive_classifier'
      AND date       >= CURRENT_DATE - INTERVAL '1 day' * $2
  )
  SELECT
    COALESCE(reg.date, clf.date)::text AS date,
    'champion'                          AS model_name,
    COALESCE(reg.model_version, 'v1')  AS model_version,
    reg.expected_return,
    COALESCE(clf.clf_prob, reg.probability_positive) AS probability_positive,
    reg.expected_drawdown,
    reg.confidence,
    COALESCE(reg.rank_percentile, clf.clf_rank) AS rank_percentile
  FROM reg
  FULL OUTER JOIN clf ON reg.date = clf.date
  ORDER BY date DESC
`

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export const PredictionSchema = z.object({
  ticker:               z.string(),
  date:                 z.string(),
  model_name:           z.string(),
  model_version:        z.string(),
  expected_return:      z.number().nullable(),
  probability_positive: z.number().nullable(),
  expected_drawdown:    z.number().nullable(),
  confidence:           z.number().nullable(),
  rank_percentile:      z.number().nullable(),
})
export type Prediction = z.infer<typeof PredictionSchema>

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const mlResearchRouter = Router()

// ---------------------------------------------------------------------------
// GET /api/research/predictions
// Query params:
//   date?     YYYY-MM-DD  (default: most recent)
//   model?    champion | return | probability | drawdown | <model_name>  (default: champion)
//   limit?    integer (default: 200, max: 500)
//   min_prob? 0.0–1.0
// ---------------------------------------------------------------------------
mlResearchRouter.get('/predictions', async (req, res) => {
  try {
    const limitRaw  = Math.min(parseInt(String(req.query.limit ?? 200), 10), 500)
    const modelMode = String(req.query.model ?? 'champion')
    const minProb   = parseFloat(String(req.query.min_prob ?? 0)) || 0
    const { mode, name } = resolveModelName(modelMode)

    // Resolve target date
    let targetDate: string
    if (req.query.date) {
      targetDate = String(req.query.date)
    } else {
      const lookupModel = name ?? 'return_regressor'
      const rows = await query<{ max_date: string }>(
        `SELECT MAX(date)::text AS max_date FROM predictions WHERE model_name = $1`,
        [lookupModel]
      )
      if (!rows[0]?.max_date) {
        res.json({ date: null, model: modelMode, predictions: [], count: 0 })
        return
      }
      targetDate = rows[0].max_date
    }

    let rows: Prediction[]

    if (mode === 'champion') {
      rows = await query<Prediction>(CHAMPION_PREDICTIONS_SQL, [targetDate, minProb, limitRaw])
    } else {
      const orderCol = mode === 'drawdown' ? 'expected_drawdown ASC NULLS LAST' : 'rank_percentile DESC NULLS LAST'
      rows = await query<Prediction>(
        `SELECT
           ticker,
           date::text AS date,
           model_name,
           model_version,
           expected_return,
           probability_positive,
           expected_drawdown,
           confidence,
           rank_percentile
         FROM predictions
         WHERE date       = $1
           AND model_name = $2
           AND (probability_positive IS NULL OR probability_positive >= $3)
         ORDER BY ${orderCol}
         LIMIT $4`,
        [targetDate, name!, isNaN(minProb) ? 0 : minProb, limitRaw]
      )
    }

    res.json({ date: targetDate, model: modelMode, predictions: rows, count: rows.length })
  } catch (err: unknown) {
    req.log?.error({ err }, 'research.predictions failed')
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' })
  }
})

// ---------------------------------------------------------------------------
// GET /api/research/predictions/:ticker
// 90-day history for the sparkline (Q2).
// Returns full time series for lightweight-charts.
// ---------------------------------------------------------------------------
mlResearchRouter.get('/predictions/:ticker', async (req, res) => {
  try {
    const ticker    = req.params.ticker.toUpperCase()
    const modelMode = String(req.query.model ?? 'champion')
    const days      = Math.min(parseInt(String(req.query.days ?? 90), 10), 365)
    const { mode, name } = resolveModelName(modelMode)

    let history: Prediction[]

    if (mode === 'champion') {
      history = await query<Prediction>(CHAMPION_TICKER_HISTORY_SQL, [ticker, days])
    } else {
      history = await query<Prediction>(
        `SELECT
           ticker,
           date::text AS date,
           model_name,
           model_version,
           expected_return,
           probability_positive,
           expected_drawdown,
           confidence,
           rank_percentile
         FROM predictions
         WHERE ticker     = $1
           AND model_name = $2
           AND date       >= CURRENT_DATE - INTERVAL '1 day' * $3
         ORDER BY date DESC`,
        [ticker, name!, days]
      )
    }

    // Latest actual label for context
    const labels = await query<{ return_5d: number | null; positive_5d: boolean | null; date: string }>(
      `SELECT return_5d, positive_5d, date::text FROM labels
       WHERE ticker = $1 ORDER BY date DESC LIMIT 1`,
      [ticker]
    )

    // Lightweight-charts series data (ascending time required by lc)
    // Format: { time: 'YYYY-MM-DD', value: number }
    const probSeries = history
      .filter(p => p.probability_positive != null)
      .map(p => ({ time: p.date, value: +(p.probability_positive! * 100).toFixed(2) }))
      .sort((a, b) => a.time.localeCompare(b.time))

    const returnSeries = history
      .filter(p => p.expected_return != null)
      .map(p => ({ time: p.date, value: +(p.expected_return! * 100).toFixed(3) }))
      .sort((a, b) => a.time.localeCompare(b.time))

    const rankSeries = history
      .filter(p => p.rank_percentile != null)
      .map(p => ({ time: p.date, value: +(p.rank_percentile! * 100).toFixed(1) }))
      .sort((a, b) => a.time.localeCompare(b.time))

    res.json({
      ticker,
      model: modelMode,
      history,
      latestLabel:  labels[0] ?? null,
      count:        history.length,
      // Pre-formatted series data for lightweight-charts
      series: {
        prob:   probSeries,    // P(+) 0–100
        ret:    returnSeries,  // Expected return %
        rank:   rankSeries,    // Rank percentile 0–100
      },
    })
  } catch (err: unknown) {
    req.log?.error({ err }, 'research.predictions.ticker failed')
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' })
  }
})

// ---------------------------------------------------------------------------
// GET /api/research/models/latest
// ---------------------------------------------------------------------------
mlResearchRouter.get('/models/latest', async (req, res) => {
  try {
    const models = await query(
      `SELECT DISTINCT ON (target, horizon)
         id,
         model_name,
         model_version,
         target,
         horizon,
         training_start::text AS training_start,
         training_end::text   AS training_end,
         auc,
         brier,
         ic,
         rank_ic,
         sharpe,
         promoted,
         created_at::text     AS created_at,
         notes
       FROM model_registry
       ORDER BY target, horizon, created_at DESC`
    )

    const folds = await query(
      `SELECT
         model_version,
         target,
         horizon,
         COUNT(*)          AS n_folds,
         AVG(rank_ic)      AS mean_rank_ic,
         STDDEV(rank_ic)   AS std_rank_ic,
         AVG(auc)          AS mean_auc,
         AVG(brier)        AS mean_brier,
         AVG(sharpe)       AS mean_sharpe
       FROM model_registry
       WHERE rank_ic IS NOT NULL
       GROUP BY model_version, target, horizon`
    )

    res.json({ models, foldSummary: folds })
  } catch (err: unknown) {
    req.log?.error({ err }, 'research.models.latest failed')
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' })
  }
})

// ---------------------------------------------------------------------------
// GET /api/research/runs/latest
// ---------------------------------------------------------------------------
mlResearchRouter.get('/runs/latest', async (req, res) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? 20), 10), 100)
    const rows  = await query(
      `SELECT
         id,
         run_type,
         started_at::text  AS started_at,
         finished_at::text AS finished_at,
         status,
         tickers_processed,
         bars_inserted,
         features_generated,
         labels_generated,
         error_message
       FROM research_runs
       ORDER BY started_at DESC
       LIMIT $1`,
      [limit]
    )
    res.json({ runs: rows, count: rows.length })
  } catch (err: unknown) {
    req.log?.error({ err }, 'research.runs.latest failed')
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' })
  }
})

// ---------------------------------------------------------------------------
// GET /api/research/metrics/latest
// Q3: Returns both latest model IC and wf_mean_rank_ic (robustness metric).
// ---------------------------------------------------------------------------
mlResearchRouter.get('/metrics/latest', async (req, res) => {
  try {
    const [coverage] = await query<{
      raw_bars: number; tickers: number; feature_rows: number
      labeled_rows: number; first_bar: string; last_bar: string
      label_coverage_pct: number
    }>(`
      SELECT
        (SELECT COUNT(*)::int          FROM raw_bars)                               AS raw_bars,
        (SELECT COUNT(DISTINCT ticker) FROM raw_bars)                               AS tickers,
        (SELECT COUNT(*)::int          FROM feature_snapshots)                      AS feature_rows,
        (SELECT COUNT(*)::int          FROM labels WHERE return_5d IS NOT NULL)     AS labeled_rows,
        (SELECT MIN(date)::text        FROM raw_bars)                               AS first_bar,
        (SELECT MAX(date)::text        FROM raw_bars)                               AS last_bar,
        ROUND(
          100.0 * (SELECT COUNT(*) FROM labels WHERE return_5d IS NOT NULL)
               / NULLIF((SELECT COUNT(*) FROM labels), 0),
        1) AS label_coverage_pct
    `)

    const [today] = await query<{
      pred_date: string; n_predictions: number
      mean_prob: number | null; pct_bullish: number | null
    }>(`
      SELECT
        date::text AS pred_date,
        COUNT(*)::int AS n_predictions,
        ROUND(AVG(probability_positive)::numeric, 4) AS mean_prob,
        ROUND(100.0 * COUNT(*) FILTER (WHERE probability_positive > 0.5)
              / NULLIF(COUNT(*), 0), 1) AS pct_bullish
      FROM predictions
      WHERE date = (SELECT MAX(date) FROM predictions)
      GROUP BY date
    `)

    const topFeatures = await query<{
      feature_name: string; mean_ic: number; n_folds: number
    }>(`
      SELECT
        feature_name,
        ROUND(AVG(spearman_ic)::numeric, 4) AS mean_ic,
        COUNT(*)::int AS n_folds
      FROM feature_performance
      WHERE target = 'label_return_5d'
      GROUP BY feature_name
      ORDER BY ABS(AVG(spearman_ic)) DESC
      LIMIT 10
    `)

    // Q3: latest model IC + walk-forward mean IC (robustness metric)
    //
    // Source: model_registry.rank_ic (scalar column, one row per fold).
    // Walk-forward writes one model_registry row per fold; rank_ic on each row
    // is that fold's out-of-sample Spearman rank IC on the validation set.
    //
    // wf_mean_rank_ic = AVG(rank_ic) across all rows that share the same
    // (model_version, target, horizon) as the most recently trained model.
    // This is the robustness metric: consistent positive IC across folds is
    // evidence of a real signal, not a single lucky fold.
    //
    // NOT sourced from feature_performance — that table contains per-feature
    // IC diagnostics, not model-level validation performance.
    const [champion] = await query<{
      model_name:      string
      model_version:   string
      target:          string
      horizon:         number | null
      latest_rank_ic:  number | null
      wf_mean_rank_ic: number | null
      wf_std_rank_ic:  number | null
      wf_n_folds:      number | null
      auc:             number | null
      brier:           number | null
      training_end:    string | null
    }>(`
      SELECT
        m.model_name,
        m.model_version,
        m.target,
        m.horizon,
        m.rank_ic                    AS latest_rank_ic,
        wf.mean_rank_ic              AS wf_mean_rank_ic,
        wf.std_rank_ic               AS wf_std_rank_ic,
        wf.n_folds                   AS wf_n_folds,
        m.auc,
        m.brier,
        m.training_end::text         AS training_end
      FROM model_registry m
      LEFT JOIN (
        SELECT
          model_version,
          target,
          horizon,
          AVG(rank_ic)     AS mean_rank_ic,
          STDDEV(rank_ic)  AS std_rank_ic,
          COUNT(*)         AS n_folds
        FROM model_registry
        WHERE rank_ic IS NOT NULL
        GROUP BY model_version, target, horizon
      ) wf
        ON  wf.model_version = m.model_version
        AND wf.target        = m.target
        AND wf.horizon       IS NOT DISTINCT FROM m.horizon
      ORDER BY m.created_at DESC
      LIMIT 1
    `)

    const [lastRun] = await query<{
      run_type: string; status: string
      started_at: string; tickers_processed: number
    }>(`
      SELECT run_type, status, started_at::text AS started_at, tickers_processed
      FROM research_runs
      ORDER BY started_at DESC
      LIMIT 1
    `)

    res.json({
      coverage:    coverage  ?? null,
      today:       today     ?? null,
      champion:    champion  ?? null,
      lastRun:     lastRun   ?? null,
      topFeatures,
      generatedAt: new Date().toISOString(),
    })
  } catch (err: unknown) {
    req.log?.error({ err }, 'research.metrics.latest failed')
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' })
  }
})

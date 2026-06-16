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

// Quality filter: Tier 1-2 only — price > $10 AND avg daily volume > 100k
// over last 60 bars. Excludes micro-cap junk where OMNI cross_up is bearish.
const QUALITY_FILTER_CTE = `
  quality AS (
    SELECT
      rb.ticker,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY rb.adjusted_close) AS med_price,
      AVG(rb.volume) AS avg_vol
    FROM (
      SELECT ticker, adjusted_close, volume,
             ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY date DESC) AS rn
      FROM raw_bars
      WHERE adjusted_close > 0 AND volume > 0
    ) rb
    WHERE rb.rn <= 60
    GROUP BY rb.ticker
    HAVING
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY rb.adjusted_close) > 10
      AND AVG(rb.volume) > 100000
  ),
`

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

// Quality-filtered variant: same as CHAMPION but adds quality CTE and JOIN
// to restrict results to Tier 1-2 tickers (price > $10, avg vol > 100k).
const CHAMPION_PREDICTIONS_QUALITY_SQL = `
  WITH ${QUALITY_FILTER_CTE} reg AS (
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
  INNER JOIN quality ON quality.ticker = COALESCE(reg.ticker, clf.ticker)
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
//   date?           YYYY-MM-DD  (default: most recent)
//   model?          champion | return | probability | drawdown | <model_name>  (default: champion)
//   limit?          integer (default: 200, max: 500)
//   min_prob?       0.0–1.0
//   quality_filter? 1 | true — restrict to Tier 1-2 (price>$10, avg_vol>100k)
// ---------------------------------------------------------------------------
mlResearchRouter.get('/predictions', async (req, res) => {
  try {
    const limitRaw     = Math.min(parseInt(String(req.query.limit ?? 200), 10), 500)
    const modelMode    = String(req.query.model ?? 'champion')
    const minProb      = parseFloat(String(req.query.min_prob ?? 0)) || 0
    const qualityOnly  = req.query.quality_filter === '1' || req.query.quality_filter === 'true'
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
      const sql = qualityOnly ? CHAMPION_PREDICTIONS_QUALITY_SQL : CHAMPION_PREDICTIONS_SQL
      rows = await query<Prediction>(sql, [targetDate, minProb, limitRaw])
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

// ---------------------------------------------------------------------------
// GET /api/research/model-health
// BotLab Learning tab — Model Health, Feature Reliability, Prediction Accuracy,
// Adaptive Confidence.  All data is read-only from the research DB.
// ---------------------------------------------------------------------------
mlResearchRouter.get('/model-health', async (req, res) => {
  try {
    // ── Model Health ──────────────────────────────────────────────────────
    const [champion] = await query<{
      model_version: string; training_end: string | null; created_at: string | null
      rank_ic: number | null; wf_mean_rank_ic: number | null; wf_n_folds: number | null
    }>(`
      SELECT
        m.model_version,
        m.training_end::text  AS training_end,
        m.created_at::text    AS created_at,
        m.rank_ic,
        wf.mean_rank_ic       AS wf_mean_rank_ic,
        wf.n_folds            AS wf_n_folds
      FROM model_registry m
      LEFT JOIN (
        SELECT model_version, AVG(rank_ic) AS mean_rank_ic, COUNT(*) AS n_folds
        FROM model_registry WHERE rank_ic IS NOT NULL
        GROUP BY model_version
      ) wf USING (model_version)
      ORDER BY m.created_at DESC
      LIMIT 1
    `)

    // ── Feature Reliability ───────────────────────────────────────────────
    const reliabilitySummary = await query<{
      ic_trend: string; count: number
    }>(`
      SELECT ic_trend, COUNT(*)::int AS count
      FROM feature_reliability
      WHERE computed_date = (SELECT MAX(computed_date) FROM feature_reliability)
      GROUP BY ic_trend
      ORDER BY count DESC
    `)

    const reliabilityDetail = await query<{
      feature_name: string; ic_trend: string
      ic_30d: number | null; ic_90d: number | null; ic_180d: number | null
      currently_reliable: boolean; declining: boolean; unreliable: boolean
    }>(`
      SELECT
        feature_name, ic_trend,
        ROUND(ic_30d::numeric, 4)  AS ic_30d,
        ROUND(ic_90d::numeric, 4)  AS ic_90d,
        ROUND(ic_180d::numeric, 4) AS ic_180d,
        currently_reliable, declining, unreliable
      FROM feature_reliability
      WHERE computed_date = (SELECT MAX(computed_date) FROM feature_reliability)
      ORDER BY
        CASE ic_trend
          WHEN 'unreliable' THEN 0
          WHEN 'declining'  THEN 1
          WHEN 'stable'     THEN 2
          WHEN 'improving'  THEN 3
          ELSE 4
        END,
        ABS(COALESCE(ic_30d, 0)) DESC
    `)

    const [reliabilityDate] = await query<{ latest_date: string | null }>(`
      SELECT MAX(computed_date)::text AS latest_date FROM feature_reliability
    `)

    // ── Prediction Accuracy — 30d vs 90d ─────────────────────────────────
    const [accuracy] = await query<{
      hr_5d_30d: number | null; hr_5d_90d: number | null
      hr_10d_30d: number | null; hr_10d_90d: number | null
      exp_30d: number | null; exp_90d: number | null
      n_30d: number; n_90d: number
    }>(`
      SELECT
        AVG(direction_correct_5d::int)  FILTER (WHERE prediction_date >= CURRENT_DATE - 30)  AS hr_5d_30d,
        AVG(direction_correct_5d::int)  FILTER (WHERE prediction_date >= CURRENT_DATE - 90)  AS hr_5d_90d,
        AVG(direction_correct_10d::int) FILTER (WHERE prediction_date >= CURRENT_DATE - 30)  AS hr_10d_30d,
        AVG(direction_correct_10d::int) FILTER (WHERE prediction_date >= CURRENT_DATE - 90)  AS hr_10d_90d,
        AVG(actual_return_5d)           FILTER (WHERE prediction_date >= CURRENT_DATE - 30)  AS exp_30d,
        AVG(actual_return_5d)           FILTER (WHERE prediction_date >= CURRENT_DATE - 90)  AS exp_90d,
        COUNT(*)                        FILTER (WHERE prediction_date >= CURRENT_DATE - 30
                                                  AND direction_correct_5d IS NOT NULL)      AS n_30d,
        COUNT(*)                        FILTER (WHERE prediction_date >= CURRENT_DATE - 90
                                                  AND direction_correct_5d IS NOT NULL)      AS n_90d
      FROM prediction_outcomes
    `)

    const bestContexts = await query<{
      label: string; hr_5d: number; n: number
    }>(`
      SELECT
        CASE conviction_level
          WHEN 'VERY_HIGH' THEN 'VERY_HIGH conviction'
          WHEN 'HIGH'      THEN 'HIGH conviction'
          ELSE conviction_level
        END AS label,
        ROUND(AVG(direction_correct_5d::int)::numeric, 3) AS hr_5d,
        COUNT(*)::int AS n
      FROM prediction_outcomes
      WHERE direction_correct_5d IS NOT NULL
        AND conviction_level IS NOT NULL
      GROUP BY conviction_level
      ORDER BY hr_5d DESC
      LIMIT 5
    `)

    const worstContexts = await query<{
      label: string; hr_5d: number; n: number
    }>(`
      SELECT
        'Tier ' || quality_tier AS label,
        ROUND(AVG(direction_correct_5d::int)::numeric, 3) AS hr_5d,
        COUNT(*)::int AS n
      FROM prediction_outcomes
      WHERE direction_correct_5d IS NOT NULL
        AND quality_tier IS NOT NULL
      GROUP BY quality_tier
      ORDER BY hr_5d ASC
      LIMIT 5
    `)

    // ── Adaptive Confidence ───────────────────────────────────────────────
    const [calibStats] = await query<{
      total_outcomes: number
      pct_calibrated: number | null
      avg_raw: number | null
      avg_calibrated: number | null
    }>(`
      SELECT
        COUNT(*)::int AS total_outcomes,
        ROUND(
          100.0 * COUNT(*) FILTER (WHERE calibrated_confidence IS NOT NULL)
          / NULLIF(COUNT(*), 0), 1
        ) AS pct_calibrated,
        ROUND(AVG(confidence)::numeric, 4)              AS avg_raw,
        ROUND(AVG(calibrated_confidence)::numeric, 4)   AS avg_calibrated
      FROM predictions
      WHERE date >= CURRENT_DATE - 90
    `)

    const topBoostContexts = await query<{
      confidence_context: string; avg_mult: number; n: number
    }>(`
      SELECT
        confidence_context,
        ROUND(AVG(calibrated_confidence / NULLIF(raw_confidence, 0))::numeric, 3) AS avg_mult,
        COUNT(*)::int AS n
      FROM predictions
      WHERE raw_confidence > 0
        AND calibrated_confidence IS NOT NULL
        AND date >= CURRENT_DATE - 90
      GROUP BY confidence_context
      HAVING COUNT(*) >= 20
      ORDER BY avg_mult DESC
      LIMIT 5
    `)

    const topPenaltyContexts = await query<{
      confidence_context: string; avg_mult: number; n: number
    }>(`
      SELECT
        confidence_context,
        ROUND(AVG(calibrated_confidence / NULLIF(raw_confidence, 0))::numeric, 3) AS avg_mult,
        COUNT(*)::int AS n
      FROM predictions
      WHERE raw_confidence > 0
        AND calibrated_confidence IS NOT NULL
        AND date >= CURRENT_DATE - 90
      GROUP BY confidence_context
      HAVING COUNT(*) >= 20
      ORDER BY avg_mult ASC
      LIMIT 5
    `)

    // ── Retrain check (latest from step_results if available) ────────────
    const [lastRetrain] = await query<{
      started_at: string; status: string
    }>(`
      SELECT started_at::text, status
      FROM research_runs
      WHERE status != 'running'
      ORDER BY started_at DESC
      LIMIT 1
    `)

    res.json({
      modelHealth: {
        version:          champion?.model_version ?? null,
        lastTrainDate:    champion?.training_end  ?? champion?.created_at ?? null,
        latestFoldIc:     champion?.rank_ic       ?? null,
        wfMeanIc:         champion?.wf_mean_rank_ic ?? null,
        wfFolds:          champion?.wf_n_folds    ?? null,
        // IC trend: improving if recent fold IC > wf mean
        icTrend: champion?.rank_ic != null && champion?.wf_mean_rank_ic != null
          ? (champion.rank_ic > champion.wf_mean_rank_ic + 0.002 ? 'improving'
            : champion.rank_ic < champion.wf_mean_rank_ic - 0.002 ? 'declining'
            : 'stable')
          : null,
      },
      featureReliability: {
        computedDate:    reliabilityDate?.latest_date ?? null,
        summary:         reliabilitySummary,
        features:        reliabilityDetail,
        counts: {
          reliable:    reliabilityDetail.filter(f => f.currently_reliable).length,
          declining:   reliabilityDetail.filter(f => f.declining).length,
          unreliable:  reliabilityDetail.filter(f => f.unreliable).length,
          total:       reliabilityDetail.length,
        },
      },
      predictionAccuracy: {
        hr5d30d:     accuracy?.hr_5d_30d  ?? null,
        hr5d90d:     accuracy?.hr_5d_90d  ?? null,
        hr10d30d:    accuracy?.hr_10d_30d ?? null,
        hr10d90d:    accuracy?.hr_10d_90d ?? null,
        exp30d:      accuracy?.exp_30d    ?? null,
        exp90d:      accuracy?.exp_90d    ?? null,
        n30d:        accuracy?.n_30d      ?? 0,
        n90d:        accuracy?.n_90d      ?? 0,
        bestContexts,
        worstContexts,
        // Known findings surfaced explicitly
        knownFindings: [
          'VERY_HIGH conviction in bear/range regimes: 59–60% HR (best combination)',
          'LOW conviction in bear regime: 39.9% HR (worst combination)',
          'Quality Tier 3/4: 47–48% HR — main accuracy drag (-4 to -5%)',
          'VIX high regime: 49.3% HR — systematic underperformance (-2.7%)',
          'ML rank is stronger for relative ranking (rank_hit=40%) than pure direction',
          'Bear regime alone outperforms bull (54% vs 52%) — contrarian signal quality',
        ],
      },
      adaptiveConfidence: {
        totalOutcomes:      calibStats?.total_outcomes   ?? 0,
        pctCalibrated:      calibStats?.pct_calibrated   ?? null,
        avgRawConfidence:   calibStats?.avg_raw          ?? null,
        avgCalibConfidence: calibStats?.avg_calibrated   ?? null,
        topBoostContexts,
        topPenaltyContexts,
      },
      generatedAt: new Date().toISOString(),
    })
  } catch (err: unknown) {
    req.log?.error({ err }, 'research.model-health failed')
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' })
  }
})

// ---------------------------------------------------------------------------
// GET /api/research/trade-attribution
// BotLab Learning tab — Trade Attribution section.
// Reads from trade_attribution table (populated by reconstruct_trades.py).
// ---------------------------------------------------------------------------
mlResearchRouter.get('/trade-attribution', async (req, res) => {
  try {
    // ── Overall metrics ────────────────────────────────────────────────────
    const [overall] = await query<{
      n: number; win_rate: number; expectancy: number;
      profit_factor: number; avg_winner: number; avg_loser: number;
      avg_mfe: number; avg_mae: number;
      stop_rate: number; t1_rate: number; t2_rate: number; t3_rate: number;
      signal_flip_rate: number; min_date: string; max_date: string;
    }>(`
      SELECT
        COUNT(*)                                           AS n,
        ROUND(AVG((return_pct > 0)::int)::numeric, 4)    AS win_rate,
        ROUND(AVG(return_pct)::numeric, 4)                AS expectancy,
        ROUND(
          SUM(CASE WHEN return_pct > 0 THEN return_pct ELSE 0 END) /
          NULLIF(SUM(CASE WHEN return_pct < 0 THEN ABS(return_pct) ELSE 0 END), 0)::numeric, 4
        )                                                  AS profit_factor,
        ROUND(AVG(return_pct) FILTER (WHERE return_pct > 0)::numeric, 4) AS avg_winner,
        ROUND(AVG(return_pct) FILTER (WHERE return_pct < 0)::numeric, 4) AS avg_loser,
        ROUND(AVG(max_favorable_excursion)::numeric, 4)   AS avg_mfe,
        ROUND(AVG(max_adverse_excursion)::numeric, 4)     AS avg_mae,
        ROUND(AVG(stop_hit::int)::numeric, 4)             AS stop_rate,
        ROUND(AVG(target1_hit::int)::numeric, 4)          AS t1_rate,
        ROUND(AVG(target2_hit::int)::numeric, 4)          AS t2_rate,
        ROUND(AVG(target3_hit::int)::numeric, 4)          AS t3_rate,
        ROUND(AVG(signal_flip_exit::int)::numeric, 4)     AS signal_flip_rate,
        MIN(entry_date)::text                             AS min_date,
        MAX(entry_date)::text                             AS max_date
      FROM trade_attribution
      WHERE return_pct IS NOT NULL
    `)

    // ── Best contexts by expectancy ────────────────────────────────────────
    const bestContexts = await query<{
      label: string; n: number; win_rate: number; expectancy: number; profit_factor: number
    }>(`
      SELECT label, n, win_rate, expectancy, profit_factor FROM (
        -- By conviction
        SELECT
          'VERY_HIGH conviction'       AS label,
          COUNT(*)::int                AS n,
          ROUND(AVG((return_pct>0)::int)::numeric*100,1) AS win_rate,
          ROUND(AVG(return_pct)::numeric,3)              AS expectancy,
          ROUND(SUM(CASE WHEN return_pct>0 THEN return_pct ELSE 0 END)/
            NULLIF(SUM(CASE WHEN return_pct<0 THEN ABS(return_pct) ELSE 0 END),0)::numeric,3) AS profit_factor
        FROM trade_attribution WHERE return_pct IS NOT NULL AND conviction_level='VERY_HIGH'
        UNION ALL
        SELECT 'Jarvis green + Tier 1' AS label, COUNT(*)::int,
          ROUND(AVG((return_pct>0)::int)::numeric*100,1),
          ROUND(AVG(return_pct)::numeric,3),
          ROUND(SUM(CASE WHEN return_pct>0 THEN return_pct ELSE 0 END)/
            NULLIF(SUM(CASE WHEN return_pct<0 THEN ABS(return_pct) ELSE 0 END),0)::numeric,3)
        FROM trade_attribution WHERE return_pct IS NOT NULL AND jarvis_green AND quality_tier=1
        UNION ALL
        SELECT 'Bull + VERY_HIGH' AS label, COUNT(*)::int,
          ROUND(AVG((return_pct>0)::int)::numeric*100,1),
          ROUND(AVG(return_pct)::numeric,3),
          ROUND(SUM(CASE WHEN return_pct>0 THEN return_pct ELSE 0 END)/
            NULLIF(SUM(CASE WHEN return_pct<0 THEN ABS(return_pct) ELSE 0 END),0)::numeric,3)
        FROM trade_attribution WHERE return_pct IS NOT NULL AND sector_regime='bull' AND conviction_level='VERY_HIGH'
        UNION ALL
        SELECT 'VIX low + Jarvis green' AS label, COUNT(*)::int,
          ROUND(AVG((return_pct>0)::int)::numeric*100,1),
          ROUND(AVG(return_pct)::numeric,3),
          ROUND(SUM(CASE WHEN return_pct>0 THEN return_pct ELSE 0 END)/
            NULLIF(SUM(CASE WHEN return_pct<0 THEN ABS(return_pct) ELSE 0 END),0)::numeric,3)
        FROM trade_attribution WHERE return_pct IS NOT NULL AND vix_regime='low' AND jarvis_green
        UNION ALL
        SELECT 'Tier 1 + ML high (>0.7)' AS label, COUNT(*)::int,
          ROUND(AVG((return_pct>0)::int)::numeric*100,1),
          ROUND(AVG(return_pct)::numeric,3),
          ROUND(SUM(CASE WHEN return_pct>0 THEN return_pct ELSE 0 END)/
            NULLIF(SUM(CASE WHEN return_pct<0 THEN ABS(return_pct) ELSE 0 END),0)::numeric,3)
        FROM trade_attribution WHERE return_pct IS NOT NULL AND quality_tier=1 AND ml_signal_strength>=0.7
      ) sub
      WHERE n >= 20
      ORDER BY expectancy DESC
      LIMIT 10
    `)

    // ── Worst contexts ─────────────────────────────────────────────────────
    const worstContexts = await query<{
      label: string; n: number; win_rate: number; expectancy: number; profit_factor: number
    }>(`
      SELECT label, n, win_rate, expectancy, profit_factor FROM (
        SELECT 'LOW conviction' AS label, COUNT(*)::int,
          ROUND(AVG((return_pct>0)::int)::numeric*100,1),
          ROUND(AVG(return_pct)::numeric,3),
          ROUND(SUM(CASE WHEN return_pct>0 THEN return_pct ELSE 0 END)/
            NULLIF(SUM(CASE WHEN return_pct<0 THEN ABS(return_pct) ELSE 0 END),0)::numeric,3) AS profit_factor
        FROM trade_attribution WHERE return_pct IS NOT NULL AND conviction_level='LOW'
        UNION ALL
        SELECT 'Tier 4 + Bear' AS label, COUNT(*)::int,
          ROUND(AVG((return_pct>0)::int)::numeric*100,1),
          ROUND(AVG(return_pct)::numeric,3),
          ROUND(SUM(CASE WHEN return_pct>0 THEN return_pct ELSE 0 END)/
            NULLIF(SUM(CASE WHEN return_pct<0 THEN ABS(return_pct) ELSE 0 END),0)::numeric,3)
        FROM trade_attribution WHERE return_pct IS NOT NULL AND quality_tier=4 AND sector_regime='bear'
        UNION ALL
        SELECT 'VIX high' AS label, COUNT(*)::int,
          ROUND(AVG((return_pct>0)::int)::numeric*100,1),
          ROUND(AVG(return_pct)::numeric,3),
          ROUND(SUM(CASE WHEN return_pct>0 THEN return_pct ELSE 0 END)/
            NULLIF(SUM(CASE WHEN return_pct<0 THEN ABS(return_pct) ELSE 0 END),0)::numeric,3)
        FROM trade_attribution WHERE return_pct IS NOT NULL AND vix_regime='high'
        UNION ALL
        SELECT 'Bear + Jarvis red' AS label, COUNT(*)::int,
          ROUND(AVG((return_pct>0)::int)::numeric*100,1),
          ROUND(AVG(return_pct)::numeric,3),
          ROUND(SUM(CASE WHEN return_pct>0 THEN return_pct ELSE 0 END)/
            NULLIF(SUM(CASE WHEN return_pct<0 THEN ABS(return_pct) ELSE 0 END),0)::numeric,3)
        FROM trade_attribution WHERE return_pct IS NOT NULL AND sector_regime='bear' AND jarvis_green=false
        UNION ALL
        SELECT 'Tier 3 or 4 (all)' AS label, COUNT(*)::int,
          ROUND(AVG((return_pct>0)::int)::numeric*100,1),
          ROUND(AVG(return_pct)::numeric,3),
          ROUND(SUM(CASE WHEN return_pct>0 THEN return_pct ELSE 0 END)/
            NULLIF(SUM(CASE WHEN return_pct<0 THEN ABS(return_pct) ELSE 0 END),0)::numeric,3)
        FROM trade_attribution WHERE return_pct IS NOT NULL AND quality_tier IN (3,4)
      ) sub
      WHERE n >= 20
      ORDER BY expectancy ASC
      LIMIT 10
    `)

    // ── Hold period comparison ─────────────────────────────────────────────
    const holdComparison = await query<{
      hold: string; n: number; win_rate: number; expectancy: number; profit_factor: number
    }>(`
      SELECT * FROM (
        SELECT '5d'::text AS hold, COUNT(*)::int AS n,
          ROUND(AVG((return_pct>0)::int)::numeric*100,1) AS win_rate,
          ROUND(AVG(return_pct)::numeric,3)              AS expectancy,
          ROUND(SUM(CASE WHEN return_pct>0 THEN return_pct ELSE 0 END)/
            NULLIF(SUM(CASE WHEN return_pct<0 THEN ABS(return_pct) ELSE 0 END),0)::numeric,3) AS profit_factor
        FROM trade_attribution WHERE return_pct IS NOT NULL
        UNION ALL
        SELECT '10d', COUNT(*)::int,
          ROUND(AVG((return_pct_10d>0)::int)::numeric*100,1),
          ROUND(AVG(return_pct_10d)::numeric,3),
          ROUND(SUM(CASE WHEN return_pct_10d>0 THEN return_pct_10d ELSE 0 END)/
            NULLIF(SUM(CASE WHEN return_pct_10d<0 THEN ABS(return_pct_10d) ELSE 0 END),0)::numeric,3)
        FROM trade_attribution WHERE return_pct_10d IS NOT NULL
        UNION ALL
        SELECT '20d', COUNT(*)::int,
          ROUND(AVG((return_pct_20d>0)::int)::numeric*100,1),
          ROUND(AVG(return_pct_20d)::numeric,3),
          ROUND(SUM(CASE WHEN return_pct_20d>0 THEN return_pct_20d ELSE 0 END)/
            NULLIF(SUM(CASE WHEN return_pct_20d<0 THEN ABS(return_pct_20d) ELSE 0 END),0)::numeric,3)
        FROM trade_attribution WHERE return_pct_20d IS NOT NULL
      ) h
      ORDER BY ARRAY_POSITION(ARRAY['5d','10d','20d'], hold)
    `)

    // ── Top 10 / Bottom 10 combinations ───────────────────────────────────
    const topCombinations = await query<{
      combination: string; n: number; win_rate: number; expectancy: number; profit_factor: number
    }>(`
      SELECT combination, n, win_rate, expectancy, profit_factor FROM (
        SELECT
          conviction_level || ' + ' || sector_regime AS combination,
          COUNT(*)::int                               AS n,
          ROUND(AVG((return_pct>0)::int)::numeric*100,1) AS win_rate,
          ROUND(AVG(return_pct)::numeric,3)               AS expectancy,
          ROUND(SUM(CASE WHEN return_pct>0 THEN return_pct ELSE 0 END)/
            NULLIF(SUM(CASE WHEN return_pct<0 THEN ABS(return_pct) ELSE 0 END),0)::numeric,3) AS profit_factor
        FROM trade_attribution
        WHERE return_pct IS NOT NULL
          AND conviction_level IS NOT NULL AND sector_regime IS NOT NULL
        GROUP BY conviction_level, sector_regime
        HAVING COUNT(*) >= 20
      ) sub
      ORDER BY expectancy DESC
      LIMIT 10
    `)

    const bottomCombinations = await query<{
      combination: string; n: number; win_rate: number; expectancy: number; profit_factor: number
    }>(`
      SELECT combination, n, win_rate, expectancy, profit_factor FROM (
        SELECT
          conviction_level || ' + ' || sector_regime AS combination,
          COUNT(*)::int                               AS n,
          ROUND(AVG((return_pct>0)::int)::numeric*100,1) AS win_rate,
          ROUND(AVG(return_pct)::numeric,3)               AS expectancy,
          ROUND(SUM(CASE WHEN return_pct>0 THEN return_pct ELSE 0 END)/
            NULLIF(SUM(CASE WHEN return_pct<0 THEN ABS(return_pct) ELSE 0 END),0)::numeric,3) AS profit_factor
        FROM trade_attribution
        WHERE return_pct IS NOT NULL
          AND conviction_level IS NOT NULL AND sector_regime IS NOT NULL
        GROUP BY conviction_level, sector_regime
        HAVING COUNT(*) >= 20
      ) sub
      ORDER BY expectancy ASC
      LIMIT 10
    `)

    res.json({
      overall: {
        n:               overall?.n            ?? 0,
        winRate:         overall?.win_rate      ?? null,
        expectancy:      overall?.expectancy    ?? null,
        profitFactor:    overall?.profit_factor ?? null,
        avgWinner:       overall?.avg_winner    ?? null,
        avgLoser:        overall?.avg_loser     ?? null,
        avgMfe:          overall?.avg_mfe       ?? null,
        avgMae:          overall?.avg_mae       ?? null,
        stopRate:        overall?.stop_rate     ?? null,
        t1Rate:          overall?.t1_rate       ?? null,
        t2Rate:          overall?.t2_rate       ?? null,
        t3Rate:          overall?.t3_rate       ?? null,
        signalFlipRate:  overall?.signal_flip_rate ?? null,
        dateRange:       overall?.n ? `${overall.min_date} → ${overall.max_date}` : null,
      },
      bestContexts,
      worstContexts,
      holdComparison,
      topCombinations,
      bottomCombinations,
      generatedAt: new Date().toISOString(),
    })
  } catch (err: unknown) {
    req.log?.error({ err }, 'research.trade-attribution failed')
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' })
  }
})

// ---------------------------------------------------------------------------
// GET /api/research/meta-signal-health
// BotLab Learning tab — Meta Signal Health display.
// Returns latest signal_combination_scores summary + today's tagged predictions.
// ---------------------------------------------------------------------------
mlResearchRouter.get('/meta-signal-health', async (req, res) => {
  try {
    // ── Status summary from latest combo scores ───────────────────────────
    const [latestDate] = await query<{ latest_date: string | null }>(`
      SELECT MAX(scored_date)::text AS latest_date
      FROM signal_combination_scores
    `)

    const statusSummary = await query<{
      status: string; count: number; avg_meta_score: number | null
      avg_pf_60d: number | null; avg_expectancy_60d: number | null; total_n_60d: number
    }>(`
      SELECT
        status,
        COUNT(*)::int                               AS count,
        ROUND(AVG(meta_score)::numeric, 1)          AS avg_meta_score,
        ROUND(AVG(pf_60d)::numeric, 3)              AS avg_pf_60d,
        ROUND(AVG(expectancy_60d)::numeric, 4)      AS avg_expectancy_60d,
        SUM(COALESCE(n_60d, 0))::int                AS total_n_60d
      FROM signal_combination_scores
      WHERE scored_date = (SELECT MAX(scored_date) FROM signal_combination_scores)
      GROUP BY status
      ORDER BY
        CASE status
          WHEN 'PROMOTED'    THEN 1
          WHEN 'CANDIDATE'   THEN 2
          WHEN 'REJECTED'    THEN 3
          WHEN 'INSUFFICIENT' THEN 4
          ELSE 5
        END
    `)

    // ── Top PROMOTED combos ───────────────────────────────────────────────
    const topPromoted = await query<{
      combo_key: string; meta_score: number | null
      conviction_level: string | null; sector_regime: string | null; vix_regime: string | null
      quality_tier: number | null; ml_rank_bucket: string | null
      confluence_bucket: string | null; jarvis_state: string | null
      n_60d: number | null; pf_60d: number | null
      expectancy_60d: number | null; win_rate_60d: number | null
    }>(`
      SELECT
        combo_key, meta_score,
        conviction_level, sector_regime, vix_regime,
        quality_tier, ml_rank_bucket, confluence_bucket, jarvis_state,
        n_60d,
        ROUND(pf_60d::numeric, 3)         AS pf_60d,
        ROUND(expectancy_60d::numeric, 4)  AS expectancy_60d,
        ROUND(win_rate_60d::numeric, 3)    AS win_rate_60d
      FROM signal_combination_scores
      WHERE scored_date = (SELECT MAX(scored_date) FROM signal_combination_scores)
        AND status = 'PROMOTED'
      ORDER BY meta_score DESC NULLS LAST
      LIMIT 15
    `)

    // ── Today's predictions with meta scores ──────────────────────────────
    const todayTagged = await query<{
      ticker: string; combo_key: string | null; meta_score: number | null
      combo_status: string | null; combo_pf_60d: number | null
      combo_expectancy_60d: number | null; combo_sample_size: number | null
      rank_percentile: number | null; probability_positive: number | null
    }>(`
      SELECT
        ticker,
        combo_key,
        ROUND(meta_score::numeric, 1)         AS meta_score,
        combo_status,
        ROUND(combo_pf_60d::numeric, 3)       AS combo_pf_60d,
        ROUND(combo_expectancy_60d::numeric, 4) AS combo_expectancy_60d,
        combo_sample_size,
        ROUND(rank_percentile::numeric, 3)    AS rank_percentile,
        ROUND(probability_positive::numeric, 4) AS probability_positive
      FROM predictions
      WHERE date = (SELECT MAX(date) FROM predictions)
        AND combo_key IS NOT NULL
      ORDER BY meta_score DESC NULLS LAST
      LIMIT 50
    `)

    const [tagStats] = await query<{
      total_today: number; tagged: number; pct_tagged: number | null
      promoted_today: number; candidate_today: number; rejected_today: number
    }>(`
      SELECT
        COUNT(*)::int                                                       AS total_today,
        COUNT(*) FILTER (WHERE combo_key IS NOT NULL)::int                  AS tagged,
        ROUND(
          100.0 * COUNT(*) FILTER (WHERE combo_key IS NOT NULL)
          / NULLIF(COUNT(*), 0), 1
        )                                                                    AS pct_tagged,
        COUNT(*) FILTER (WHERE combo_status = 'PROMOTED')::int              AS promoted_today,
        COUNT(*) FILTER (WHERE combo_status = 'CANDIDATE')::int             AS candidate_today,
        COUNT(*) FILTER (WHERE combo_status = 'REJECTED')::int              AS rejected_today
      FROM predictions
      WHERE date = (SELECT MAX(date) FROM predictions)
    `)

    // ── Combo PF trend (last 30 scored dates for PROMOTED) ───────────────
    const pfTrend = await query<{
      scored_date: string; n_promoted: number; avg_pf_60d: number | null
      avg_expectancy_60d: number | null; avg_meta_score: number | null
    }>(`
      SELECT
        scored_date::text                           AS scored_date,
        COUNT(*) FILTER (WHERE status = 'PROMOTED')::int AS n_promoted,
        ROUND(AVG(pf_60d) FILTER (WHERE status = 'PROMOTED')::numeric, 3) AS avg_pf_60d,
        ROUND(AVG(expectancy_60d) FILTER (WHERE status = 'PROMOTED')::numeric, 4) AS avg_expectancy_60d,
        ROUND(AVG(meta_score) FILTER (WHERE status = 'PROMOTED')::numeric, 1) AS avg_meta_score
      FROM signal_combination_scores
      GROUP BY scored_date
      ORDER BY scored_date DESC
      LIMIT 30
    `)

    res.json({
      scoredDate:    latestDate?.latest_date ?? null,
      statusSummary,
      topPromoted,
      todayTagged,
      tagStats: tagStats ?? {
        total_today: 0, tagged: 0, pct_tagged: null,
        promoted_today: 0, candidate_today: 0, rejected_today: 0
      },
      pfTrend: pfTrend.reverse(),
      generatedAt: new Date().toISOString(),
    })
  } catch (err: unknown) {
    req.log?.error({ err }, 'research.meta-signal-health failed')
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' })
  }
})

// ---------------------------------------------------------------------------
// GET /api/research/intraday-learning-status
// Returns intraday 5-min learning engine collection progress and candidates.
// ---------------------------------------------------------------------------

mlResearchRouter.get('/intraday-learning-status', async (req, res) => {
  const pool = getPool()
  const query = async <T>(sql: string, params: unknown[] = []): Promise<T[]> => {
    const result = await pool.query(sql, params)
    return result.rows as T[]
  }

  try {
    // Bar coverage
    const barSummary = await query<{
      ticker_count: number; total_bars: number
      earliest_ts: string | null; latest_ts: string | null
      avg_trading_days: number
    }>(`
      SELECT
        COUNT(DISTINCT ticker)::int      AS ticker_count,
        COUNT(*)::int                    AS total_bars,
        MIN(ts)::text                    AS earliest_ts,
        MAX(ts)::text                    AS latest_ts,
        ROUND(AVG(trading_days))::int    AS avg_trading_days
      FROM (
        SELECT ticker, COUNT(DISTINCT ts::date) AS trading_days
        FROM intraday_bars WHERE timeframe = '5m'
        GROUP BY ticker
      ) sub
    `)

    // Stale ticker check (no bars in last 3 calendar days)
    const staleTickers = await query<{ ticker: string; days_ago: number }>(`
      SELECT ticker, EXTRACT(DAY FROM NOW() - MAX(ts))::int AS days_ago
      FROM intraday_bars
      WHERE timeframe = '5m'
      GROUP BY ticker
      HAVING MAX(ts) < NOW() - INTERVAL '3 days'
      ORDER BY days_ago DESC
    `)

    // Setup totals
    const setupTotals = await query<{ total_setups: number; setup_types: number; with_daily_ctx: number }>(`
      SELECT
        COUNT(*)::int                                         AS total_setups,
        COUNT(DISTINCT setup_type)::int                       AS setup_types,
        COUNT(DISTINCT ticker) FILTER (WHERE daily_conviction IS NOT NULL)::int AS with_daily_ctx
      FROM intraday_setups
    `)

    // Outcome totals
    const outcomeTotals = await query<{ total_outcomes: number }>(`
      SELECT COUNT(*)::int AS total_outcomes FROM intraday_outcomes
    `)

    // Candidate status breakdown (latest date)
    const candidateStatus = await query<{ status: string; n: number }>(`
      SELECT status, COUNT(*)::int AS n
      FROM intraday_candidate_setups
      WHERE as_of_date = (SELECT MAX(as_of_date) FROM intraday_candidate_setups)
      GROUP BY status
      ORDER BY status
    `).catch(() => [] as { status: string; n: number }[])

    // Top candidates
    const topCandidates = await query<{
      setup_type: string; direction: string; sample_size: number
      expectancy: number | null; profit_factor: number | null
      oos_sample_size: number; oos_expectancy: number | null; oos_profit_factor: number | null
      best_context_label: string | null; best_context_exp: number | null
      days_collected: number; status: string; notes: string | null
    }>(`
      SELECT setup_type, direction, sample_size, expectancy, profit_factor,
             oos_sample_size, oos_expectancy, oos_profit_factor,
             best_context_label, best_context_exp, days_collected, status, notes
      FROM intraday_candidate_setups
      WHERE as_of_date = (SELECT MAX(as_of_date) FROM intraday_candidate_setups)
        AND status IN ('candidate', 'promoted')
      ORDER BY oos_expectancy DESC NULLS LAST
      LIMIT 10
    `).catch(() => [])

    // All setups for collecting view (top by IS expectancy)
    const collectingTop = await query<{
      setup_type: string; direction: string; sample_size: number
      expectancy: number | null; profit_factor: number | null; status: string; days_collected: number
    }>(`
      SELECT setup_type, direction, sample_size, expectancy, profit_factor, status, days_collected
      FROM intraday_candidate_setups
      WHERE as_of_date = (SELECT MAX(as_of_date) FROM intraday_candidate_setups)
      ORDER BY expectancy DESC NULLS LAST
      LIMIT 15
    `).catch(() => [])

    // Progress estimate
    const avgDays = barSummary[0]?.avg_trading_days ?? 0
    const MIN_DAYS_FOR_PROMOTION = 90
    const daysRemaining = Math.max(0, MIN_DAYS_FOR_PROMOTION - avgDays)
    const pctComplete = Math.min(100, Math.round((avgDays / MIN_DAYS_FOR_PROMOTION) * 100))

    // Promoted setups
    const promotedSetups = await query<{
      setup_type: string; direction: string; oos_expectancy: number | null
      oos_profit_factor: number | null; scored_date: string
    }>(`
      SELECT setup_type, direction, oos_expectancy, oos_profit_factor, scored_date::text
      FROM intraday_promoted_setups
      WHERE promoted = true
      ORDER BY oos_expectancy DESC NULLS LAST
      LIMIT 10
    `).catch(() => [])

    res.json({
      collectionStatus: {
        daysCollected:      avgDays,
        daysRemaining,
        pctComplete,
        tickerCount:        barSummary[0]?.ticker_count ?? 0,
        totalBars:          barSummary[0]?.total_bars ?? 0,
        earliestTs:         barSummary[0]?.earliest_ts ?? null,
        latestTs:           barSummary[0]?.latest_ts ?? null,
        staleTickers:       staleTickers.map(r => r.ticker),
      },
      setupStats: {
        totalSetups:    setupTotals[0]?.total_setups ?? 0,
        setupTypes:     setupTotals[0]?.setup_types ?? 0,
        withDailyCtx:   setupTotals[0]?.with_daily_ctx ?? 0,
        totalOutcomes:  outcomeTotals[0]?.total_outcomes ?? 0,
      },
      candidateStatus,
      topCandidates,
      collectingTop,
      promotedSetups,
      generatedAt: new Date().toISOString(),
    })
  } catch (err: unknown) {
    req.log?.error({ err }, 'research.intraday-learning-status failed')
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' })
  }
})

// GET /api/research/intraday/similarity/:ticker
// Returns the pre-computed similarity result for a ticker's latest candle,
// enriched with today's active market behaviors and their directional impact.
// Updated nightly by build_intraday_candle_memory.py --incremental.
mlResearchRouter.get('/intraday/similarity/:ticker', async (req, res) => {
  const { ticker } = req.params
  const pool = getPool()
  const qry = async <T>(sql: string, params: unknown[] = []): Promise<T[]> => {
    const result = await pool.query(sql, params)
    return result.rows as T[]
  }
  try {
    // Similarity latest result
    const latestRows = await qry<{
      ticker: string
      as_of_ts: string
      k_used: number
      matched_sample: number
      time_gate: string | null
      regime_gate: string | null
      similarity_return_6: number | null
      similarity_hitrate: number | null
      similarity_mfe_12: number | null
      similarity_mae_12: number | null
      pct_hit_plus_1atr: number | null
      pct_hit_minus_1atr: number | null
      top_neighbors: unknown
      raw_summary: unknown
      updated_at: string
    }>(
      `SELECT * FROM intraday_similarity_latest WHERE ticker = $1`,
      [ticker.toUpperCase()]
    )

    if (latestRows.length === 0) {
      // Degrade gracefully (HTTP 200) so the UI can render an "unavailable"
      // state instead of treating a missing ticker as a hard error.
      res.json({
        available: false,
        reason: 'no_similarity_data',
        ticker,
        hint: 'Run build_intraday_candle_memory.py --full to initialize the candle memory bank.',
      })
      return
    }

    const row = latestRows[0]

    // Memory bank stats for context
    const statsRows = await qry<{ total_rows: number; earliest_ts: string; latest_ts: string }>(
      `SELECT COUNT(*)::int AS total_rows, MIN(ts)::text AS earliest_ts, MAX(ts)::text AS latest_ts
       FROM intraday_candle_memory WHERE ticker = $1`,
      [ticker.toUpperCase()]
    )
    const stats = statsRows[0] ?? { total_rows: 0, earliest_ts: null, latest_ts: null }

    // Active behaviors for this ticker today (most recent event_date)
    const behaviorRows = await qry<{
      behavior_id: string
      intensity: number
      event_date: string
      category: string
      direction: string
      intraday_weight: number
    }>(
      `SELECT ibe.behavior_id, ibe.intensity, ibe.event_date::text,
              mbc.category, mbc.direction, mbc.intraday_weight
       FROM intraday_behavior_events ibe
       JOIN market_behavior_concepts mbc USING (behavior_id)
       WHERE ibe.ticker = $1
         AND ibe.event_date = (
           SELECT MAX(event_date) FROM intraday_behavior_events WHERE ticker = $1
         )
         AND mbc.active = true
       ORDER BY ibe.intensity DESC`,
      [ticker.toUpperCase()]
    )

    // Behavior importance scores (most recent run_date)
    const importanceRows = await qry<{
      behavior_id: string
      hit_lift: number | null
      expectancy_with: number | null
      hit_rate_with: number | null
      is_informative: boolean
    }>(
      `SELECT behavior_id, hit_lift, expectancy_with, hit_rate_with, is_informative
       FROM intraday_behavior_importance
       WHERE run_date = (SELECT MAX(run_date) FROM intraday_behavior_importance)`,
      []
    )
    const importanceMap = new Map(importanceRows.map(r => [r.behavior_id, r]))

    // Enrich active behaviors with importance data
    const activeBehaviors = behaviorRows.map(b => ({
      behavior_id:      b.behavior_id,
      category:         b.category,
      direction:        b.direction,
      intensity:        b.intensity,
      intraday_weight:  b.intraday_weight,
      event_date:       b.event_date,
      hit_lift:         importanceMap.get(b.behavior_id)?.hit_lift ?? null,
      hit_rate_with:    importanceMap.get(b.behavior_id)?.hit_rate_with ?? null,
      expectancy_with:  importanceMap.get(b.behavior_id)?.expectancy_with ?? null,
      is_informative:   importanceMap.get(b.behavior_id)?.is_informative ?? false,
    }))

    // Dominant behavior: highest intensity * intraday_weight among informative ones
    const informativeBehaviors = activeBehaviors.filter(b => b.is_informative)
    const dominantBehavior = informativeBehaviors.length > 0
      ? informativeBehaviors.reduce((best, b) =>
          (b.intensity * b.intraday_weight) > (best.intensity * best.intraday_weight) ? b : best
        )
      : (activeBehaviors.length > 0 ? activeBehaviors[0] : null)

    // Expected next candle direction from behavior signals
    const bullishBehaviors = informativeBehaviors.filter(b => (b.hit_lift ?? 0) > 0.03)
    const bearishBehaviors  = informativeBehaviors.filter(b => (b.hit_lift ?? 0) < -0.03)
    let expectedNextCandleDirection: string
    let behaviorDirectionConfidence: string
    if (bullishBehaviors.length > 0 && bearishBehaviors.length === 0) {
      expectedNextCandleDirection = 'BULLISH'
      behaviorDirectionConfidence = bullishBehaviors.length >= 2 ? 'HIGH' : 'MODERATE'
    } else if (bearishBehaviors.length > 0 && bullishBehaviors.length === 0) {
      expectedNextCandleDirection = 'BEARISH'
      behaviorDirectionConfidence = bearishBehaviors.length >= 2 ? 'HIGH' : 'MODERATE'
    } else if (bullishBehaviors.length > 0 && bearishBehaviors.length > 0) {
      expectedNextCandleDirection = 'MIXED'
      behaviorDirectionConfidence = 'LOW'
    } else {
      expectedNextCandleDirection = 'NEUTRAL'
      behaviorDirectionConfidence = 'LOW'
    }

    // Multi-horizon outlook: best hit_rate_with among informative behaviors for direction
    const outlookBehavior = bullishBehaviors.length > 0
      ? bullishBehaviors[0]
      : bearishBehaviors.length > 0 ? bearishBehaviors[0] : null

    const outlook = {
      next_candle: expectedNextCandleDirection,
      candles_3:   outlookBehavior?.hit_rate_with != null ? Math.round(outlookBehavior.hit_rate_with * 100) + '% hist HR' : null,
      candles_6:   row.similarity_hitrate != null ? Math.round(row.similarity_hitrate * 100) + '% similarity HR' : null,
      candles_12:  row.pct_hit_plus_1atr != null ? Math.round(row.pct_hit_plus_1atr * 100) + '% +1ATR' : null,
    }

    // Warning flags
    const warnings: string[] = []
    if (!row.matched_sample || row.matched_sample < 20) {
      warnings.push(`Low match count (${row.matched_sample ?? 0}) -- similarity estimates are unreliable below 20 matches.`)
    }
    if (stats.total_rows < 1000) {
      warnings.push(`Small memory bank (${stats.total_rows} candles) -- accuracy improves as history accumulates.`)
    }
    const updatedAt = new Date(row.updated_at)
    const hoursSince = (Date.now() - updatedAt.getTime()) / 3_600_000
    if (hoursSince > 26) {
      warnings.push(`Similarity data is ${Math.round(hoursSince)}h old -- may not reflect today's candle.`)
    }
    if (bullishBehaviors.length > 0 && bearishBehaviors.length > 0) {
      warnings.push(`Conflicting behavior signals (${bullishBehaviors.length} bullish, ${bearishBehaviors.length} bearish) -- reduce position size.`)
    }
    if (activeBehaviors.length === 0) {
      warnings.push('No behavior events found for this ticker today -- behavior layer unavailable.')
    }

    const hitRate = row.similarity_hitrate ?? null
    const expReturn = row.similarity_return_6 ?? null

    // Recommended horizon based on hit rate and behavior signals
    let recommendedHorizon = '30m (6 bars)'
    let recommendedExit = 'Hold for primary 30-min target based on historical similar-candle behavior.'
    if (hitRate !== null && hitRate < 0.52 && informativeBehaviors.length === 0) {
      recommendedHorizon = 'No strong edge detected'
      recommendedExit = 'Similarity signal is weak and no informative behaviors active -- skip or use tighter stops.'
    } else if (row.pct_hit_plus_1atr !== null && row.pct_hit_plus_1atr > 0.45) {
      recommendedHorizon = '60m (12 bars)'
      recommendedExit = 'ATR target has good historical hit rate -- hold for +1 ATR target.'
    } else if (informativeBehaviors.length >= 2 && expectedNextCandleDirection !== 'MIXED') {
      recommendedHorizon = '15m (3 bars)'
      recommendedExit = 'Multiple informative behaviors active -- take quick profit at 3-bar target.'
    }

    res.json({
      ticker:              row.ticker,
      timestamp:           row.as_of_ts,
      k_used:              row.k_used,
      matched_sample:      row.matched_sample,
      time_gate:           row.time_gate,
      regime_gate:         row.regime_gate,
      similarity_probability: hitRate,
      similarity_expectancy:  expReturn,
      similarity_confidence:  row.matched_sample != null && row.matched_sample >= 30 ? 'HIGH'
                              : row.matched_sample != null && row.matched_sample >= 15 ? 'MODERATE'
                              : 'LOW',
      mfe_12_mean:         row.similarity_mfe_12,
      mae_12_mean:         row.similarity_mae_12,
      pct_hit_plus_1atr:   row.pct_hit_plus_1atr,
      pct_hit_minus_1atr:  row.pct_hit_minus_1atr,
      top_match_summary:   row.top_neighbors,
      // Behavior layer (v2)
      behavior_layer: {
        active_behaviors:               activeBehaviors,
        dominant_behavior:              dominantBehavior,
        expected_next_candle_direction: expectedNextCandleDirection,
        behavior_direction_confidence:  behaviorDirectionConfidence,
        bullish_signals:                bullishBehaviors.length,
        bearish_signals:                bearishBehaviors.length,
        informative_count:              informativeBehaviors.length,
        outlook,
      },
      recommended_horizon: recommendedHorizon,
      recommended_exit:    recommendedExit,
      warnings,
      memory_bank: {
        total_candles: stats.total_rows,
        earliest:      stats.earliest_ts,
        latest:        stats.latest_ts,
      },
      raw_summary:         row.raw_summary,
      updated_at:          row.updated_at,
    })
  } catch (err: unknown) {
    req.log?.error({ err }, 'research.intraday-similarity failed')
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' })
  }
})

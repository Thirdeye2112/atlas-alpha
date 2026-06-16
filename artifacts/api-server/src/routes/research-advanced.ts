/**
 * research-advanced.ts
 * --------------------
 * Advanced research API routes: confluence, meta-filter, behavior layer,
 * template eligibility, batch enrichment, and pipeline health.
 *
 * All endpoints degrade gracefully to { available: false } when the
 * underlying atlas-research tables are missing or unreachable.
 *
 * ENV VAR REQUIRED:
 *   DATABASE_URL_RESEARCH=postgresql://...
 */

import { Router } from 'express'
import pg from 'pg'

const { Pool } = pg

// ---------------------------------------------------------------------------
// Pool — shared with research-ml.ts but we keep our own instance to remain
// independently deployable.
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
      console.error('[research-advanced] Pool error:', err.message)
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

/** Returns true when `tableName` exists in the public schema. */
async function tableExists(tableName: string): Promise<boolean> {
  const rows = await query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1
     ) AS exists`,
    [tableName]
  )
  return rows[0]?.exists === true
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const advancedResearchRouter = Router()

// ---------------------------------------------------------------------------
// GET /api/research/confluence/:ticker
// Returns confluence engine signals for the ticker from the most recent run.
// ---------------------------------------------------------------------------

advancedResearchRouter.get('/confluence/:ticker', async (req, res) => {
  const ticker = (req.params.ticker ?? '').toUpperCase().trim()
  if (!ticker) return res.status(400).json({ error: 'ticker required' })

  try {
    // intraday_similarity_latest has per-ticker rows
    if (!(await tableExists('intraday_similarity_latest'))) {
      return res.json({ available: false, reason: 'table_missing' })
    }

    const rows = await query<Record<string, unknown>>(
      `SELECT ticker, as_of_ts, k_used, matched_sample, time_gate, regime_gate,
              similarity_return_6, similarity_hitrate, similarity_mfe_12, similarity_mae_12,
              pct_hit_plus_1atr, pct_hit_minus_1atr, updated_at
       FROM intraday_similarity_latest
       WHERE ticker = $1
       ORDER BY updated_at DESC
       LIMIT 1`,
      [ticker]
    )

    if (rows.length === 0) {
      return res.json({ available: true, ticker, setups: [] })
    }

    const latest = rows[0]
    const hitRate = latest.similarity_hitrate as number | null
    return res.json({
      available: true,
      ticker,
      setups: rows,
      confluence_score: hitRate,
      direction: hitRate !== null && hitRate > 0.5 ? 'BULL' : 'BEAR',
      regime_gate: latest.regime_gate ?? null,
      time_gate: latest.time_gate ?? null,
      similarity_return_6: latest.similarity_return_6 ?? null,
      similarity_hitrate: hitRate,
      updated_at: latest.updated_at,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[research-advanced] /confluence/${ticker}:`, msg)
    return res.json({ available: false, reason: 'error', detail: msg })
  }
})

// ---------------------------------------------------------------------------
// GET /api/research/meta/:ticker
// Returns Meta Filter F result (combo_key conviction) for the ticker.
// ---------------------------------------------------------------------------

advancedResearchRouter.get('/meta/:ticker', async (req, res) => {
  const ticker = (req.params.ticker ?? '').toUpperCase().trim()
  if (!ticker) return res.status(400).json({ error: 'ticker required' })

  try {
    // predictions table carries conviction, regime, vix_regime columns
    if (!(await tableExists('predictions'))) {
      return res.json({ available: false, reason: 'table_missing' })
    }

    const rows = await query<Record<string, unknown>>(
      `SELECT ticker, date, model_name, expected_return, probability_positive,
              confidence, rank_percentile, combo_key, meta_score, combo_status,
              combo_pf_60d, combo_expectancy_60d
       FROM predictions
       WHERE ticker = $1
         AND model_name = 'return_regressor'
       ORDER BY date DESC
       LIMIT 1`,
      [ticker]
    )

    if (rows.length === 0) {
      return res.json({ available: true, ticker, prediction: null })
    }

    const row = rows[0]
    const confidence  = row.confidence as number | null
    const rankPct     = row.rank_percentile as number | null
    const comboStatus = row.combo_status as string | null
    const metaScore   = row.meta_score as number | null
    // Meta-filter pass: top-40% rank + active/promoted combo (or no combo data yet).
    // rank_percentile is stored on a 0-1 scale (top decile ~= 0.9). The confidence
    // and probability_positive columns are currently near-constant (calibration not
    // yet active) so they are reported for context but not used as hard gates.
    const ACTIVE_COMBO = new Set([null, 'ACTIVE', 'PROMOTED'])
    const metaPass = rankPct !== null && rankPct >= 0.6
                     && ACTIVE_COMBO.has(comboStatus)

    return res.json({
      available: true,
      ticker,
      date: row.date,
      expected_return: row.expected_return,
      probability_positive: row.probability_positive,
      confidence,
      rank_percentile: rankPct,
      combo_key: row.combo_key,
      meta_score: metaScore,
      combo_status: comboStatus,
      combo_pf_60d: row.combo_pf_60d,
      combo_expectancy_60d: row.combo_expectancy_60d,
      meta_filter_pass: metaPass,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[research-advanced] /meta/${ticker}:`, msg)
    return res.json({ available: false, reason: 'error', detail: msg })
  }
})

// ---------------------------------------------------------------------------
// GET /api/research/intraday/behavior/:ticker
// Returns today's active behavior labels for the ticker.
// ---------------------------------------------------------------------------

advancedResearchRouter.get('/intraday/behavior/:ticker', async (req, res) => {
  const ticker = (req.params.ticker ?? '').toUpperCase().trim()
  if (!ticker) return res.status(400).json({ error: 'ticker required' })

  try {
    if (!(await tableExists('intraday_behavior_events'))) {
      return res.json({ available: false, reason: 'table_missing' })
    }

    const rows = await query<Record<string, unknown>>(
      `SELECT ibe.behavior_id, ibe.intensity, ibe.event_date,
              mbc.category, mbc.direction, mbc.intraday_weight,
              ibi.hit_lift, ibi.hit_rate_with, ibi.expectancy_with, ibi.is_informative
       FROM intraday_behavior_events ibe
       JOIN market_behavior_concepts mbc USING (behavior_id)
       LEFT JOIN intraday_behavior_importance ibi
         ON ibi.behavior_id = ibe.behavior_id
        AND ibi.run_date = (SELECT MAX(run_date) FROM intraday_behavior_importance)
       WHERE ibe.ticker = $1
         AND ibe.event_date = (
           SELECT MAX(event_date) FROM intraday_behavior_events WHERE ticker = $1
         )
       ORDER BY (ibe.intensity * mbc.intraday_weight) DESC`,
      [ticker]
    )

    if (rows.length === 0) {
      return res.json({ available: true, ticker, behaviors: [], dominant_behavior: null })
    }

    const informative = rows.filter((r) => r.is_informative === true)
    const bullish = informative.filter((r) => (r.hit_lift as number) > 0.03)
    const bearish = informative.filter((r) => (r.hit_lift as number) < -0.03)

    let direction: 'BULLISH' | 'BEARISH' | 'MIXED' | 'NEUTRAL' = 'NEUTRAL'
    if (bullish.length > 0 && bearish.length === 0) direction = 'BULLISH'
    else if (bearish.length > 0 && bullish.length === 0) direction = 'BEARISH'
    else if (bullish.length > 0 && bearish.length > 0) direction = 'MIXED'

    const confidence: 'HIGH' | 'MODERATE' | 'LOW' =
      informative.length >= 3 ? 'HIGH' :
      informative.length >= 1 ? 'MODERATE' : 'LOW'

    // Dominant = highest intensity * intraday_weight among informative
    const dominant = informative.length > 0 ? informative[0] : rows[0]

    return res.json({
      available: true,
      ticker,
      event_date: rows[0].event_date,
      behaviors: rows,
      dominant_behavior: dominant,
      expected_direction: direction,
      direction_confidence: confidence,
      bullish_count: bullish.length,
      bearish_count: bearish.length,
      informative_count: informative.length,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[research-advanced] /intraday/behavior/${ticker}:`, msg)
    return res.json({ available: false, reason: 'error', detail: msg })
  }
})

// ---------------------------------------------------------------------------
// GET /api/research/template/eligible/:ticker
// Returns whether the ticker is eligible for any active bot templates and
// which patterns are currently active.
// ---------------------------------------------------------------------------

advancedResearchRouter.get('/template/eligible/:ticker', async (req, res) => {
  const ticker = (req.params.ticker ?? '').toUpperCase().trim()
  if (!ticker) return res.status(400).json({ error: 'ticker required' })

  try {
    if (!(await tableExists('predictions'))) {
      return res.json({ available: false, reason: 'table_missing' })
    }

    // Fetch latest prediction
    const predRows = await query<Record<string, unknown>>(
      `SELECT ticker, date, expected_return, probability_positive,
              confidence, rank_percentile, combo_key, meta_score, combo_status
       FROM predictions
       WHERE ticker = $1
         AND model_name = 'return_regressor'
       ORDER BY date DESC
       LIMIT 1`,
      [ticker]
    )

    if (predRows.length === 0) {
      return res.json({ available: true, ticker, eligible: false, reason: 'no_prediction' })
    }

    const pred = predRows[0]
    const confidence  = pred.confidence as number | null
    const rankPct     = pred.rank_percentile as number | null
    const comboStatus = pred.combo_status as string | null

    // Template eligibility: top 40% rank (rank_percentile is 0-1 scale) + combo
    // promoted/active (or not yet scored). confidence is reported for context but
    // is not a hard gate while calibration is inactive (column is near-constant).
    const ACTIVE_COMBO = new Set([null, 'ACTIVE', 'PROMOTED'])
    const confOk  = confidence !== null && confidence >= 0.5
    const rankOk  = rankPct !== null && rankPct >= 0.6
    const comboOk = ACTIVE_COMBO.has(comboStatus)
    const eligible = rankOk && comboOk

    // Fetch top promoted combo patterns from signal_combination_scores if present.
    let activePatterns: string[] = []
    if (await tableExists('signal_combination_scores')) {
      const patRows = await query<{ combo_key: string }>(
        `SELECT combo_key FROM signal_combination_scores
         WHERE status = 'PROMOTED'
         ORDER BY expectancy_60d DESC NULLS LAST, meta_score DESC NULLS LAST
         LIMIT 5`
      )
      activePatterns = patRows.map((r) => r.combo_key)
    }

    return res.json({
      available: true,
      ticker,
      eligible,
      confidence,
      rank_percentile: rankPct,
      combo_key: pred.combo_key,
      meta_score: pred.meta_score,
      combo_status: comboStatus,
      active_patterns: activePatterns,
      eligibility_detail: { conf_ok: confOk, rank_ok: rankOk, combo_ok: comboOk },
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[research-advanced] /template/eligible/${ticker}:`, msg)
    return res.json({ available: false, reason: 'error', detail: msg })
  }
})

// ---------------------------------------------------------------------------
// GET /api/research/batch/enrichment?tickers=AAPL,MSFT
// Returns prediction + behavior summary for up to 20 tickers at once.
// ---------------------------------------------------------------------------

advancedResearchRouter.get('/batch/enrichment', async (req, res) => {
  const tickerParam = (req.query.tickers as string | undefined) ?? ''
  const tickers = tickerParam
    .split(',')
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 20)

  if (tickers.length === 0) {
    return res.status(400).json({ error: 'tickers query param required (comma-separated, max 20)' })
  }

  try {
    if (!(await tableExists('predictions'))) {
      return res.json({ available: false, reason: 'table_missing' })
    }

    // Batch predictions
    const placeholders = tickers.map((_, i) => `$${i + 1}`).join(', ')
    const predRows = await query<Record<string, unknown>>(
      `SELECT DISTINCT ON (ticker)
              ticker, date, expected_return, probability_positive,
              confidence, rank_percentile, combo_key, meta_score, combo_status
       FROM predictions
       WHERE ticker IN (${placeholders})
         AND model_name = 'return_regressor'
       ORDER BY ticker, date DESC`,
      tickers
    )

    // Batch behaviors (if table exists)
    const behaviorMap: Record<string, { behavior_id: string; direction: string; intensity: number }[]> = {}
    if (await tableExists('intraday_behavior_events')) {
      const bRows = await query<Record<string, unknown>>(
        `SELECT DISTINCT ON (ibe.ticker, ibe.behavior_id)
                ibe.ticker, ibe.behavior_id, ibe.intensity,
                mbc.direction
         FROM intraday_behavior_events ibe
         JOIN market_behavior_concepts mbc USING (behavior_id)
         WHERE ibe.ticker IN (${placeholders})
           AND ibe.event_date >= (SELECT MAX(event_date) FROM intraday_behavior_events) - INTERVAL '5 days'
         ORDER BY ibe.ticker, ibe.behavior_id, ibe.event_date DESC`,
        tickers
      )
      for (const r of bRows) {
        const t = r.ticker as string
        if (!behaviorMap[t]) behaviorMap[t] = []
        behaviorMap[t].push({
          behavior_id: r.behavior_id as string,
          direction: r.direction as string,
          intensity: r.intensity as number,
        })
      }
    }

    const result = predRows.map((row) => {
      const t = row.ticker as string
      return {
        ticker: t,
        date: row.date,
        expected_return: row.expected_return,
        probability_positive: row.probability_positive,
        confidence: row.confidence,
        rank_percentile: row.rank_percentile,
        combo_key: row.combo_key,
        meta_score: row.meta_score,
        combo_status: row.combo_status,
        behaviors: behaviorMap[t] ?? [],
      }
    })

    // Fill in tickers that had no prediction
    const found = new Set(predRows.map((r) => r.ticker as string))
    for (const t of tickers) {
      if (!found.has(t)) {
        result.push({
          ticker: t,
          date: null,
          expected_return: null,
          probability_positive: null,
          confidence: null,
          rank_percentile: null,
          combo_key: null,
          meta_score: null,
          combo_status: null,
          behaviors: behaviorMap[t] ?? [],
        })
      }
    }

    return res.json({ available: true, tickers: result })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[research-advanced] /batch/enrichment:', msg)
    return res.json({ available: false, reason: 'error', detail: msg })
  }
})

// ---------------------------------------------------------------------------
// GET /api/research/pipeline/health
// Returns status of critical atlas-research tables and latest pipeline run.
// ---------------------------------------------------------------------------

advancedResearchRouter.get('/pipeline/health', async (req, res) => {
  // Critical tables use real atlas_research names. (Daily bars live in raw_bars;
  // intraday bars in intraday_bars; the run log is research_runs — there is no
  // daily_bars / intraday_candles / pipeline_run_log table.)
  const CRITICAL_TABLES = [
    'predictions',
    'raw_bars',
    'intraday_bars',
    'intraday_candle_memory',
    'intraday_behavior_events',
    'market_behavior_concepts',
    'intraday_behavior_importance',
    'detected_behaviors',
    'research_runs',
  ]

  try {
    const tableChecks: Record<string, boolean> = {}
    for (const t of CRITICAL_TABLES) {
      tableChecks[t] = await tableExists(t)
    }

    // Latest prediction date
    let latestPredDate: string | null = null
    let predCount = 0
    if (tableChecks['predictions']) {
      const rows = await query<{ max_date: string; cnt: string }>(
        `SELECT MAX(date)::text AS max_date, COUNT(*) AS cnt
         FROM predictions WHERE model_name = 'return_regressor'`
      )
      latestPredDate = rows[0]?.max_date ?? null
      predCount = parseInt(rows[0]?.cnt ?? '0', 10)
    }

    // Latest pipeline run
    let latestRun: Record<string, unknown> | null = null
    if (tableChecks['pipeline_run_log']) {
      const runRows = await query<Record<string, unknown>>(
        `SELECT run_id, mode, started_at, finished_at, status, error_msg
         FROM pipeline_run_log
         WHERE step_name IS NULL
         ORDER BY started_at DESC
         LIMIT 1`
      )
      latestRun = runRows[0] ?? null
    } else if (tableChecks['research_runs']) {
      const runRows = await query<Record<string, unknown>>(
        `SELECT run_type, started_at, finished_at, status, error_message
         FROM research_runs
         ORDER BY started_at DESC
         LIMIT 1`
      )
      latestRun = runRows[0] ?? null
    }

    // Latest behavior detection
    let latestBehaviorDate: string | null = null
    if (tableChecks['intraday_behavior_events']) {
      const bRows = await query<{ max_date: string }>(
        `SELECT MAX(event_date)::text AS max_date FROM intraday_behavior_events`
      )
      latestBehaviorDate = bRows[0]?.max_date ?? null
    }

    // Latest intraday candle memory
    let latestMemoryTs: string | null = null
    if (tableChecks['intraday_candle_memory']) {
      const mRows = await query<{ max_ts: string }>(
        `SELECT MAX(ts)::text AS max_ts FROM intraday_candle_memory`
      )
      latestMemoryTs = mRows[0]?.max_ts ?? null
    }

    const missingTables = CRITICAL_TABLES.filter((t) => !tableChecks[t])
    const overallStatus =
      missingTables.length === 0 ? 'healthy' :
      missingTables.length <= 3 ? 'degraded' : 'critical'

    return res.json({
      available: true,
      status: overallStatus,
      checked_at: new Date().toISOString(),
      tables: tableChecks,
      missing_tables: missingTables,
      latest_prediction_date: latestPredDate,
      prediction_count: predCount,
      latest_pipeline_run: latestRun,
      latest_behavior_date: latestBehaviorDate,
      latest_candle_memory_ts: latestMemoryTs,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[research-advanced] /pipeline/health:', msg)
    return res.json({ available: false, reason: 'error', detail: msg })
  }
})

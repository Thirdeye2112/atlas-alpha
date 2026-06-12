/**
 * research-signal.ts
 * ------------------
 * Phase 3: ML signal endpoint for Atlas Alpha score panel integration.
 *
 * Exposes atlas-research ML outputs as structured signals consumable by
 * Atlas Alpha's existing scoring engine. These are probabilistic signals,
 * not deterministic TA — they quantify historical outcome likelihood.
 *
 * REGISTRATION (in routes/index.ts):
 *   import { mlSignalRouter } from './research-signal.js'
 *   router.use('/research', mlSignalRouter)
 *
 * Endpoints
 * ---------
 *   GET /api/research/signal/:ticker
 *     Full ML signal for one ticker — for score panel integration.
 *
 *   GET /api/research/signals
 *     Batch signals for multiple tickers — for scanner/watchlist enrichment.
 *     Query: ?tickers=AAPL,MSFT,NVDA
 *
 *   GET /api/research/signal/:ticker/history
 *     30-day signal history — for trend context in score panel.
 *
 * Signal shape
 * ------------
 * {
 *   ticker:                  string
 *   date:                    string        — signal date (ISO)
 *   ml_rank_percentile:      number        — 0-100, cross-sectional rank
 *   ml_expected_return_5d:   number        — log return estimate
 *   ml_probability_positive: number        — P(return > 0), 0-1
 *   ml_confidence:           number        — signal certainty, 0-1
 *   ml_expected_drawdown:    number        — downside risk proxy
 *   ml_signal_strength:      'STRONG' | 'MODERATE' | 'WEAK' | 'NEUTRAL'
 *   ml_direction:            'BULLISH' | 'BEARISH' | 'NEUTRAL'
 *   wf_mean_ic:              number        — model's walk-forward IC (quality)
 *   regime_note:             string | null — regime context if available
 *   available:               boolean       — false if no prediction for today
 * }
 */

import { Router } from 'express'
import { Pool } from 'pg'
import { z } from 'zod'

// ── DB connection (atlas_research) ────────────────────────────────────────────
let _pool: Pool | null = null

function getPool(): Pool {
  if (!_pool) {
    const url = process.env['DATABASE_URL_RESEARCH']
    if (!url) throw new Error('DATABASE_URL_RESEARCH not set')
    _pool = new Pool({ connectionString: url, max: 3 })
    _pool.on('error', (err) => {
      console.error('[research-signal] Pool error:', err.message)
    })
  }
  return _pool
}

async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const client = await getPool().connect()
  try {
    const result = await client.query(sql, params)
    return result.rows as T[]
  } finally {
    client.release()
  }
}

// ── Signal strength classification ───────────────────────────────────────────

function classifyStrength(
  rankPct: number | null,
  confidence: number | null,
  wfIc: number | null,
): 'STRONG' | 'MODERATE' | 'WEAK' | 'NEUTRAL' {
  if (rankPct == null || confidence == null) return 'NEUTRAL'
  // Weight by model quality (wf IC)
  const icQuality = wfIc != null ? Math.min(Math.abs(wfIc) / 0.05, 1.0) : 0.5
  const score = (Math.abs(rankPct - 50) / 50) * 0.5 +
                confidence * 0.3 +
                icQuality * 0.2
  if (score >= 0.65) return 'STRONG'
  if (score >= 0.40) return 'MODERATE'
  if (score >= 0.20) return 'WEAK'
  return 'NEUTRAL'
}

function classifyDirection(
  rankPct: number | null,
  probPos: number | null,
): 'BULLISH' | 'BEARISH' | 'NEUTRAL' {
  const p = probPos ?? (rankPct != null ? rankPct / 100 : null)
  if (p == null) return 'NEUTRAL'
  if (p >= 0.55) return 'BULLISH'
  if (p <= 0.45) return 'BEARISH'
  return 'NEUTRAL'
}

// ── SQL ───────────────────────────────────────────────────────────────────────

const LATEST_PREDICTION_DATE_SQL = `
  SELECT MAX(date)::text AS max_date
  FROM predictions
  WHERE model_name = 'return_regressor'
`

const SIGNAL_FOR_TICKER_SQL = `
  WITH latest AS (
    SELECT MAX(date) AS max_date FROM predictions WHERE model_name = 'return_regressor'
  ),
  pred AS (
    SELECT
      p.ticker,
      p.date::text                     AS date,
      p.expected_return,
      p.probability_positive,
      p.expected_drawdown,
      p.confidence,
      p.rank_percentile
    FROM predictions p, latest
    WHERE p.ticker     = $1
      AND p.date       = latest.max_date
      AND p.model_name = 'return_regressor'
  ),
  model AS (
    SELECT
      AVG(rank_ic)    AS wf_mean_ic,
      STDDEV(rank_ic) AS wf_std_ic,
      MAX(training_end)::text AS trained_through
    FROM model_registry
    WHERE model_name = 'return_regressor'
      AND rank_ic IS NOT NULL
  )
  SELECT
    pred.*,
    model.wf_mean_ic,
    model.wf_std_ic,
    model.trained_through
  FROM pred
  CROSS JOIN model
`

const SIGNAL_BATCH_SQL = `
  WITH latest AS (
    SELECT MAX(date) AS max_date FROM predictions WHERE model_name = 'return_regressor'
  ),
  model AS (
    SELECT AVG(rank_ic) AS wf_mean_ic
    FROM model_registry
    WHERE model_name = 'return_regressor' AND rank_ic IS NOT NULL
  )
  SELECT
    p.ticker,
    p.date::text              AS date,
    p.expected_return,
    p.probability_positive,
    p.expected_drawdown,
    p.confidence,
    p.rank_percentile,
    model.wf_mean_ic
  FROM predictions p, latest, model
  WHERE p.ticker     = ANY($1)
    AND p.date       = latest.max_date
    AND p.model_name = 'return_regressor'
  ORDER BY p.rank_percentile DESC NULLS LAST
`

const SIGNAL_HISTORY_SQL = `
  SELECT
    date::text            AS date,
    expected_return,
    probability_positive,
    confidence,
    rank_percentile
  FROM predictions
  WHERE ticker     = $1
    AND model_name = 'return_regressor'
    AND date >= CURRENT_DATE - INTERVAL '60 days'
  ORDER BY date ASC
`

const OMNI_FEATURES_SQL = `
  SELECT feature_name, feature_value
  FROM feature_snapshots
  WHERE ticker = $1
    AND date = (SELECT MAX(date) FROM feature_snapshots WHERE ticker = $1)
    AND feature_name IN ('omni_82_above', 'omni_82_distance', 'omni_82_slope', 'omni_82_value')
`

const OMNI_BATCH_SQL = `
  SELECT DISTINCT ON (ticker) ticker, feature_value
  FROM feature_snapshots
  WHERE ticker = ANY($1)
    AND feature_name = 'omni_82_above'
  ORDER BY ticker, date DESC
`

// ── Router ────────────────────────────────────────────────────────────────────

export const mlSignalRouter = Router()

// ---------------------------------------------------------------------------
// GET /api/research/signal/:ticker
// Full ML signal for one ticker — consumed by Atlas Alpha score panel.
// ---------------------------------------------------------------------------
mlSignalRouter.get('/signal/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase().trim()
    const [rows, omniRows] = await Promise.all([
      query<{
        ticker: string; date: string
        expected_return: number | null; probability_positive: number | null
        expected_drawdown: number | null; confidence: number | null
        rank_percentile: number | null; wf_mean_ic: number | null
        wf_std_ic: number | null; trained_through: string | null
      }>(SIGNAL_FOR_TICKER_SQL, [ticker]),
      query<{ feature_name: string; feature_value: number | null }>(OMNI_FEATURES_SQL, [ticker]),
    ])

    // Build OMNI feature map
    const omni: Record<string, number | null> = {}
    for (const row of omniRows) omni[row.feature_name] = row.feature_value

    if (!rows.length) {
      // Return a structured empty response — not a 404
      res.json({
        ticker,
        date: null,
        ml_rank_percentile:      null,
        ml_expected_return_5d:   null,
        ml_probability_positive: null,
        ml_confidence:           null,
        ml_expected_drawdown:    null,
        ml_signal_strength:      'NEUTRAL',
        ml_direction:            'NEUTRAL',
        wf_mean_ic:              null,
        regime_note:             null,
        available:               false,
        omni_green:              null,
        omni_distance_pct:       null,
        omni_slope:              null,
        jarvis_green:            null,
        jarvis_distance_pct:     null,
        jarvis_slope:            null,
      })
      return
    }

    const r = rows[0]
    const strength = classifyStrength(r.rank_percentile, r.confidence, r.wf_mean_ic)
    const direction = classifyDirection(r.rank_percentile, r.probability_positive)

    const omniAbove = omni['omni_82_above']
    const omniDist  = omni['omni_82_distance']
    const omniSlope = omni['omni_82_slope']

    res.json({
      ticker:                  r.ticker,
      date:                    r.date,
      ml_rank_percentile: r.rank_percentile != null ? r.rank_percentile * 100 : null,
      ml_expected_return_5d:   r.expected_return,
      ml_probability_positive: r.probability_positive,
      ml_confidence:           r.confidence,
      ml_expected_drawdown:    r.expected_drawdown,
      ml_signal_strength:      strength,
      ml_direction:            direction,
      wf_mean_ic:              r.wf_mean_ic,
      wf_std_ic:               r.wf_std_ic,
      trained_through:         r.trained_through,
      regime_note:             null,    // Phase 4: populated by regime classifier
      available:               true,
      omni_green:              omniAbove != null ? omniAbove > 0.5 : null,
      omni_distance_pct:       omniDist ?? null,
      omni_slope:              omniSlope ?? null,
      jarvis_green:            omniAbove != null ? omniAbove > 0.5 : null,
      jarvis_distance_pct:     omniDist ?? null,
      jarvis_slope:            omniSlope ?? null,
    })
  } catch (err: unknown) {
    req.log?.error({ err }, 'research.signal.ticker failed')
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' })
  }
})

// ---------------------------------------------------------------------------
// GET /api/research/signals?tickers=AAPL,MSFT,NVDA
// Batch signals — for scanner row enrichment and watchlist display.
// ---------------------------------------------------------------------------
mlSignalRouter.get('/signals', async (req, res) => {
  try {
    const tickerParam = String(req.query.tickers ?? '')
    if (!tickerParam) {
      res.status(400).json({ error: 'tickers query param required (comma-separated)' })
      return
    }

    const tickers = tickerParam
      .split(',')
      .map(t => t.trim().toUpperCase())
      .filter(t => t.length > 0)
      .slice(0, 200)  // cap at 200

    const [rows, omniRows] = await Promise.all([
      query<{
        ticker: string; date: string
        expected_return: number | null; probability_positive: number | null
        expected_drawdown: number | null; confidence: number | null
        rank_percentile: number | null; wf_mean_ic: number | null
      }>(SIGNAL_BATCH_SQL, [tickers]),
      query<{ ticker: string; feature_value: number | null }>(OMNI_BATCH_SQL, [tickers]),
    ])

    const omniMap = new Map<string, number | null>()
    for (const row of omniRows) omniMap.set(row.ticker, row.feature_value)

    const signals = rows.map(r => {
      const omniAbove = omniMap.get(r.ticker) ?? null
      const jarvisGreen = omniAbove != null ? omniAbove > 0.5 : null
      return {
        ticker:                  r.ticker,
        date:                    r.date,
        ml_rank_percentile: r.rank_percentile != null ? r.rank_percentile * 100 : null,
        ml_expected_return_5d:   r.expected_return,
        ml_probability_positive: r.probability_positive,
        ml_confidence:           r.confidence,
        ml_expected_drawdown:    r.expected_drawdown,
        ml_signal_strength:      classifyStrength(r.rank_percentile, r.confidence, r.wf_mean_ic),
        ml_direction:            classifyDirection(r.rank_percentile, r.probability_positive),
        jarvis_green:            jarvisGreen,
        omni_green:              jarvisGreen,
        available:               true,
      }
    })

    // Add empty entries for tickers with no prediction
    const found = new Set(signals.map(s => s.ticker))
    for (const t of tickers) {
      if (!found.has(t)) {
        signals.push({
          ticker: t, date: null as unknown as string,
          ml_rank_percentile: null, ml_expected_return_5d: null,
          ml_probability_positive: null, ml_confidence: null,
          ml_expected_drawdown: null,
          ml_signal_strength: 'NEUTRAL', ml_direction: 'NEUTRAL',
          jarvis_green: null, omni_green: null,
          available: false,
        })
      }
    }

    res.json({
      date:    signals.find(s => s.available)?.date ?? null,
      count:   signals.filter(s => s.available).length,
      signals,
    })
  } catch (err: unknown) {
    req.log?.error({ err }, 'research.signals.batch failed')
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' })
  }
})

// ---------------------------------------------------------------------------
// GET /api/research/signal/:ticker/history
// 60-day signal history — for sparklines in score panel / drawer.
// ---------------------------------------------------------------------------
mlSignalRouter.get('/signal/:ticker/history', async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase().trim()
    const rows = await query<{
      date: string; expected_return: number | null
      probability_positive: number | null; confidence: number | null
      rank_percentile: number | null
    }>(SIGNAL_HISTORY_SQL, [ticker])

    res.json({
      ticker,
      count: rows.length,
      history: rows.map(r => ({
        date:            r.date,
        rank_percentile: r.rank_percentile != null ? r.rank_percentile * 100 : null,
        probability:     r.probability_positive,
        confidence:      r.confidence,
        expected_return: r.expected_return,
      })),
    })
  } catch (err: unknown) {
    req.log?.error({ err }, 'research.signal.history failed')
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' })
  }
})



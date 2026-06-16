/**
 * research-attribution.ts
 * -----------------------
 * Prediction Error Attribution API
 *
 * Exposes Atlas's closed-loop learning data:
 *   - What Atlas predicted and what happened
 *   - Why predictions failed (failure classification)
 *   - Which signals are improving vs degrading
 *   - Adaptive weighting recommendations (human-reviewed, not auto-promoted)
 *
 * REGISTRATION (in routes/index.ts):
 *   import { attributionRouter } from './research-attribution.js'
 *   router.use('/research', attributionRouter)
 *
 * Endpoints
 * ---------
 *   GET /api/research/prediction-errors
 *     Matured predictions with failure classification.
 *     Query: ?start=2026-01-01&end=2026-06-15&horizon=5&conviction=HIGH&limit=500
 *
 *   GET /api/research/signal-reliability
 *     Rolling signal reliability per component.
 *     Query: ?window=90&horizon=5&component=ml&regime=bull_market
 *
 *   GET /api/research/adaptive-recommendations
 *     Pending adaptive weight recommendations.
 *     Query: ?status=pending&component=ml
 *
 *   POST /api/research/adaptive-recommendations/:id/promote
 *     Mark a recommendation as promoted (reviewed and approved).
 *
 *   POST /api/research/adaptive-recommendations/:id/reject
 *     Reject a recommendation with a reason.
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
      console.error('[research-attribution] Pool error:', err.message)
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

// ── Router ────────────────────────────────────────────────────────────────────

export const attributionRouter = Router()

// ---------------------------------------------------------------------------
// GET /api/research/prediction-errors
// Matured predictions with failure classification.
// ---------------------------------------------------------------------------
attributionRouter.get('/prediction-errors', async (req, res) => {
  try {
    const schema = z.object({
      start:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      end:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      horizon:    z.coerce.number().int().min(1).max(60).default(5),
      conviction: z.enum(['LOW', 'MODERATE', 'HIGH', 'VERY_HIGH', 'all']).default('all'),
      regime:     z.string().optional(),
      direction:  z.enum(['bullish', 'bearish', 'neutral', 'all']).default('all'),
      class:      z.string().optional(),           // filter by failure_class
      limit:      z.coerce.number().int().min(1).max(5000).default(500),
      offset:     z.coerce.number().int().min(0).default(0),
    })

    const parsed = schema.safeParse(req.query)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid query params', details: parsed.error.issues })
      return
    }
    const q = parsed.data

    // Build WHERE clauses
    const conditions: string[] = ['po.hit_or_miss IS NOT NULL', 'po.horizon_days = $1']
    const params: unknown[] = [q.horizon]
    let p = 2

    if (q.start) {
      conditions.push(`po.prediction_date >= $${p++}`)
      params.push(q.start)
    }
    if (q.end) {
      conditions.push(`po.prediction_date <= $${p++}`)
      params.push(q.end)
    }
    if (q.conviction !== 'all') {
      conditions.push(`po.conviction_level = $${p++}`)
      params.push(q.conviction)
    }
    if (q.regime) {
      conditions.push(`po.regime = $${p++}`)
      params.push(q.regime)
    }
    if (q.direction !== 'all') {
      conditions.push(`po.predicted_direction = $${p++}`)
      params.push(q.direction)
    }
    if (q.class) {
      conditions.push(`ea.failure_class = $${p++}`)
      params.push(q.class)
    }

    const where = conditions.join(' AND ')

    // Summary stats
    const summarySQL = `
      SELECT
        COUNT(*)                                                    AS total,
        SUM(CASE WHEN po.hit_or_miss THEN 1 ELSE 0 END)           AS hits,
        AVG(CASE WHEN po.hit_or_miss THEN 1.0 ELSE 0.0 END)       AS hit_rate,
        AVG(po.actual_return)                                       AS avg_return,
        AVG(po.max_runup)                                           AS avg_runup,
        AVG(po.max_drawdown)                                        AS avg_drawdown
      FROM prediction_outcomes po
      LEFT JOIN prediction_error_attribution ea
        ON ea.outcome_id = po.id AND ea.is_primary = true
      WHERE ${where}
    `

    // Failure class breakdown
    const failureSQL = `
      SELECT
        COALESCE(ea.failure_class, 'unclassified')  AS failure_class,
        COUNT(*)                                     AS n,
        SUM(CASE WHEN NOT po.hit_or_miss THEN 1 ELSE 0 END) AS n_misses,
        AVG(ea.confidence)                           AS avg_confidence
      FROM prediction_outcomes po
      LEFT JOIN prediction_error_attribution ea
        ON ea.outcome_id = po.id AND ea.is_primary = true
      WHERE ${where}
      GROUP BY COALESCE(ea.failure_class, 'unclassified')
      ORDER BY n DESC
    `

    // Detail rows (paginated)
    const detailSQL = `
      SELECT
        po.id,
        po.ticker,
        po.prediction_date::text,
        po.predicted_direction,
        po.predicted_probability,
        po.confluence_score,
        po.conviction_level,
        po.conviction_score,
        po.aligned_count,
        po.conflicting_count,
        po.regime,
        po.vol_regime,
        po.actual_return,
        po.actual_direction,
        po.hit_or_miss,
        po.prediction_error,
        po.max_runup,
        po.max_drawdown,
        COALESCE(ea.failure_class, 'unclassified') AS failure_class,
        ea.confidence                               AS classification_confidence,
        ea.details                                  AS classification_details
      FROM prediction_outcomes po
      LEFT JOIN prediction_error_attribution ea
        ON ea.outcome_id = po.id AND ea.is_primary = true
      WHERE ${where}
      ORDER BY po.prediction_date DESC
      LIMIT $${p} OFFSET $${p + 1}
    `

    const [summaryRows, failureRows, detailRows] = await Promise.all([
      query<Record<string, unknown>>(summarySQL, params),
      query<Record<string, unknown>>(failureSQL, params),
      query<Record<string, unknown>>(detailSQL, [...params, q.limit, q.offset]),
    ])

    const summary = summaryRows[0] ?? {}

    res.json({
      summary: {
        total:        Number(summary['total'] ?? 0),
        hits:         Number(summary['hits'] ?? 0),
        hit_rate:     summary['hit_rate'] != null ? Number(summary['hit_rate']) : null,
        avg_return:   summary['avg_return'] != null ? Number(summary['avg_return']) : null,
        avg_runup:    summary['avg_runup'] != null ? Number(summary['avg_runup']) : null,
        avg_drawdown: summary['avg_drawdown'] != null ? Number(summary['avg_drawdown']) : null,
      },
      failure_breakdown: failureRows.map(r => ({
        failure_class:    r['failure_class'],
        n:                Number(r['n']),
        n_misses:         Number(r['n_misses']),
        avg_confidence:   r['avg_confidence'] != null ? Number(r['avg_confidence']) : null,
      })),
      predictions: detailRows.map(r => ({
        id:                      Number(r['id']),
        ticker:                  r['ticker'],
        prediction_date:         r['prediction_date'],
        predicted_direction:     r['predicted_direction'],
        predicted_probability:   r['predicted_probability'] != null ? Number(r['predicted_probability']) : null,
        confluence_score:        r['confluence_score'] != null ? Number(r['confluence_score']) : null,
        conviction_level:        r['conviction_level'],
        conviction_score:        r['conviction_score'] != null ? Number(r['conviction_score']) : null,
        aligned_count:           r['aligned_count'] != null ? Number(r['aligned_count']) : null,
        conflicting_count:       r['conflicting_count'] != null ? Number(r['conflicting_count']) : null,
        regime:                  r['regime'],
        vol_regime:              r['vol_regime'],
        actual_return:           r['actual_return'] != null ? Number(r['actual_return']) : null,
        actual_direction:        r['actual_direction'],
        hit_or_miss:             r['hit_or_miss'],
        prediction_error:        r['prediction_error'] != null ? Number(r['prediction_error']) : null,
        max_runup:               r['max_runup'] != null ? Number(r['max_runup']) : null,
        max_drawdown:            r['max_drawdown'] != null ? Number(r['max_drawdown']) : null,
        failure_class:           r['failure_class'],
        classification_confidence: r['classification_confidence'] != null ? Number(r['classification_confidence']) : null,
        classification_details:  r['classification_details'],
      })),
      meta: {
        horizon:     q.horizon,
        start:       q.start ?? null,
        end:         q.end ?? null,
        conviction:  q.conviction,
        regime:      q.regime ?? null,
        limit:       q.limit,
        offset:      q.offset,
      },
    })
  } catch (err: unknown) {
    req.log?.error({ err }, 'research.prediction-errors failed')
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' })
  }
})


// ---------------------------------------------------------------------------
// GET /api/research/signal-reliability
// Rolling signal reliability per component.
// ---------------------------------------------------------------------------
attributionRouter.get('/signal-reliability', async (req, res) => {
  try {
    const schema = z.object({
      window:    z.coerce.number().int().min(1).max(365).default(90),
      horizon:   z.coerce.number().int().min(1).max(60).default(5),
      component: z.string().optional(),
      regime:    z.string().optional(),
      tier:      z.string().optional(),
      direction: z.enum(['bullish', 'bearish', 'all']).default('all'),
    })

    const parsed = schema.safeParse(req.query)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid query params', details: parsed.error.issues })
      return
    }
    const q = parsed.data

    const conditions: string[] = [
      'computed_date = (SELECT MAX(computed_date) FROM signal_reliability_scores)',
      'window_days = $1',
      'horizon_days = $2',
      'signal_direction = $3',
    ]
    const params: unknown[] = [q.window, q.horizon, q.direction]
    let p = 4

    if (q.component) {
      conditions.push(`component_name = $${p++}`)
      params.push(q.component)
    }
    if (q.regime) {
      conditions.push(`regime_filter = $${p++}`)
      params.push(q.regime)
    } else {
      conditions.push('regime_filter IS NULL')
    }
    if (q.tier) {
      conditions.push(`quality_tier_filter = $${p++}`)
      params.push(q.tier)
    } else {
      conditions.push('quality_tier_filter IS NULL')
    }

    const sql = `
      SELECT
        computed_date::text,
        component_name,
        signal_direction,
        window_days,
        regime_filter,
        quality_tier_filter,
        horizon_days,
        n_predictions,
        n_hits,
        hit_rate,
        avg_return,
        ic,
        prior_hit_rate,
        hit_rate_delta,
        trend,
        computed_at::text
      FROM signal_reliability_scores
      WHERE ${conditions.join(' AND ')}
      ORDER BY component_name, regime_filter NULLS FIRST
    `

    // Also get history for trend sparklines
    const historySQL = `
      SELECT
        computed_date::text,
        component_name,
        hit_rate,
        avg_return,
        trend,
        n_predictions
      FROM signal_reliability_scores
      WHERE window_days = $1
        AND horizon_days = $2
        AND signal_direction = 'all'
        AND regime_filter IS NULL
        AND quality_tier_filter IS NULL
        AND computed_date >= CURRENT_DATE - INTERVAL '90 days'
      ORDER BY computed_date ASC, component_name
    `

    const [rows, historyRows] = await Promise.all([
      query<Record<string, unknown>>(sql, params),
      query<Record<string, unknown>>(historySQL, [q.window, q.horizon]),
    ])

    // Group history by component
    const history: Record<string, Array<{ date: string; hit_rate: number | null; trend: string | null }>> = {}
    for (const h of historyRows) {
      const comp = String(h['component_name'])
      if (!history[comp]) history[comp] = []
      history[comp].push({
        date:     String(h['computed_date']),
        hit_rate: h['hit_rate'] != null ? Number(h['hit_rate']) : null,
        trend:    h['trend'] != null ? String(h['trend']) : null,
      })
    }

    const signals = rows.map(r => ({
      computed_date:       r['computed_date'],
      component_name:      r['component_name'],
      signal_direction:    r['signal_direction'],
      window_days:         Number(r['window_days']),
      regime_filter:       r['regime_filter'],
      quality_tier_filter: r['quality_tier_filter'],
      horizon_days:        Number(r['horizon_days']),
      n_predictions:       r['n_predictions'] != null ? Number(r['n_predictions']) : null,
      n_hits:              r['n_hits'] != null ? Number(r['n_hits']) : null,
      hit_rate:            r['hit_rate'] != null ? Number(r['hit_rate']) : null,
      avg_return:          r['avg_return'] != null ? Number(r['avg_return']) : null,
      ic:                  r['ic'] != null ? Number(r['ic']) : null,
      prior_hit_rate:      r['prior_hit_rate'] != null ? Number(r['prior_hit_rate']) : null,
      hit_rate_delta:      r['hit_rate_delta'] != null ? Number(r['hit_rate_delta']) : null,
      trend:               r['trend'],
      history:             history[String(r['component_name'])] ?? [],
    }))

    const improving  = signals.filter(s => s.trend === 'improving').map(s => s.component_name)
    const degrading  = signals.filter(s => s.trend === 'degrading').map(s => s.component_name)
    const stable     = signals.filter(s => s.trend === 'stable').map(s => s.component_name)

    res.json({
      signals,
      summary: {
        improving: [...new Set(improving)],
        degrading: [...new Set(degrading)],
        stable:    [...new Set(stable)],
      },
      meta: {
        window:    q.window,
        horizon:   q.horizon,
        direction: q.direction,
        component: q.component ?? null,
        regime:    q.regime ?? null,
        tier:      q.tier ?? null,
      },
    })
  } catch (err: unknown) {
    req.log?.error({ err }, 'research.signal-reliability failed')
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' })
  }
})


// ---------------------------------------------------------------------------
// GET /api/research/adaptive-recommendations
// Pending adaptive weight recommendations.
// ---------------------------------------------------------------------------
attributionRouter.get('/adaptive-recommendations', async (req, res) => {
  try {
    const schema = z.object({
      status:    z.enum(['pending', 'reviewed', 'promoted', 'rejected', 'all']).default('pending'),
      component: z.string().optional(),
      priority:  z.enum(['urgent', 'normal', 'low', 'all']).default('all'),
      days:      z.coerce.number().int().min(1).max(365).default(30),
    })

    const parsed = schema.safeParse(req.query)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid query params', details: parsed.error.issues })
      return
    }
    const q = parsed.data

    const conditions = ['generated_date >= CURRENT_DATE - $1 * INTERVAL \'1 day\'']
    const params: unknown[] = [q.days]
    let p = 2

    if (q.status !== 'all') {
      conditions.push(`status = $${p++}`)
      params.push(q.status)
    }
    if (q.component) {
      conditions.push(`component_name = $${p++}`)
      params.push(q.component)
    }
    if (q.priority !== 'all') {
      conditions.push(`priority = $${p++}`)
      params.push(q.priority)
    }

    const sql = `
      SELECT
        id,
        generated_date::text,
        component_name,
        recommendation,
        current_weight,
        suggested_weight,
        regime_filter,
        horizon_days,
        window_days,
        priority,
        rationale,
        evidence,
        status,
        reviewed_at::text,
        reviewed_by,
        promoted_at::text,
        rejection_reason,
        notes,
        created_at::text
      FROM adaptive_weight_recommendations
      WHERE ${conditions.join(' AND ')}
      ORDER BY
        CASE priority WHEN 'urgent' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
        generated_date DESC
    `

    const rows = await query<Record<string, unknown>>(sql, params)

    // Status counts
    const countSQL = `
      SELECT status, COUNT(*) AS n
      FROM adaptive_weight_recommendations
      WHERE generated_date >= CURRENT_DATE - $1 * INTERVAL '1 day'
      GROUP BY status
    `
    const countRows = await query<{ status: string; n: number }>(countSQL, [q.days])
    const counts: Record<string, number> = {}
    for (const cr of countRows) counts[cr.status] = Number(cr.n)

    res.json({
      recommendations: rows.map(r => ({
        id:                Number(r['id']),
        generated_date:    r['generated_date'],
        component_name:    r['component_name'],
        recommendation:    r['recommendation'],
        current_weight:    r['current_weight'] != null ? Number(r['current_weight']) : null,
        suggested_weight:  r['suggested_weight'] != null ? Number(r['suggested_weight']) : null,
        regime_filter:     r['regime_filter'],
        horizon_days:      r['horizon_days'] != null ? Number(r['horizon_days']) : null,
        window_days:       r['window_days'] != null ? Number(r['window_days']) : null,
        priority:          r['priority'],
        rationale:         r['rationale'],
        evidence:          r['evidence'],
        status:            r['status'],
        reviewed_at:       r['reviewed_at'],
        reviewed_by:       r['reviewed_by'],
        promoted_at:       r['promoted_at'],
        rejection_reason:  r['rejection_reason'],
        notes:             r['notes'],
        created_at:        r['created_at'],
      })),
      status_counts: counts,
      meta: {
        status:    q.status,
        component: q.component ?? null,
        priority:  q.priority,
        days:      q.days,
      },
    })
  } catch (err: unknown) {
    req.log?.error({ err }, 'research.adaptive-recommendations failed')
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' })
  }
})


// ---------------------------------------------------------------------------
// POST /api/research/adaptive-recommendations/:id/promote
// Mark a recommendation as promoted (human-reviewed and approved).
// ---------------------------------------------------------------------------
attributionRouter.post('/adaptive-recommendations/:id/promote', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) {
      res.status(400).json({ error: 'Invalid recommendation id' })
      return
    }

    const bodySchema = z.object({
      reviewed_by: z.string().default('api'),
      notes:       z.string().optional(),
    })
    const body = bodySchema.safeParse(req.body)
    if (!body.success) {
      res.status(400).json({ error: 'Invalid body', details: body.error.issues })
      return
    }

    const sql = `
      UPDATE adaptive_weight_recommendations
      SET status      = 'promoted',
          promoted_at = now(),
          reviewed_at = now(),
          reviewed_by = $2,
          notes       = COALESCE($3, notes)
      WHERE id = $1
        AND status = 'pending'
      RETURNING id, component_name, recommendation, status
    `
    const rows = await query<Record<string, unknown>>(sql,
      [id, body.data.reviewed_by, body.data.notes ?? null])

    if (!rows.length) {
      res.status(404).json({ error: 'Recommendation not found or not in pending status' })
      return
    }

    res.json({
      promoted: true,
      recommendation: rows[0],
      message: 'Recommendation promoted. Update the component weight in confluence engine to apply.',
    })
  } catch (err: unknown) {
    req.log?.error({ err }, 'research.promote-recommendation failed')
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' })
  }
})


// ---------------------------------------------------------------------------
// POST /api/research/adaptive-recommendations/:id/reject
// Reject a recommendation.
// ---------------------------------------------------------------------------
attributionRouter.post('/adaptive-recommendations/:id/reject', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) {
      res.status(400).json({ error: 'Invalid recommendation id' })
      return
    }

    const bodySchema = z.object({
      reason:      z.string().min(1),
      reviewed_by: z.string().default('api'),
    })
    const body = bodySchema.safeParse(req.body)
    if (!body.success) {
      res.status(400).json({ error: 'Invalid body', details: body.error.issues })
      return
    }

    const sql = `
      UPDATE adaptive_weight_recommendations
      SET status           = 'rejected',
          reviewed_at      = now(),
          reviewed_by      = $2,
          rejection_reason = $3
      WHERE id = $1
        AND status = 'pending'
      RETURNING id, component_name, recommendation, status
    `
    const rows = await query<Record<string, unknown>>(sql,
      [id, body.data.reviewed_by, body.data.reason])

    if (!rows.length) {
      res.status(404).json({ error: 'Recommendation not found or not in pending status' })
      return
    }

    res.json({ rejected: true, recommendation: rows[0] })
  } catch (err: unknown) {
    req.log?.error({ err }, 'research.reject-recommendation failed')
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' })
  }
})

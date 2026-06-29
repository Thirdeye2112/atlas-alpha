/**
 * research-alerts.ts
 * ------------------
 * Surfaces the daily all-methods setup scan (atlas_research.trade_alerts, written
 * by scripts/daily_scan.py) into atlas-alpha for display. Each alert carries its
 * mined base rate plus the operational plan (liquidity tier, predicted first-leg
 * target, add-the-dip level, pullback timing) from the deep-dive studies.
 *
 * REGISTRATION (in routes/index.ts):
 *   import { alertsResearchRouter } from './research-alerts.js'
 *   router.use('/research', alertsResearchRouter)
 *
 * Endpoints
 * ---------
 *   GET /api/research/alerts?date=YYYY-MM-DD&limit=60&min_conviction=0
 *     Alerts for a scan date (defaults to the latest), ranked by conviction.
 *   GET /api/research/alerts/dates
 *     Available scan dates (most recent first) with alert counts.
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
      console.error('[research-alerts] Pool error:', err.message)
    })
  }
  return _pool
}

async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const client = await getPool().connect()
  try {
    return (await client.query(sql, params)).rows as T[]
  } finally {
    client.release()
  }
}

const num = (v: unknown): number | null =>
  v == null || Number.isNaN(Number(v)) ? null : Number(v)

const ALERTS_SQL = `
  SELECT scan_date::text, ticker, method, name, direction,
         mr_score, confluence_n, above_ema200, rsi, cc_ret,
         base_n, base_avg_fwd5, base_win5, base_scope, conviction,
         needs_5m_confirm, explained_by,
         liq_tier, entry_px, exp_firstleg_pct, target_px, exp_firstleg_bars,
         retrace_frac, add_dip_px, exp_wholerun_pct
  FROM trade_alerts
  WHERE scan_date = $1
    AND conviction >= $2
  ORDER BY conviction DESC NULLS LAST
  LIMIT $3
`

const DATES_SQL = `
  SELECT scan_date::text AS scan_date, COUNT(*)::int AS n
  FROM trade_alerts
  GROUP BY scan_date
  ORDER BY scan_date DESC
  LIMIT 60
`

export const alertsResearchRouter = Router()

// GET /api/research/alerts/dates  — available scan dates + counts
alertsResearchRouter.get('/alerts/dates', async (_req, res) => {
  try {
    const rows = await query<{ scan_date: string; n: number }>(DATES_SQL)
    res.json({ available: rows.length > 0, dates: rows })
  } catch (err: unknown) {
    console.error('[research-alerts] dates failed:', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' })
  }
})

// GET /api/research/alerts?date=&limit=&min_conviction=
alertsResearchRouter.get('/alerts', async (req, res) => {
  try {
    // resolve scan date (explicit ?date= or the latest available)
    let date = typeof req.query['date'] === 'string' ? req.query['date'] : ''
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      const latest = await query<{ scan_date: string }>(
        'SELECT MAX(scan_date)::text AS scan_date FROM trade_alerts'
      )
      date = latest[0]?.scan_date ?? ''
    }
    if (!date) {
      res.json({ available: false, reason: 'No trade_alerts yet — run scripts/daily_scan.py', alerts: [] })
      return
    }

    const limit = Math.min(500, Math.max(1, Number(req.query['limit']) || 60))
    const minConv = Number(req.query['min_conviction']) || -1e9

    const rows = await query<Record<string, unknown>>(ALERTS_SQL, [date, minConv, limit])

    res.json({
      available: rows.length > 0,
      scan_date: date,
      count: rows.length,
      alerts: rows.map((r) => ({
        ticker: r['ticker'],
        method: r['method'],
        name: r['name'],
        direction: r['direction'],
        liq_tier: r['liq_tier'],
        mr_score: num(r['mr_score']),
        confluence_n: num(r['confluence_n']),
        above_ema200: num(r['above_ema200']) === 1,
        rsi: num(r['rsi']),
        cc_ret: num(r['cc_ret']),
        // operational plan (deep-dive studies)
        entry_px: num(r['entry_px']),
        target_px: num(r['target_px']),
        exp_firstleg_pct: num(r['exp_firstleg_pct']),
        exp_firstleg_bars: num(r['exp_firstleg_bars']),
        add_dip_px: num(r['add_dip_px']),
        retrace_frac: num(r['retrace_frac']),
        exp_wholerun_pct: num(r['exp_wholerun_pct']),
        // mined base rate
        base_scope: r['base_scope'],
        base_n: num(r['base_n']),
        base_avg_fwd5: num(r['base_avg_fwd5']),
        base_win5: num(r['base_win5']),
        conviction: num(r['conviction']),
        needs_5m_confirm: r['needs_5m_confirm'] === true,
        explained_by: r['explained_by'],
      })),
    })
  } catch (err: unknown) {
    console.error('[research-alerts] alerts failed:', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' })
  }
})

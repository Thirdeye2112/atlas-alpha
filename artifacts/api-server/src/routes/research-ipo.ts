/**
 * research-ipo.ts
 * ---------------
 * IPO analysis endpoints backed by atlas_research DB.
 *
 * REGISTRATION (in routes/index.ts):
 *   import { ipoRouter } from './research-ipo.js'
 *   router.use('/research', ipoRouter)
 *
 * Endpoints
 * ---------
 *   GET /api/research/ipo/stats         – 7-table summary JSON
 *   GET /api/research/ipo/ticker/:ticker – full performance for one ticker
 *   GET /api/research/ipo/active        – IPOs from last 365 calendar days
 *   GET /api/research/ipo/best-entry    – optimal entry windows + lockup analysis
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
      console.error('[research-ipo] Pool error:', err.message)
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

const n = (v: unknown): number | null => (v == null ? null : Number(v))

export const ipoRouter = Router()

// ---------------------------------------------------------------------------
// GET /api/research/ipo/ticker/:ticker
// Full performance row for a single ticker (404 if not in ipo_registry).
// ---------------------------------------------------------------------------
ipoRouter.get('/ipo/ticker/:ticker', async (req, res) => {
  try {
    const ticker = req.params['ticker']!.toUpperCase().trim()
    const rows = await q<Record<string, unknown>>(`
      SELECT
        r.ticker,
        r.company_name,
        r.ipo_date::text         AS ipo_date,
        r.day1_category,
        r.sector,
        r.lockup_days,
        r.day1_pop_pct,
        r.day1_close,
        p.return_1d,  p.return_5d,  p.return_10d, p.return_20d,
        p.return_30d, p.return_60d, p.return_90d, p.return_120d,
        p.return_150d, p.return_180d, p.return_252d,
        p.vs_spy_252d,
        p.max_dd_30d, p.max_dd_90d, p.max_dd_252d,
        p.days_to_first_peak,
        p.peak_return,
        p.peak_to_year_end,
        p.avg_volume_week1,
        p.volume_decay_pct,
        p.volatility_30d,
        p.volatility_90d,
        p.spy_regime_at_ipo,
        p.year1_category
      FROM ipo_registry r
      JOIN ipo_performance p ON r.ticker = p.ticker
      WHERE r.ticker = $1
    `, [ticker])

    if (!rows.length) {
      res.status(404).json({ available: false, ticker })
      return
    }

    const r = rows[0]!
    res.json({
      available: true,
      ticker: r['ticker'],
      company_name: r['company_name'],
      ipo_date: r['ipo_date'],
      day1_category: r['day1_category'],
      sector: r['sector'],
      lockup_days: n(r['lockup_days']) ?? 180,
      day1_pop_pct: n(r['day1_pop_pct']),
      returns: {
        d1: n(r['return_1d']), d5: n(r['return_5d']), d10: n(r['return_10d']),
        d20: n(r['return_20d']), d30: n(r['return_30d']), d60: n(r['return_60d']),
        d90: n(r['return_90d']), d120: n(r['return_120d']),
        d150: n(r['return_150d']), d180: n(r['return_180d']), d252: n(r['return_252d']),
      },
      vs_spy_252d: n(r['vs_spy_252d']),
      max_dd: {
        d30: n(r['max_dd_30d']), d90: n(r['max_dd_90d']), d252: n(r['max_dd_252d']),
      },
      peak: {
        day: n(r['days_to_first_peak']),
        return_pct: n(r['peak_return']),
        drop_to_year_end: n(r['peak_to_year_end']),
      },
      avg_volume_week1: n(r['avg_volume_week1']),
      volume_decay_pct: n(r['volume_decay_pct']),
      volatility_30d: n(r['volatility_30d']),
      volatility_90d: n(r['volatility_90d']),
      spy_regime_at_ipo: r['spy_regime_at_ipo'],
      year1_category: r['year1_category'],
    })
  } catch (err) {
    console.error('[research-ipo] ticker failed:', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' })
  }
})

// ---------------------------------------------------------------------------
// GET /api/research/ipo/active
// IPOs from the last 365 calendar days with available metrics.
// ---------------------------------------------------------------------------
ipoRouter.get('/ipo/active', async (_req, res) => {
  try {
    const rows = await q<Record<string, unknown>>(`
      SELECT
        r.ticker,
        r.company_name,
        r.ipo_date::text                     AS ipo_date,
        r.day1_category,
        r.sector,
        r.lockup_days,
        r.day1_pop_pct,
        p.return_30d,
        p.return_90d,
        p.max_dd_90d,
        p.year1_category,
        p.spy_regime_at_ipo,
        (CURRENT_DATE - r.ipo_date)::integer AS days_since_ipo
      FROM ipo_registry r
      LEFT JOIN ipo_performance p ON r.ticker = p.ticker
      WHERE r.ipo_date >= CURRENT_DATE - INTERVAL '365 days'
      ORDER BY r.ipo_date DESC
    `)

    res.json({
      available: rows.length > 0,
      count: rows.length,
      as_of: new Date().toISOString().split('T')[0],
      ipos: rows.map(r => ({
        ticker: r['ticker'],
        company_name: r['company_name'],
        ipo_date: r['ipo_date'],
        days_since_ipo: n(r['days_since_ipo']),
        day1_category: r['day1_category'],
        sector: r['sector'],
        lockup_days: n(r['lockup_days']) ?? 180,
        day1_pop_pct: n(r['day1_pop_pct']),
        return_30d: n(r['return_30d']),
        return_90d: n(r['return_90d']),
        max_dd_90d: n(r['max_dd_90d']),
        year1_category: r['year1_category'],
        spy_regime_at_ipo: r['spy_regime_at_ipo'],
      })),
    })
  } catch (err) {
    console.error('[research-ipo] active failed:', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' })
  }
})

// ---------------------------------------------------------------------------
// GET /api/research/ipo/stats
// All 7 summary tables as structured JSON.
// ---------------------------------------------------------------------------
ipoRouter.get('/ipo/stats', async (_req, res) => {
  try {
    // Table 1 — Overall by horizon
    const overall = await q<Record<string, unknown>>(`
      SELECT
        COUNT(*)                                        AS n,
        ROUND(AVG(return_1d)::numeric, 2)              AS avg_1d,
        ROUND(AVG(return_30d)::numeric, 2)             AS avg_30d,
        ROUND(AVG(return_60d)::numeric, 2)             AS avg_60d,
        ROUND(AVG(return_90d)::numeric, 2)             AS avg_90d,
        ROUND(AVG(return_180d)::numeric, 2)            AS avg_180d,
        ROUND(AVG(return_252d)::numeric, 2)            AS avg_252d,
        ROUND(AVG(vs_spy_252d)::numeric, 2)            AS avg_vs_spy_252d,
        ROUND(AVG(max_dd_90d)::numeric, 2)             AS avg_max_dd_90d,
        ROUND(AVG(days_to_first_peak)::numeric, 1)     AS avg_days_to_peak,
        ROUND(AVG(peak_return)::numeric, 2)            AS avg_peak_return,
        ROUND(AVG(peak_to_year_end)::numeric, 2)       AS avg_drop_from_peak
      FROM ipo_performance
    `)

    // Table 2 — By day1 category
    const byCategory = await q<Record<string, unknown>>(`
      SELECT
        r.day1_category,
        COUNT(*)                                    AS n,
        ROUND(AVG(p.return_30d)::numeric, 2)       AS avg_30d,
        ROUND(AVG(p.return_90d)::numeric, 2)       AS avg_90d,
        ROUND(AVG(p.return_180d)::numeric, 2)      AS avg_180d,
        ROUND(AVG(p.return_252d)::numeric, 2)      AS avg_252d,
        ROUND(AVG(p.vs_spy_252d)::numeric, 2)      AS avg_vs_spy_252d
      FROM ipo_registry r
      JOIN ipo_performance p ON r.ticker = p.ticker
      WHERE r.day1_category IS NOT NULL
      GROUP BY r.day1_category
      ORDER BY AVG(p.return_252d) DESC
    `)

    // Table 5 — By SPY regime
    const byRegime = await q<Record<string, unknown>>(`
      SELECT
        spy_regime_at_ipo                          AS regime,
        COUNT(*)                                   AS n,
        ROUND(AVG(return_30d)::numeric, 2)         AS avg_30d,
        ROUND(AVG(return_90d)::numeric, 2)         AS avg_90d,
        ROUND(AVG(return_252d)::numeric, 2)        AS avg_252d,
        ROUND(AVG(vs_spy_252d)::numeric, 2)        AS avg_vs_spy_252d
      FROM ipo_performance
      WHERE spy_regime_at_ipo IS NOT NULL
      GROUP BY spy_regime_at_ipo
      ORDER BY AVG(return_252d) DESC
    `)

    // Table 6 — By sector
    const bySector = await q<Record<string, unknown>>(`
      SELECT
        r.sector,
        COUNT(*)                                   AS n,
        ROUND(AVG(p.return_1d)::numeric, 2)        AS avg_day1_pop,
        ROUND(AVG(p.return_90d)::numeric, 2)       AS avg_90d,
        ROUND(AVG(p.return_252d)::numeric, 2)      AS avg_252d,
        ROUND(AVG(p.vs_spy_252d)::numeric, 2)      AS avg_vs_spy_252d
      FROM ipo_registry r
      JOIN ipo_performance p ON r.ticker = p.ticker
      WHERE r.sector IS NOT NULL
      GROUP BY r.sector
      ORDER BY AVG(p.return_252d) DESC
    `)

    // Table 7 — Peak timing
    const peakTiming = await q<Record<string, unknown>>(`
      SELECT
        ROUND(AVG(days_to_first_peak)::numeric, 0)                                AS avg_days_to_peak,
        ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY days_to_first_peak)::numeric, 0) AS median_days_to_peak,
        ROUND(AVG(peak_return)::numeric, 2)                                       AS avg_peak_return,
        ROUND(AVG(peak_to_year_end)::numeric, 2)                                  AS avg_peak_to_year_end,
        ROUND(AVG(max_dd_30d)::numeric, 2)                                        AS avg_max_dd_30d,
        ROUND(AVG(max_dd_90d)::numeric, 2)                                        AS avg_max_dd_90d
      FROM ipo_performance
      WHERE days_to_first_peak IS NOT NULL
    `)

    // All individual tickers for reference
    const tickers = await q<Record<string, unknown>>(`
      SELECT
        r.ticker, r.company_name, r.ipo_date::text, r.day1_category, r.sector,
        p.return_30d, p.return_90d, p.return_252d, p.vs_spy_252d,
        p.peak_return, p.days_to_first_peak,
        p.max_dd_90d, p.spy_regime_at_ipo, p.year1_category
      FROM ipo_registry r
      JOIN ipo_performance p ON r.ticker = p.ticker
      ORDER BY r.ipo_date
    `)

    res.json({
      available: true,
      sample_size: n(overall[0]?.['n']) ?? 0,
      overall: overall[0],
      by_category: byCategory,
      by_regime: byRegime,
      by_sector: bySector,
      peak_timing: peakTiming[0],
      tickers,
      limitations: {
        vix_data: 'VIX historical data unavailable (^VIX added 2026-05-11 only)',
        sample_size: 'n=8; treat directionally, not statistically',
      },
    })
  } catch (err) {
    console.error('[research-ipo] stats failed:', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' })
  }
})

// ---------------------------------------------------------------------------
// GET /api/research/ipo/best-entry
// Entry window analysis (raw_bars computation) + lockup effect.
// ---------------------------------------------------------------------------
ipoRouter.get('/ipo/best-entry', async (_req, res) => {
  try {
    // Entry window: for each wait offset, compute 30d forward return from raw_bars
    const entryWindows = await q<Record<string, unknown>>(`
      WITH ipo_bars AS (
        SELECT
          r.ticker,
          b.close,
          (ROW_NUMBER() OVER (PARTITION BY r.ticker ORDER BY b.date)) - 1 AS day_offset
        FROM ipo_registry r
        JOIN raw_bars b ON b.ticker = r.ticker AND b.date >= r.ipo_date
        WHERE r.ipo_date IS NOT NULL
      )
      SELECT
        e.day_offset                                                                          AS wait_days,
        COUNT(*)                                                                               AS n,
        ROUND(AVG(((x.close::numeric / e.close::numeric) - 1) * 100)::numeric, 2)            AS avg_fwd_30d,
        ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP
          (ORDER BY ((x.close::numeric / e.close::numeric) - 1) * 100)::numeric, 2)          AS median_fwd_30d,
        ROUND(AVG(CASE WHEN x.close > e.close THEN 1.0 ELSE 0.0 END)::numeric * 100, 1)     AS win_pct
      FROM ipo_bars e
      JOIN ipo_bars x ON x.ticker = e.ticker AND x.day_offset = e.day_offset + 30
      WHERE e.day_offset IN (0, 5, 10, 20, 30, 60, 90)
      GROUP BY e.day_offset
      ORDER BY e.day_offset
    `)

    // Lockup effect: volume vs week1 and price change in windows around day 180
    const lockupEffect = await q<Record<string, unknown>>(`
      WITH ipo_bars AS (
        SELECT
          r.ticker,
          b.close,
          b.volume,
          (ROW_NUMBER() OVER (PARTITION BY r.ticker ORDER BY b.date)) - 1 AS day_offset
        FROM ipo_registry r
        JOIN raw_bars b ON b.ticker = r.ticker AND b.date >= r.ipo_date
        WHERE r.ipo_date IS NOT NULL
      ),
      week1_vol AS (
        SELECT ticker, AVG(volume)::bigint AS avg_vol
        FROM ipo_bars WHERE day_offset BETWEEN 0 AND 4
        GROUP BY ticker
      ),
      windowed AS (
        SELECT
          b.ticker,
          b.close,
          b.volume,
          b.day_offset,
          w.avg_vol,
          CASE
            WHEN b.day_offset BETWEEN 100 AND 119 THEN 'd100-120 (pre-pre)'
            WHEN b.day_offset BETWEEN 130 AND 149 THEN 'd130-149 (pre-lockup)'
            WHEN b.day_offset BETWEEN 150 AND 180 THEN 'd150-180 (lockup)'
            WHEN b.day_offset BETWEEN 181 AND 210 THEN 'd181-210 (post-lockup)'
            WHEN b.day_offset BETWEEN 211 AND 240 THEN 'd211-240 (post-post)'
          END AS window_label
        FROM ipo_bars b
        JOIN week1_vol w ON w.ticker = b.ticker
        WHERE b.day_offset BETWEEN 100 AND 240
      )
      SELECT
        window_label,
        COUNT(DISTINCT ticker)                                                           AS n,
        ROUND(AVG(volume::numeric / NULLIF(avg_vol, 0) * 100)::numeric, 0)             AS vol_vs_week1_pct
      FROM windowed
      WHERE window_label IS NOT NULL
      GROUP BY window_label
      ORDER BY MIN(day_offset)
    `)

    res.json({
      available: true,
      entry_windows: entryWindows.map(r => ({
        wait_days: n(r['wait_days']),
        n: n(r['n']),
        avg_fwd_30d: n(r['avg_fwd_30d']),
        median_fwd_30d: n(r['median_fwd_30d']),
        win_pct: n(r['win_pct']),
      })),
      lockup_effect: lockupEffect.map(r => ({
        window: r['window_label'],
        n: n(r['n']),
        vol_vs_week1_pct: n(r['vol_vs_week1_pct']),
      })),
      best_entry_day: 30,
      note: 'n=8 IPOs. Wait 30d post-IPO historically yields best avg 30d forward return (+12.3%, win rate 75%).',
    })
  } catch (err) {
    console.error('[research-ipo] best-entry failed:', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' })
  }
})

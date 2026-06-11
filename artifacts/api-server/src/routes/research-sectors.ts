/**
 * research-sectors.ts
 * -------------------
 * Sector relative strength snapshot endpoint.
 *
 * REGISTRATION (in routes/index.ts):
 *   import { sectorsRouter } from './research-sectors.js'
 *   router.use('/research', sectorsRouter)
 *
 * Endpoints
 * ---------
 *   GET /api/research/sectors/snapshot
 *     Today's sector RS rankings, regime label, rotation signal.
 *
 *   GET /api/research/sectors/history/:ticker
 *     Historical RS rank for a sector ETF (last 60 trading days).
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
      console.error('[research-sectors] Pool error:', err.message)
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

// ── SQL ───────────────────────────────────────────────────────────────────────

const LATEST_SNAPSHOT_SQL = `
  SELECT
    s.date,
    s.sector_ticker,
    s.sector_name,
    s.rs_vs_spy_5d,
    s.rs_vs_spy_20d,
    s.rs_vs_spy_60d,
    s.rank_among_sectors,
    s.is_leading,
    s.is_lagging
  FROM sector_relative_strength s
  WHERE s.date = (
    SELECT MAX(date) FROM sector_relative_strength
  )
  ORDER BY s.rank_among_sectors ASC
`

const SECTOR_HISTORY_SQL = `
  SELECT
    date::text,
    rank_among_sectors,
    rs_vs_spy_5d,
    rs_vs_spy_20d,
    is_leading,
    is_lagging
  FROM sector_relative_strength
  WHERE sector_ticker = $1
  ORDER BY date DESC
  LIMIT 60
`

// ── Regime detection ──────────────────────────────────────────────────────────

type SectorRow = {
  date: Date
  sector_ticker: string
  sector_name: string
  rs_vs_spy_5d: number | null
  rs_vs_spy_20d: number | null
  rs_vs_spy_60d: number | null
  rank_among_sectors: number
  is_leading: boolean
  is_lagging: boolean
}

function detectRegime(sectors: SectorRow[]): {
  label: 'growth' | 'defensive' | 'inflation' | 'financial' | 'neutral'
  signal: string
  xlv_vs_xlk: number | null
} {
  const top3 = sectors.filter(s => s.rank_among_sectors <= 3).map(s => s.sector_ticker)
  const xlvRs = sectors.find(s => s.sector_ticker === 'XLV')?.rs_vs_spy_20d ?? null
  const xlkRs = sectors.find(s => s.sector_ticker === 'XLK')?.rs_vs_spy_20d ?? null
  const xleRs = sectors.find(s => s.sector_ticker === 'XLE')?.rs_vs_spy_20d ?? null
  const xlvVsXlk = xlvRs != null && xlkRs != null ? xlvRs - xlkRs : null

  const hasGrowth = top3.some(t => ['XLK', 'XLY'].includes(t))
  const hasDefensive = top3.some(t => ['XLV', 'XLP', 'XLU'].includes(t))
  const hasInflation = top3.some(t => ['XLE', 'XLB'].includes(t))
  const hasFinancial = top3.some(t => ['XLF'].includes(t))

  if (hasInflation && xleRs != null && xleRs > 0.02) {
    return { label: 'inflation', signal: 'Energy/Materials leading — inflation regime', xlv_vs_xlk: xlvVsXlk }
  }
  if (hasGrowth && !hasDefensive) {
    return { label: 'growth', signal: 'Technology/Discretionary leading — growth regime', xlv_vs_xlk: xlvVsXlk }
  }
  if (hasDefensive && !hasGrowth) {
    return { label: 'defensive', signal: 'Health Care/Staples/Utilities leading — defensive rotation', xlv_vs_xlk: xlvVsXlk }
  }
  if (hasFinancial && top3.length === 3 && top3.every(t => ['XLF', 'XLK', 'XLI'].includes(t))) {
    return { label: 'financial', signal: 'Financials/Tech/Industrials leading — steepening yield curve', xlv_vs_xlk: xlvVsXlk }
  }
  return { label: 'neutral', signal: 'Mixed sector leadership', xlv_vs_xlk: xlvVsXlk }
}

// ── Router ────────────────────────────────────────────────────────────────────

export const sectorsRouter = Router()

// ---------------------------------------------------------------------------
// GET /api/research/sectors/snapshot
// Today's sector RS rankings + regime classification.
// ---------------------------------------------------------------------------
sectorsRouter.get('/sectors/snapshot', async (_req, res) => {
  try {
    const sectors = await query<SectorRow>(LATEST_SNAPSHOT_SQL)

    if (!sectors.length) {
      res.json({ available: false, reason: 'No sector RS data — run compute_sector_rs.py' })
      return
    }

    const asOf = sectors[0].date
    const regime = detectRegime(sectors)

    const leaders = sectors
      .filter(s => s.is_leading)
      .map(s => ({
        ticker: s.sector_ticker,
        name: s.sector_name,
        rank: s.rank_among_sectors,
        rs_5d: s.rs_vs_spy_5d != null ? +s.rs_vs_spy_5d.toFixed(4) : null,
        rs_20d: s.rs_vs_spy_20d != null ? +s.rs_vs_spy_20d.toFixed(4) : null,
        rs_60d: s.rs_vs_spy_60d != null ? +s.rs_vs_spy_60d.toFixed(4) : null,
      }))

    const laggards = sectors
      .filter(s => s.is_lagging)
      .map(s => ({
        ticker: s.sector_ticker,
        name: s.sector_name,
        rank: s.rank_among_sectors,
        rs_5d: s.rs_vs_spy_5d != null ? +s.rs_vs_spy_5d.toFixed(4) : null,
        rs_20d: s.rs_vs_spy_20d != null ? +s.rs_vs_spy_20d.toFixed(4) : null,
        rs_60d: s.rs_vs_spy_60d != null ? +s.rs_vs_spy_60d.toFixed(4) : null,
      }))

    const all_sectors = sectors.map(s => ({
      ticker: s.sector_ticker,
      name: s.sector_name,
      rank: s.rank_among_sectors,
      rs_20d: s.rs_vs_spy_20d != null ? +s.rs_vs_spy_20d.toFixed(4) : null,
      is_leading: s.is_leading,
      is_lagging: s.is_lagging,
    }))

    res.json({
      available: true,
      as_of: asOf instanceof Date ? asOf.toISOString().split('T')[0] : String(asOf),
      regime: regime.label,
      rotation_signal: regime.signal,
      xlv_vs_xlk: regime.xlv_vs_xlk != null ? +regime.xlv_vs_xlk.toFixed(4) : null,
      leaders,
      laggards,
      all_sectors,
    })
  } catch (err: unknown) {
    console.error('[research-sectors] snapshot failed:', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' })
  }
})

// ---------------------------------------------------------------------------
// GET /api/research/sectors/history/:ticker
// Last 60 trading days of RS rank for a sector ETF.
// ---------------------------------------------------------------------------
sectorsRouter.get('/sectors/history/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase().trim()
    const rows = await query<{
      date: string
      rank_among_sectors: number
      rs_vs_spy_5d: number | null
      rs_vs_spy_20d: number | null
      is_leading: boolean
      is_lagging: boolean
    }>(SECTOR_HISTORY_SQL, [ticker])

    if (!rows.length) {
      res.status(404).json({ error: `No RS data for ${ticker}` })
      return
    }

    res.json({
      ticker,
      available: true,
      history: rows.map(r => ({
        date: r.date,
        rank: r.rank_among_sectors,
        rs_5d: r.rs_vs_spy_5d != null ? +Number(r.rs_vs_spy_5d).toFixed(4) : null,
        rs_20d: r.rs_vs_spy_20d != null ? +Number(r.rs_vs_spy_20d).toFixed(4) : null,
        is_leading: r.is_leading,
        is_lagging: r.is_lagging,
      })),
    })
  } catch (err: unknown) {
    console.error('[research-sectors] history failed:', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' })
  }
})

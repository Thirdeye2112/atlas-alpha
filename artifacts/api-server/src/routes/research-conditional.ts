/**
 * research-conditional.ts
 * -----------------------
 * Phase 4: Conditional probability context endpoints.
 *
 * Exposes atlas-research conditional backtest results as structured
 * context for the Atlas Alpha score panel.
 *
 * REGISTRATION (in routes/index.ts):
 *   import { conditionalRouter } from './research-conditional.js'
 *   router.use('/research', conditionalRouter)
 *
 * Endpoints
 * ---------
 *   GET /api/research/conditional/spy
 *     Current SPY streak length/direction + historical reversal outcomes.
 *
 *   GET /api/research/conditional/context/:ticker
 *     Active patterns for a ticker right now + historical per-ticker outcomes.
 *
 *   GET /api/research/conditional/pattern/:name
 *     Full pattern stats: aggregate + top/bottom tickers at 5d horizon.
 */

import { Router } from 'express'
import { Pool } from 'pg'

// ── Pool (atlas_research DB) ──────────────────────────────────────────────────

let _pool: Pool | null = null

function getPool(): Pool {
  if (!_pool) {
    const url = process.env['DATABASE_URL_RESEARCH']
    if (!url) throw new Error('DATABASE_URL_RESEARCH not set')
    _pool = new Pool({ connectionString: url, max: 3 })
    _pool.on('error', (err) => {
      console.error('[research-conditional] Pool error:', err.message)
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

// ── Helpers ───────────────────────────────────────────────────────────────────

interface BarRow {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

function computeStreak(barsDesc: BarRow[]): {
  direction: 'up' | 'down' | 'flat'
  days: number
  change_pct: number | null
} {
  if (barsDesc.length < 2) return { direction: 'flat', days: 0, change_pct: null }
  const latest = barsDesc[0]
  const prev = barsDesc[1]
  const isDown = Number(latest.close) < Number(prev.close)
  const isUp = Number(latest.close) > Number(prev.close)
  const change_pct = ((Number(latest.close) - Number(prev.close)) / Number(prev.close)) * 100

  if (!isDown && !isUp) return { direction: 'flat', days: 1, change_pct }

  const direction = isDown ? 'down' : 'up'
  let days = 1
  for (let i = 1; i < barsDesc.length - 1; i++) {
    const c0 = Number(barsDesc[i].close)
    const c1 = Number(barsDesc[i + 1].close)
    if (isDown && c0 < c1) { days++; continue }
    if (isUp && c0 > c1) { days++; continue }
    break
  }
  return { direction, days, change_pct }
}

function computeRSI(closesAsc: number[], period = 14): number | null {
  if (closesAsc.length < period + 1) return null
  let avgG = 0, avgL = 0
  for (let i = 1; i <= period; i++) {
    const d = closesAsc[i] - closesAsc[i - 1]
    if (d > 0) avgG += d; else avgL += -d
  }
  avgG /= period
  avgL /= period
  for (let i = period + 1; i < closesAsc.length; i++) {
    const d = closesAsc[i] - closesAsc[i - 1]
    avgG = (avgG * (period - 1) + (d > 0 ? d : 0)) / period
    avgL = (avgL * (period - 1) + (d < 0 ? -d : 0)) / period
  }
  if (avgL === 0) return 100
  return 100 - 100 / (1 + avgG / avgL)
}

interface ActiveCondition {
  pattern_name: string
  condition_type: string
  description: string
}

function detectActiveConditions(bars: BarRow[], high52w: number | null, low52w: number | null): ActiveCondition[] {
  const active: ActiveCondition[] = []
  if (bars.length < 6) return active

  // Closes sorted asc (oldest first) for RSI
  const closesAsc = [...bars].map(b => Number(b.close)).reverse()

  // Streak
  const streak = computeStreak(bars)
  if (streak.direction === 'down') {
    if (streak.days >= 3) active.push({ pattern_name: 'consecutive_down_3', condition_type: 'consecutive_down', description: `Down ${streak.days} day${streak.days > 1 ? 's' : ''} in a row` })
    if (streak.days >= 5) active.push({ pattern_name: 'consecutive_down_5', condition_type: 'consecutive_down', description: `Down ${streak.days} days in a row (strong)` })
  }
  if (streak.direction === 'up') {
    if (streak.days >= 3) active.push({ pattern_name: 'consecutive_up_3', condition_type: 'consecutive_up', description: `Up ${streak.days} day${streak.days > 1 ? 's' : ''} in a row` })
    if (streak.days >= 5) active.push({ pattern_name: 'consecutive_up_5', condition_type: 'consecutive_up', description: `Up ${streak.days} days in a row (strong)` })
  }

  // RSI (need 16+ bars)
  if (closesAsc.length >= 16) {
    const rsi = computeRSI(closesAsc)
    if (rsi != null) {
      if (rsi < 30) active.push({ pattern_name: 'oversold_rsi_30', condition_type: 'oversold_rsi', description: `RSI oversold (${rsi.toFixed(1)})` })
      else if (rsi < 35) active.push({ pattern_name: 'oversold_rsi_35', condition_type: 'oversold_rsi', description: `RSI approaching oversold (${rsi.toFixed(1)})` })
      if (rsi > 70) active.push({ pattern_name: 'overbought_rsi_70', condition_type: 'overbought_rsi', description: `RSI overbought (${rsi.toFixed(1)})` })
    }
  }

  // Gap (today's open vs yesterday's close)
  if (bars.length >= 2) {
    const todayOpen = Number(bars[0].open)
    const prevClose = Number(bars[1].close)
    if (prevClose > 0) {
      const gapPct = ((todayOpen - prevClose) / prevClose) * 100
      if (gapPct <= -2) active.push({ pattern_name: 'gap_down_2pct', condition_type: 'gap_down', description: `Gapped down ${Math.abs(gapPct).toFixed(1)}%` })
      if (gapPct <= -4) active.push({ pattern_name: 'gap_down_4pct', condition_type: 'gap_down', description: `Large gap down ${Math.abs(gapPct).toFixed(1)}%` })
    }
  }

  // 52w high/low
  const latestClose = Number(bars[0].close)
  if (low52w != null && low52w > 0) {
    const aboveLow = ((latestClose - low52w) / low52w) * 100
    if (aboveLow <= 5) active.push({ pattern_name: 'near_52w_low_5pct', condition_type: 'near_52w_low', description: `Near 52-week low (+${aboveLow.toFixed(1)}%)` })
  }
  if (high52w != null && high52w > 0) {
    const belowHigh = ((high52w - latestClose) / high52w) * 100
    if (belowHigh <= 5) active.push({ pattern_name: 'near_52w_high_5pct', condition_type: 'near_52w_high', description: `Near 52-week high (−${belowHigh.toFixed(1)}%)` })
  }

  // High volume (2x 20-day avg)
  if (bars.length >= 21) {
    const todayVol = Number(bars[0].volume)
    const avgVol = bars.slice(1, 21).reduce((s, b) => s + Number(b.volume), 0) / 20
    if (avgVol > 0 && todayVol >= 2 * avgVol) {
      active.push({ pattern_name: 'high_volume_2x', condition_type: 'high_volume', description: `High volume (${(todayVol / avgVol).toFixed(1)}× avg)` })
    }
  }

  return active
}

// ── SQL ───────────────────────────────────────────────────────────────────────

const SPY_BARS_SQL = `
  SELECT date::text, open, high, low, close, volume
  FROM raw_bars
  WHERE ticker = 'SPY'
  ORDER BY date DESC
  LIMIT 15
`

const CALENDAR_CONTEXT_SQL = `
  SELECT date::text AS event_date, event_type, description
  FROM market_calendar
  WHERE date BETWEEN CURRENT_DATE - INTERVAL '7 days'
                 AND CURRENT_DATE + INTERVAL '35 days'
  ORDER BY date ASC
`

const SPY_PATTERN_RESULTS_SQL = `
  SELECT
    cp.name            AS pattern_name,
    cp.condition_type,
    cp.condition_params,
    cpr.horizon_days,
    cpr.sample_size,
    cpr.hit_rate,
    cpr.avg_return,
    cpr.sharpe,
    cpr.p_value
  FROM conditional_pattern_results cpr
  JOIN conditional_patterns cp ON cp.id = cpr.pattern_id
  WHERE cp.universe = 'SPY'
    AND cpr.ticker = 'SPY'
    AND cp.name = ANY($1::text[])
  ORDER BY cp.name, cpr.horizon_days
`

const TICKER_BARS_SQL = `
  SELECT date::text, open, high, low, close, volume
  FROM raw_bars
  WHERE ticker = $1
  ORDER BY date DESC
  LIMIT 30
`

const TICKER_52W_SQL = `
  SELECT
    MAX(close) AS high_52w,
    MIN(close) AS low_52w
  FROM raw_bars
  WHERE ticker = $1
    AND date >= CURRENT_DATE - INTERVAL '252 days'
`

const TICKER_PATTERN_RESULTS_SQL = `
  SELECT
    cp.name            AS pattern_name,
    cp.condition_type,
    cpr.ticker,
    cpr.horizon_days,
    cpr.sample_size,
    cpr.hit_rate,
    cpr.avg_return,
    cpr.sharpe,
    cpr.p_value
  FROM conditional_pattern_results cpr
  JOIN conditional_patterns cp ON cp.id = cpr.pattern_id
  WHERE cp.name = ANY($1::text[])
    AND (cpr.ticker = $2 OR cpr.ticker IS NULL)
    AND cp.universe != 'SPY'
  ORDER BY cp.name, cpr.ticker NULLS LAST, cpr.horizon_days
`

const PATTERN_META_SQL = `
  SELECT id, name, condition_type, universe, condition_params, horizons, min_sample_size
  FROM conditional_patterns
  WHERE name = $1
`

const PATTERN_AGGREGATE_SQL = `
  SELECT
    cpr.horizon_days,
    cpr.sample_size,
    cpr.hit_rate,
    cpr.avg_return,
    cpr.median_return,
    cpr.sharpe,
    cpr.p_value
  FROM conditional_pattern_results cpr
  JOIN conditional_patterns cp ON cp.id = cpr.pattern_id
  WHERE cp.name = $1
    AND cpr.ticker IS NULL
  ORDER BY cpr.horizon_days
`

const PATTERN_TOP_TICKERS_SQL = `
  SELECT
    cpr.ticker,
    cpr.sample_size,
    cpr.hit_rate,
    cpr.avg_return,
    cpr.sharpe
  FROM conditional_pattern_results cpr
  JOIN conditional_patterns cp ON cp.id = cpr.pattern_id
  WHERE cp.name = $1
    AND cpr.ticker IS NOT NULL
    AND cpr.horizon_days = 5
    AND cpr.sample_size >= 10
  ORDER BY cpr.hit_rate DESC
  LIMIT 15
`

// ── Router ────────────────────────────────────────────────────────────────────

export const conditionalRouter = Router()

// ---------------------------------------------------------------------------
// GET /api/research/conditional/spy
// Current SPY streak + historical reversal odds from backtest data.
// ---------------------------------------------------------------------------
function buildCalendarContext(events: { event_date: string; event_type: string; description: string }[]) {
  const today = new Date(); today.setHours(0,0,0,0)

  // days_to_fomc: signed (negative = past)
  const fomcEvents = events.filter(e => e.event_type === 'fomc_meeting')
  let daysToFomc: number | null = null
  for (const e of fomcEvents) {
    const d = new Date(e.event_date); d.setHours(0,0,0,0)
    const diff = Math.round((d.getTime() - today.getTime()) / 86_400_000)
    if (daysToFomc === null || Math.abs(diff) < Math.abs(daysToFomc)) daysToFomc = diff
  }

  // is_opex_week: today's ISO week contains an options_expiry date
  const getMonday = (d: Date) => {
    const copy = new Date(d); copy.setHours(0,0,0,0)
    const day = copy.getDay(); const diff = (day === 0 ? -6 : 1 - day)
    copy.setDate(copy.getDate() + diff)
    return copy.toISOString().split('T')[0]
  }
  const todayMonday = getMonday(today)
  const isOpexWeek = events.some(e => e.event_type === 'options_expiry' && getMonday(new Date(e.event_date)) === todayMonday)
  const isTripleWitchingWeek = events.some(e => e.event_type === 'triple_witching' && getMonday(new Date(e.event_date)) === todayMonday)

  // is_month_end: today is in last 5 calendar days of month
  const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()
  const isMonthEnd = today.getDate() >= lastDay - 4

  // is_quarter_end
  const qEndMonths = [2, 5, 8, 11] // 0-indexed March/June/Sep/Dec
  const isQuarterEnd = qEndMonths.includes(today.getMonth()) && today.getDate() >= lastDay - 4

  // next upcoming event
  const future = events.filter(e => new Date(e.event_date) > today)
  const nextEvent = future.length ? {
    type: future[0].event_type,
    date: future[0].event_date,
    days_away: Math.round((new Date(future[0].event_date).getTime() - today.getTime()) / 86_400_000),
    description: future[0].description,
  } : null

  return { days_to_fomc: daysToFomc, is_opex_week: isOpexWeek, is_month_end: isMonthEnd, is_quarter_end: isQuarterEnd, is_triple_witching_week: isTripleWitchingWeek, next_event: nextEvent }
}

conditionalRouter.get('/conditional/spy', async (req, res) => {
  try {
    const [bars, calEvents] = await Promise.all([
      query<BarRow>(SPY_BARS_SQL),
      query<{ event_date: string; event_type: string; description: string }>(CALENDAR_CONTEXT_SQL).catch(() => []),
    ])
    if (!bars.length) {
      res.json({ available: false, reason: 'No SPY price data' })
      return
    }

    const streak = computeStreak(bars)
    const latest = bars[0]

    // Determine which SPY patterns match current streak
    const matchedPatterns: string[] = []
    if (streak.direction === 'down') {
      if (streak.days >= 4) matchedPatterns.push('spy_down_4d')
      if (streak.days >= 5) matchedPatterns.push('spy_down_5d')
    } else if (streak.direction === 'up') {
      if (streak.days >= 4) matchedPatterns.push('spy_up_4d')
      if (streak.days >= 5) matchedPatterns.push('spy_up_5d')
    }

    // Look up outcomes for matched patterns
    let outcomes: Record<string, unknown[]> = {}
    if (matchedPatterns.length) {
      const rows = await query<{
        pattern_name: string; condition_type: string; condition_params: Record<string, unknown>
        horizon_days: number; sample_size: number; hit_rate: number
        avg_return: number; sharpe: number | null; p_value: number | null
      }>(SPY_PATTERN_RESULTS_SQL, [matchedPatterns])

      for (const r of rows) {
        if (!outcomes[r.pattern_name]) outcomes[r.pattern_name] = []
        ;(outcomes[r.pattern_name] as unknown[]).push({
          horizon_days: r.horizon_days,
          sample_size: r.sample_size,
          hit_rate: r.hit_rate,
          avg_return: r.avg_return,
          sharpe: r.sharpe,
          p_value: r.p_value,
        })
      }
    }

    // Build best 5d outcome for summary
    let best5d: { hit_rate: number; avg_return: number; sample_size: number; pattern: string } | null = null
    for (const [patName, outs] of Object.entries(outcomes)) {
      const o5 = (outs as Array<{ horizon_days: number; hit_rate: number; avg_return: number; sample_size: number }>)
        .find(o => o.horizon_days === 5)
      if (o5 && (!best5d || o5.hit_rate > best5d.hit_rate)) {
        best5d = { hit_rate: o5.hit_rate, avg_return: o5.avg_return, sample_size: o5.sample_size, pattern: patName }
      }
    }

    const calendarContext = buildCalendarContext(calEvents)

    res.json({
      available: true,
      as_of: latest.date,
      spy_price: Number(latest.close),
      spy_change_pct: streak.change_pct,
      streak: {
        direction: streak.direction,
        days: streak.days,
        matched_patterns: matchedPatterns,
        active: matchedPatterns.length > 0,
      },
      best_5d: best5d,
      outcomes,
      calendar_context: calendarContext,
    })
  } catch (err: unknown) {
    console.error('[research-conditional] spy failed:', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' })
  }
})

// ---------------------------------------------------------------------------
// GET /api/research/conditional/context/:ticker
// Active conditions for a ticker right now + historical outcome stats.
// ---------------------------------------------------------------------------
conditionalRouter.get('/conditional/context/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase().trim()

    const [bars, range52w] = await Promise.all([
      query<BarRow>(TICKER_BARS_SQL, [ticker]),
      query<{ high_52w: number | null; low_52w: number | null }>(TICKER_52W_SQL, [ticker]),
    ])

    if (!bars.length) {
      res.json({ ticker, available: false, reason: 'No price data for this ticker' })
      return
    }

    const { high_52w, low_52w } = range52w[0] ?? { high_52w: null, low_52w: null }
    const activeConditions = detectActiveConditions(bars, high_52w, low_52w)

    if (!activeConditions.length) {
      res.json({
        ticker,
        available: true,
        as_of: bars[0].date,
        active_patterns: [],
        message: 'No notable patterns active for this ticker today',
      })
      return
    }

    const patternNames = [...new Set(activeConditions.map(c => c.pattern_name))]
    const resultRows = await query<{
      pattern_name: string; condition_type: string; ticker: string | null
      horizon_days: number; sample_size: number; hit_rate: number
      avg_return: number; sharpe: number | null; p_value: number | null
    }>(TICKER_PATTERN_RESULTS_SQL, [patternNames, ticker])

    // Build per-pattern result map
    const byPattern: Record<string, {
      ticker_outcomes: unknown[]
      aggregate_outcomes: unknown[]
    }> = {}

    for (const r of resultRows) {
      if (!byPattern[r.pattern_name]) byPattern[r.pattern_name] = { ticker_outcomes: [], aggregate_outcomes: [] }
      const entry = {
        horizon_days: r.horizon_days,
        sample_size: r.sample_size,
        hit_rate: r.hit_rate,
        avg_return: r.avg_return,
        sharpe: r.sharpe,
        p_value: r.p_value,
      }
      if (r.ticker === ticker) byPattern[r.pattern_name].ticker_outcomes.push(entry)
      else byPattern[r.pattern_name].aggregate_outcomes.push(entry)
    }

    const active_patterns = activeConditions.map(cond => ({
      pattern_name: cond.pattern_name,
      condition_type: cond.condition_type,
      description: cond.description,
      ticker_outcomes: byPattern[cond.pattern_name]?.ticker_outcomes ?? [],
      aggregate_outcomes: byPattern[cond.pattern_name]?.aggregate_outcomes ?? [],
    }))

    res.json({
      ticker,
      available: true,
      as_of: bars[0].date,
      active_patterns,
    })
  } catch (err: unknown) {
    console.error('[research-conditional] context failed:', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' })
  }
})

// ---------------------------------------------------------------------------
// GET /api/research/conditional/pattern/:name
// Full pattern stats: aggregate results + top-15 tickers at 5d horizon.
// ---------------------------------------------------------------------------
conditionalRouter.get('/conditional/pattern/:name', async (req, res) => {
  try {
    const name = req.params.name.toLowerCase().trim()

    const [meta, aggregate, topTickers] = await Promise.all([
      query<{
        id: number; name: string; condition_type: string; universe: string
        condition_params: Record<string, unknown>; horizons: number[]; min_sample_size: number
      }>(PATTERN_META_SQL, [name]),
      query<{
        horizon_days: number; sample_size: number; hit_rate: number
        avg_return: number; median_return: number; sharpe: number | null; p_value: number | null
      }>(PATTERN_AGGREGATE_SQL, [name]),
      query<{
        ticker: string; sample_size: number; hit_rate: number
        avg_return: number; sharpe: number | null
      }>(PATTERN_TOP_TICKERS_SQL, [name]),
    ])

    if (!meta.length) {
      res.status(404).json({ error: `Pattern '${name}' not found` })
      return
    }

    res.json({
      available: true,
      pattern: meta[0],
      aggregate_outcomes: aggregate,
      top_tickers: topTickers,
    })
  } catch (err: unknown) {
    console.error('[research-conditional] pattern failed:', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' })
  }
})

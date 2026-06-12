/**
 * targets.ts
 * ----------
 * ATR-based price targets (Stop / T1 / T2 / T3) for any ticker.
 *
 * Uses ohlcv_history from atlas_alpha DB (last 20 daily bars).
 * Direction derived from ML signal if available; falls back to BULLISH.
 *
 * GET /api/targets/:ticker
 */

import { Router } from 'express'
import { Pool } from 'pg'

const router = Router()

let _pool: Pool | null = null
function getPool(): Pool {
  if (!_pool) {
    const url = process.env['DATABASE_URL']
    if (!url) throw new Error('DATABASE_URL not set')
    _pool = new Pool({ connectionString: url, max: 3 })
    _pool.on('error', (err) => console.error('[targets] Pool error:', err.message))
  }
  return _pool
}

let _resPool: Pool | null = null
function getResPool(): Pool {
  if (!_resPool) {
    const url = process.env['DATABASE_URL_RESEARCH']
    if (!url) throw new Error('DATABASE_URL_RESEARCH not set')
    _resPool = new Pool({ connectionString: url, max: 2 })
  }
  return _resPool
}

async function query<T>(pool: Pool, sql: string, params: unknown[] = []): Promise<T[]> {
  const c = await pool.connect()
  try { return (await c.query(sql, params)).rows as T[] }
  finally { c.release() }
}

function computeATR(bars: { high: number; low: number; close: number }[]): number {
  if (bars.length < 2) return 0
  const trs: number[] = []
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1].close
    const { high, low } = bars[i]
    trs.push(Math.max(high - low, Math.abs(high - prev), Math.abs(low - prev)))
  }
  // Wilder EMA (period 14, or all available if fewer)
  const period = Math.min(14, trs.length)
  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period
  }
  return atr
}

router.get('/targets/:ticker', async (req, res): Promise<void> => {
  const ticker = (req.params['ticker'] ?? '').toUpperCase()
  if (!ticker) { res.status(400).json({ error: 'ticker required' }); return }

  try {
    // Fetch last 25 daily bars (need 25 for ATR14 warm-up)
    const bars = await query<{ date: string; open: number; high: number; low: number; close: number }>(
      getPool(),
      `SELECT date::text, open::float, high::float, low::float, close::float
       FROM ohlcv_history
       WHERE ticker = $1 AND interval = '1d'
       ORDER BY date DESC LIMIT 25`,
      [ticker]
    )

    if (bars.length < 5) {
      res.status(404).json({ available: false, ticker, reason: 'insufficient_history' })
      return
    }

    // Reverse to chronological order
    bars.reverse()

    const price = bars[bars.length - 1].close
    const atr14 = computeATR(bars)

    // 20-day swing high / low (last 20 bars)
    const window = bars.slice(-20)
    const swing_high_20d = Math.max(...window.map(b => b.high))
    const swing_low_20d  = Math.min(...window.map(b => b.low))

    // Try to get ML direction from atlas_research
    let direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL'
    try {
      const sig = await query<{ ml_direction: string }>(
        getResPool(),
        `SELECT ml_direction FROM predictions
         WHERE ticker = $1 AND date = (SELECT MAX(date) FROM predictions WHERE model_name='return_regressor')
         ORDER BY date DESC LIMIT 1`,
        [ticker]
      )
      if (sig.length > 0 && sig[0].ml_direction) {
        direction = sig[0].ml_direction as typeof direction
      }
    } catch { /* no research DB — use NEUTRAL */ }

    // Default to BULLISH if NEUTRAL for target calculation
    const isLong = direction !== 'BEARISH'

    const stop_dist = 0.75 * atr14
    const t1_dist   = 1.5  * atr14
    const t2_dist   = 3.0  * atr14
    const t3_dist   = 5.0  * atr14

    const sign = isLong ? 1 : -1

    const stop = price - sign * stop_dist
    const t1   = price + sign * t1_dist
    const t2   = price + sign * t2_dist
    const t3   = price + sign * t3_dist

    // Fibonacci T3 extension: swing_low + 2.618 × (swing_high - swing_low) for longs
    const fibRange = swing_high_20d - swing_low_20d
    const fib_t3 = isLong
      ? swing_low_20d  + 2.618 * fibRange
      : swing_high_20d - 2.618 * fibRange

    const pct = (target: number) => ((target - price) / price) * 100
    const rr  = (target: number) => Math.abs((target - price) / (price - stop))

    res.json({
      ticker,
      price,
      atr_14:          Math.round(atr14 * 100) / 100,
      direction:       isLong ? 'BULLISH' : 'BEARISH',
      stop:            Math.round(stop * 100) / 100,
      stop_pct:        Math.round(pct(stop) * 100) / 100,
      t1:              Math.round(t1 * 100) / 100,
      t1_pct:          Math.round(pct(t1) * 100) / 100,
      t1_rr:           Math.round(rr(t1) * 100) / 100,
      t2:              Math.round(t2 * 100) / 100,
      t2_pct:          Math.round(pct(t2) * 100) / 100,
      t2_rr:           Math.round(rr(t2) * 100) / 100,
      t3:              Math.round(t3 * 100) / 100,
      t3_pct:          Math.round(pct(t3) * 100) / 100,
      t3_rr:           Math.round(rr(t3) * 100) / 100,
      swing_high_20d:  Math.round(swing_high_20d * 100) / 100,
      swing_low_20d:   Math.round(swing_low_20d * 100) / 100,
      fib_t3:          Math.round(fib_t3 * 100) / 100,
      available:       true,
    })
  } catch (err) {
    console.error('[targets] Error:', err)
    res.status(500).json({ available: false, ticker, error: String(err) })
  }
})

export { router as targetsRouter }

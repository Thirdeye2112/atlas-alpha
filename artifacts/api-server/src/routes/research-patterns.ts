import { Router } from "express"
import { Pool } from "pg"

let _pool: Pool | null = null
function getPool(): Pool {
  if (!_pool) {
    const url = process.env["DATABASE_URL_RESEARCH"]
    if (!url) throw new Error("DATABASE_URL_RESEARCH not set")
    _pool = new Pool({ connectionString: url, max: 3 })
  }
  return _pool
}
async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const client = await getPool().connect()
  try { return (await client.query(sql, params)).rows as T[] }
  finally { client.release() }
}

export const patternStatsRouter = Router()

patternStatsRouter.get("/patterns/stats", async (req, res) => {
  try {
    const rows = await query(`
      SELECT pattern_name, direction, total_signals, with_outcomes,
        ROUND(mean_fwd_5d::numeric*100,3) AS mean_return_5d_pct,
        ROUND(std_fwd_5d::numeric*100,3)  AS std_return_5d_pct,
        ROUND(hit_rate_5d::numeric*100,1) AS hit_rate_5d_pct,
        ROUND(mean_fwd_1d::numeric*100,3) AS mean_return_1d_pct,
        ROUND(mean_fwd_10d::numeric*100,3) AS mean_return_10d_pct,
        first_signal, last_signal
      FROM pattern_outcome_stats
      WHERE with_outcomes > 10
      ORDER BY ABS(mean_fwd_5d) DESC NULLS LAST
    `)
    res.json({ count: rows.length, patterns: rows, generatedAt: new Date().toISOString() })
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" })
  }
})

patternStatsRouter.get("/patterns/stats/:pattern", async (req, res) => {
  try {
    const pattern = req.params.pattern.toLowerCase().trim()
    const rows = await query(`
      SELECT pattern_name, direction, total_signals, with_outcomes,
        ROUND(mean_fwd_5d::numeric*100,3) AS mean_return_5d_pct,
        ROUND(hit_rate_5d::numeric*100,1) AS hit_rate_5d_pct,
        first_signal, last_signal
      FROM pattern_outcome_stats WHERE LOWER(pattern_name) = $1
    `, [pattern])
    if (!rows.length) { res.json({ pattern_name: pattern, available: false }); return }
    res.json({ pattern_name: pattern, available: true, stats: rows })
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" })
  }
})

patternStatsRouter.get("/patterns/ticker/:ticker", async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase().trim()
    const rows = await query(`
      SELECT ps.signal_date, ps.pattern_name, ps.pattern_type, ps.direction,
        ps.strength_score, ps.fwd_return_5d, ps.fwd_return_1d, ps.fwd_return_10d,
        pos.total_signals AS pattern_total_signals,
        ROUND(pos.hit_rate_5d::numeric*100,1) AS pattern_hit_rate_pct,
        ROUND(pos.mean_fwd_5d::numeric*100,3) AS pattern_mean_return_pct
      FROM pattern_signals ps
      LEFT JOIN pattern_outcome_stats pos ON pos.pattern_name=ps.pattern_name AND pos.direction=ps.direction
      WHERE ps.ticker=$1 AND ps.signal_date >= CURRENT_DATE - INTERVAL '90 days'
      ORDER BY ps.signal_date DESC LIMIT 50
    `, [ticker])
    res.json({ ticker, count: rows.length, signals: rows })
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" })
  }
})

patternStatsRouter.get("/patterns/scan", async (req, res) => {
  try {
    const rows = await query(`
      SELECT ps.ticker, ps.signal_date, ps.pattern_name, ps.direction, ps.strength_score,
        ROUND(pos.hit_rate_5d::numeric*100,1) AS hit_rate_pct,
        ROUND(pos.mean_fwd_5d::numeric*100,3) AS mean_return_pct,
        pos.total_signals AS pattern_sample_size
      FROM pattern_signals ps
      LEFT JOIN pattern_outcome_stats pos ON pos.pattern_name=ps.pattern_name AND pos.direction=ps.direction
      WHERE ps.signal_date=(SELECT MAX(signal_date) FROM pattern_signals)
        AND (pos.total_signals IS NULL OR pos.total_signals>=10)
      ORDER BY pos.hit_rate_5d DESC NULLS LAST, ps.strength_score DESC
    `)
    res.json({ scan_date: rows[0]?.signal_date??null, count: rows.length, signals: rows })
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" })
  }
})
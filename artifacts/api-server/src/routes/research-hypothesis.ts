/**
 * research-hypothesis.ts
 * ----------------------
 * Concept Lab: natural language → hypothesis spec → backtest results.
 *
 * REGISTRATION (routes/index.ts):
 *   import { hypothesisRouter } from './research-hypothesis.js'
 *   router.use('/research', hypothesisRouter)
 *
 * Endpoints
 * ---------
 *   POST /api/research/hypothesis/test
 *     Body: { concept: string } → Claude parses to conditions-array spec, runs Python backtest
 *     Body: { spec: HypothesisSpec } → skips Claude (fallback form mode)
 *     Returns: { spec, results, narrative }
 *     Returns 400 { error, requiresKey: true } when ANTHROPIC_API_KEY absent and concept provided
 *
 *   GET /api/research/hypothesis/history
 *     Returns last 20 completed hypotheses from research_hypotheses table.
 */

import { Router } from 'express'
import { Pool } from 'pg'
import Anthropic from '@anthropic-ai/sdk'
import { spawn } from 'child_process'

// ── Pool ──────────────────────────────────────────────────────────────────────

let _pool: Pool | null = null

function getPool(): Pool {
  if (!_pool) {
    const url = process.env['DATABASE_URL_RESEARCH']
    if (!url) throw new Error('DATABASE_URL_RESEARCH not set')
    _pool = new Pool({ connectionString: url, max: 3 })
    _pool.on('error', (err) => {
      console.error('[research-hypothesis] Pool error:', err.message)
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

// ── Types ─────────────────────────────────────────────────────────────────────

interface Condition {
  type: string
  params: Record<string, number>
}

interface HypothesisSpec {
  ticker: string
  conditions: Condition[]
  direction: 'long' | 'short'
  horizons: number[]
  extracted_claim: string
}

interface HorizonResult {
  days: number
  n: number
  hit_rate: number
  avg_return: number  // percent (0.82 = 0.82%)
  p_value: number | null
}

interface BacktestResults {
  ticker: string
  conditions_desc: string
  sample_size: number
  horizons: HorizonResult[]
  yearly: Record<string, { hit_rate: number; n: number }>
  passed_permutation: boolean
  p_value: number | null
  narrative: string
}

// ── Claude prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a quantitative trading hypothesis parser. Convert a natural language trading concept into a structured, backtestable specification as JSON.

Output ONLY valid JSON with these exact fields:
{
  "ticker": "<TICKER — use SPY if not specified; always a real ticker symbol>",
  "conditions": [
    {"type": "<condition_type>", "params": {<params>}}
  ],
  "direction": "long or short",
  "horizons": [1, 5, 10, 20],
  "extracted_claim": "<one sentence plain English summary>"
}

Available condition types (use one or more; multiple conditions are AND-combined):
- consecutive_down: N consecutive down-close days. params: {"n": N}
- consecutive_up:   N consecutive up-close days.   params: {"n": N}
- rsi_below:        RSI < threshold.                params: {"threshold": T, "period": 14}
- rsi_above:        RSI > threshold.                params: {"threshold": T, "period": 14}
- price_above_sma:  Close > N-day SMA.              params: {"period": N}
- price_below_sma:  Close < N-day SMA.              params: {"period": N}
- jarvis_green:     ML model bullish signal.         params: {}
- jarvis_red:       ML model bearish signal.         params: {}
- gap_up:           Open >X% above prior close.      params: {"pct": X}
- gap_down:         Open >X% below prior close.      params: {"pct": X}
- volume_spike:     Volume > N× 20-day average.      params: {"multiplier": N}
- near_52w_high:    Close within X% of 52-week high. params: {"pct": X}
- near_52w_low:     Close within X% of 52-week low.  params: {"pct": X}
- nr7:              Narrowest range in last 7 bars.   params: {}
- inside_bar:       Bar range inside prior bar.       params: {}

No preamble. No explanation. JSON only.

Examples:
- "buy SPY when down 3 days in a row" → [{"type":"consecutive_down","params":{"n":3}}], long
- "short QQQ when RSI above 75"       → [{"type":"rsi_above","params":{"threshold":75}}], short
- "buy after 2% gap down and RSI<35"  → [gap_down pct=2, rsi_below threshold=35], long`

// ── Python runner ─────────────────────────────────────────────────────────────

const PYTHON_BIN    = 'C:\\Atlas\\atlas-research\\.venv\\Scripts\\python.exe'
const RUNNER_SCRIPT = 'C:\\Atlas\\atlas-research\\scripts\\run_hypothesis_test.py'

async function runBacktest(spec: HypothesisSpec): Promise<BacktestResults> {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON_BIN, [RUNNER_SCRIPT], {
      env: {
        ...process.env,
        DATABASE_URL: process.env['DATABASE_URL_RESEARCH'] ?? '',
        PYTHONUTF8: '1',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    child.stdin.write(JSON.stringify(spec))
    child.stdin.end()

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString('utf8') })
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString('utf8') })

    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('Backtest runner timed out after 60s'))
    }, 60_000)

    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        reject(new Error(`Runner exited ${code}: ${stderr.slice(0, 500)}`))
        return
      }
      try {
        resolve(JSON.parse(stdout) as BacktestResults)
      } catch {
        reject(new Error(`Runner output not valid JSON: ${stdout.slice(0, 300)}`))
      }
    })
  })
}

// ── Router ────────────────────────────────────────────────────────────────────

export const hypothesisRouter = Router()

hypothesisRouter.post('/hypothesis/test', async (req, res) => {
  try {
    const body = req.body as { concept?: string; spec?: HypothesisSpec }
    let spec: HypothesisSpec

    if (body.spec) {
      spec = body.spec
    } else if (body.concept) {
      const apiKey = process.env['ANTHROPIC_API_KEY']
      if (!apiKey) {
        return res.status(400).json({ error: 'ANTHROPIC_API_KEY not configured', requiresKey: true })
      }

      const client = new Anthropic({ apiKey })
      const msg = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 512,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: body.concept }],
      })

      const text = msg.content[0]?.type === 'text' ? msg.content[0].text : ''
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error('Claude did not return a valid JSON spec')
      spec = JSON.parse(jsonMatch[0]) as HypothesisSpec
    } else {
      return res.status(400).json({ error: 'concept or spec is required' })
    }

    const results = await runBacktest(spec)

    const hypothesisId = `hyp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const sourceText   = body.concept ?? spec.extracted_claim
    const condDesc     = results.conditions_desc
    await query(
      `INSERT INTO research_hypotheses
         (hypothesis_id, source_text, extracted_claim, market_object, condition, condition_params,
          horizons, direction, test_status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::integer[], $8, 'complete', NOW(), NOW())`,
      [
        hypothesisId,
        sourceText,
        spec.extracted_claim,
        spec.ticker,
        condDesc,
        JSON.stringify(spec.conditions),
        spec.horizons,
        spec.direction,
      ]
    )

    return res.json({ spec, results, narrative: results.narrative })
  } catch (err) {
    console.error('[research-hypothesis] POST /test error:', err)
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' })
  }
})

hypothesisRouter.get('/hypothesis/history', async (_req, res) => {
  try {
    const rows = await query<{
      hypothesis_id: string
      extracted_claim: string
      market_object: string
      condition: string
      direction: string
      test_status: string
      created_at: string
    }>(
      `SELECT hypothesis_id, extracted_claim, market_object, condition, direction, test_status, created_at
       FROM research_hypotheses
       ORDER BY created_at DESC
       LIMIT 20`
    )
    return res.json({ history: rows })
  } catch (err) {
    console.error('[research-hypothesis] GET /history error:', err)
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' })
  }
})

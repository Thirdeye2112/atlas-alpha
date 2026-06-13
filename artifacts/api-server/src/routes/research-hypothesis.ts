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
 *     Body: { concept: string } → Claude parses to spec, runs Python backtest
 *     Body: { spec: HypothesisSpec } → skips Claude (fallback form mode)
 *     Returns: { spec, results, narrative }
 *     Returns 400 { error, requiresKey: true } when ANTHROPIC_API_KEY missing and concept provided
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

interface HypothesisSpec {
  market_object: string
  condition: string
  condition_params: Record<string, number>
  direction: 'long' | 'short'
  horizons: number[]
  extracted_claim: string
}

interface BacktestResults {
  market_object: string
  condition: string
  n_signals: number
  horizons: Record<string, { n: number; hit_rate: number; avg_return: number; p_value: number | null }>
  yearly: Record<string, { hit_rate: number; n: number }>
  narrative: string
}

// ── Claude prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a quantitative trading hypothesis parser. Convert a natural language trading concept into a structured, backtestable specification as JSON.

Supported conditions:
- down_streak: N consecutive down-close days. params: {"days": N}
- up_streak: N consecutive up-close days. params: {"days": N}
- rsi_below: RSI below threshold. params: {"threshold": T, "period": 14}
- rsi_above: RSI above threshold. params: {"threshold": T, "period": 14}
- gap_down: Price gaps down >X% from prior close. params: {"pct": X}
- gap_up: Price gaps up >X% from prior close. params: {"pct": X}
- price_below_ma: Close below N-day SMA. params: {"period": N}
- price_above_ma: Close above N-day SMA. params: {"period": N}
- volume_spike: Volume > N× 20-day average. params: {"multiplier": N}

Output ONLY valid JSON with these exact fields:
{
  "market_object": "<TICKER — use SPY if unspecified; always a real ticker symbol>",
  "condition": "<one of the supported conditions above>",
  "condition_params": { <params for the condition> },
  "direction": "long or short",
  "horizons": [5, 10, 20],
  "extracted_claim": "<one sentence plain English summary of the hypothesis>"
}

No preamble. No explanation. JSON only.`

// ── Python runner ─────────────────────────────────────────────────────────────

const PYTHON_BIN    = 'C:\\Atlas\\atlas-research\\.venv\\Scripts\\python.exe'
const RUNNER_SCRIPT = 'C:\\Atlas\\atlas-research\\scripts\\research-hypothesis-runner.py'

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
    // source_text is NOT NULL — use concept or extracted_claim as the verbatim source for user-submitted hypotheses
    const sourceText = body.concept ?? spec.extracted_claim
    await query(
      `INSERT INTO research_hypotheses
         (hypothesis_id, source_text, extracted_claim, market_object, condition, condition_params,
          horizons, direction, test_status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::integer[], $8, 'complete', NOW(), NOW())`,
      [
        hypothesisId,
        sourceText,
        spec.extracted_claim,
        spec.market_object,
        spec.condition,
        JSON.stringify(spec.condition_params),
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

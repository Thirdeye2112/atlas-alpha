/**
 * useResearchAdvanced.ts
 * ----------------------
 * Typed React-Query client for the advanced atlas-research endpoints.
 *
 * Every hook is a thin read-only adapter over an existing backend route — it
 * maps the real response shape to the shape the UI components consume and
 * degrades gracefully (available:false / null) when the backend does not
 * supply a field. No scoring, ranking, or research formulas live here.
 *
 * Backend routes consumed:
 *   /api/research/confluence/:ticker
 *   /api/research/meta/:ticker
 *   /api/research/intraday/behavior/:ticker
 *   /api/research/intraday/similarity/:ticker   (research-ml.ts; 404 = no data)
 *   /api/research/template/eligible/:ticker
 *   /api/research/batch/enrichment?tickers=...
 *   /api/research/pipeline/health
 */

import { useQuery } from '@tanstack/react-query'

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '')

async function advFetch<T = any>(path: string): Promise<T> {
  const res = await fetch(`${BASE}/api/research/${path}`, {
    headers: { 'Content-Type': 'application/json' },
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json() as Promise<T>
}

/** Like advFetch but returns null on a non-2xx (used for endpoints that 404 when a ticker has no rows). */
async function advFetchOrNull<T = any>(path: string): Promise<T | null> {
  const res = await fetch(`${BASE}/api/research/${path}`, {
    headers: { 'Content-Type': 'application/json' },
  })
  if (!res.ok) return null
  return res.json() as Promise<T>
}

// ── Shared helpers ──────────────────────────────────────────────────────────

/** Convert a 0–1 backend percentile/rate to a 0–100 display scale. */
function toPct100(v: number | null | undefined): number | null {
  if (v == null) return null
  return v <= 1 ? v * 100 : v
}

function dirToSentiment(direction: string | null | undefined): string {
  const d = (direction ?? '').toLowerCase()
  if (d === 'long' || d === 'bull' || d === 'bullish') return 'bullish'
  if (d === 'short' || d === 'bear' || d === 'bearish') return 'bearish'
  return 'neutral'
}

function hoursSince(ts: string | null | undefined): number | null {
  if (!ts) return null
  const t = Date.parse(ts)
  if (Number.isNaN(t)) return null
  return (Date.now() - t) / 3_600_000
}

export function confluenceColor(score: number | null | undefined): string {
  if (score == null) return '#6b7280'
  if (score >= 75) return '#22c55e'
  if (score >= 55) return '#86efac'
  if (score >= 40) return '#f59e0b'
  return '#ef4444'
}

export function confluenceLabel(score: number | null | undefined): string {
  if (score == null) return '—'
  if (score >= 75) return 'Strong'
  if (score >= 55) return 'Moderate'
  if (score >= 40) return 'Weak'
  return 'Poor'
}

export function sentimentColor(sentiment: string | null | undefined): string {
  const s = (sentiment ?? '').toLowerCase()
  if (s === 'bullish') return '#22c55e'
  if (s === 'bearish') return '#ef4444'
  return '#6b7280'
}

export function fmtLift(lift: number | null | undefined): string {
  if (lift == null) return '—'
  const pct = lift * 100
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`
}

// ── Confluence ──────────────────────────────────────────────────────────────

export interface ConfluenceSignal {
  available: boolean
  confluence_score: number | null      // 0–100 display scale
  quality_tier: string | null
  component_scores: Record<string, number> | null
}

export function useConfluence(ticker: string | null | undefined) {
  const { data, isLoading } = useQuery({
    queryKey: ['research-confluence', ticker],
    queryFn: () => advFetch(`confluence/${ticker}`),
    enabled: !!ticker,
    staleTime: 60_000,
    retry: 1,
  })
  const score = toPct100(data?.confluence_score)
  const confluence: ConfluenceSignal = {
    available: !!data?.available && score != null,
    confluence_score: score,
    quality_tier: data?.quality_tier ?? data?.regime_gate ?? null,
    component_scores: data?.component_scores ?? null,
  }
  return { confluence, isLoading }
}

// ── Meta signal ─────────────────────────────────────────────────────────────

export interface MetaSignal {
  available: boolean
  expected_return_avg: number | null   // fraction (e.g. 0.012 = 1.2%)
  win_rate: number | null              // fraction
  top_20_pct: boolean
  combo_key: string | null
  composite_score: number | null
  n_signals: number | null
}

export function useMetaSignal(ticker: string | null | undefined) {
  const { data, isLoading } = useQuery({
    queryKey: ['research-meta', ticker],
    queryFn: () => advFetch(`meta/${ticker}`),
    enabled: !!ticker,
    staleTime: 120_000,
    retry: 1,
  })
  const meta: MetaSignal = {
    available: !!data?.available && (data?.expected_return != null || data?.combo_key != null),
    expected_return_avg: data?.expected_return ?? null,
    win_rate: null, // backend does not expose per-ticker win rate (combo cols are unpopulated)
    top_20_pct: data?.meta_filter_pass ?? false,
    combo_key: data?.combo_key ?? null,
    composite_score: data?.meta_score ?? null,
    n_signals: data?.combo_sample_size ?? null,
  }
  return { meta, isLoading }
}

// ── Intraday behavior ───────────────────────────────────────────────────────

export interface BehaviorEvent {
  label: string
  sentiment: string                    // 'bullish' | 'bearish' | 'neutral'
  hit_lift: number | null
  description: string | null
  confidence: number | null            // 0–1
}

export interface BehaviorSignal {
  available: boolean
  events: BehaviorEvent[]
}

export function useIntradayBehavior(ticker: string | null | undefined) {
  const { data, isLoading } = useQuery({
    queryKey: ['research-behavior', ticker],
    queryFn: () => advFetch(`intraday/behavior/${ticker}`),
    enabled: !!ticker,
    staleTime: 60_000,
    retry: 1,
  })
  const rows: any[] = data?.available ? (data.behaviors ?? []) : []
  const events: BehaviorEvent[] = rows.map((b) => ({
    label: b.behavior_id ?? b.category ?? 'behavior',
    sentiment: dirToSentiment(b.direction),
    hit_lift: b.hit_lift ?? null,
    description: b.category ?? null,
    confidence: b.intensity ?? null,
  }))
  const behavior: BehaviorSignal = { available: !!data?.available && events.length > 0, events }
  return { behavior, isLoading }
}

// ── Intraday similarity (historical analogues) ──────────────────────────────

export interface SimilarMatch {
  match_ticker: string
  match_date: string | null
  forward_return_5d: number | null
  behavior_label: string | null
}

export interface SimilaritySignal {
  available: boolean
  matches: SimilarMatch[]
}

export function useIntradaySimilarity(ticker: string | null | undefined) {
  const { data, isLoading } = useQuery({
    queryKey: ['research-similarity', ticker],
    queryFn: () => advFetchOrNull(`intraday/similarity/${ticker}`),
    enabled: !!ticker,
    staleTime: 60_000,
    retry: 1,
  })
  const rows: any[] = data?.top_match_summary ?? []
  const matches: SimilarMatch[] = rows.map((m) => ({
    match_ticker: m.ticker ?? '—',
    match_date: m.ts ?? null,
    forward_return_5d: m.ret6 ?? null,
    behavior_label: null,
  }))
  const similarity: SimilaritySignal = { available: !!data && matches.length > 0, matches }
  return { similarity, isLoading }
}

// ── Template eligibility ────────────────────────────────────────────────────

export interface TemplateSignal {
  eligible: boolean
  checks: { rank_ok: boolean; ic_ok: boolean; confluence_ok: boolean; meta_top20: boolean }
  data: { rank_percentile: number | null; probability_positive: number | null; mean_ic: number | null }
}

export function useTemplateEligible(ticker: string | null | undefined) {
  const { data, isLoading } = useQuery({
    queryKey: ['research-template-eligible', ticker],
    queryFn: () => advFetch(`template/eligible/${ticker}`),
    enabled: !!ticker,
    staleTime: 120_000,
    retry: 1,
  })
  const ed = data?.eligibility_detail
  const template: TemplateSignal = {
    eligible: data?.eligible ?? false,
    checks: {
      rank_ok: ed?.rank_ok ?? false,
      ic_ok: ed?.conf_ok ?? false,           // backend exposes a confidence gate, not a separate IC gate
      confluence_ok: false,                  // no per-ticker confluence gate in the backend
      meta_top20: ed?.combo_ok ?? false,
    },
    data: {
      rank_percentile: toPct100(data?.rank_percentile),
      probability_positive: data?.probability_positive ?? null,
      mean_ic: null,                         // not returned by the template endpoint
    },
  }
  return { template, isLoading }
}

// ── Batch enrichment ────────────────────────────────────────────────────────

export interface BatchEnrichmentResult {
  ticker: string
  rank_percentile: number | null           // 0–100 display scale
  probability_positive: number | null
  composite_score: number | null
  mean_ic: number | null
  combo_key: string | null
  confluence_score: number | null
  eligible: boolean
  top_20_pct: boolean
  rank_ok: boolean
  ic_ok: boolean
  confluence_ok: boolean
  meta_top20: boolean
}

export function useBatchEnrichment(tickers: string[]) {
  const param = tickers.join(',')
  const { data, isLoading, isError } = useQuery({
    queryKey: ['research-batch-enrichment', param],
    queryFn: () => advFetch(`batch/enrichment?tickers=${encodeURIComponent(param)}`),
    enabled: tickers.length > 0,
    staleTime: 120_000,
    retry: 1,
  })
  const rows: any[] = data?.available ? (data.tickers ?? []) : []
  // The batch endpoint returns raw prediction fields only; per-ticker gate flags
  // (eligible / top_20_pct / rank_ok / …) are not part of that payload, so they
  // default to false here. SignalExplanationPanel and IntelPanel use the
  // per-ticker template/meta/confluence hooks for accurate gate state.
  const items: BatchEnrichmentResult[] = rows.map((it) => ({
    ticker: it.ticker,
    rank_percentile: toPct100(it.rank_percentile),
    probability_positive: it.probability_positive ?? null,
    composite_score: it.meta_score ?? null,
    mean_ic: null,
    combo_key: it.combo_key ?? null,
    confluence_score: null,
    eligible: false,
    top_20_pct: false,
    rank_ok: false,
    ic_ok: false,
    confluence_ok: false,
    meta_top20: false,
  }))
  return { items, isLoading, isError }
}

// ── Pipeline health ─────────────────────────────────────────────────────────

export interface PipelineHealth {
  status: string
  healthy: boolean
  last_pred_date: string | null
  pred_age_hours: number | null
  pred_stale: boolean
  pred_tickers: number | null
  active_tickers: number | null
  last_bar_date: string | null
  bar_age_hours: number | null
  bar_stale: boolean
  mean_wf_ic: number | null
  last_run_at: string | null
  run_age_hours: number | null
  last_trained: string | null
}

// Staleness thresholds are display-only freshness hints, not research thresholds.
const PRED_STALE_H = 72
const BAR_STALE_H = 48

function mapHealth(d: any): PipelineHealth {
  const predAge = hoursSince(d.latest_prediction_date)
  const barAge = hoursSince(d.latest_candle_memory_ts)
  const runAge = hoursSince(d.latest_pipeline_run?.started_at)
  return {
    status: d.status ?? 'unknown',
    healthy: d.status === 'healthy',
    last_pred_date: d.latest_prediction_date ?? null,
    pred_age_hours: predAge,
    pred_stale: predAge != null && predAge > PRED_STALE_H,
    pred_tickers: d.prediction_count ?? null,
    active_tickers: null,
    last_bar_date: d.latest_candle_memory_ts ?? null,
    bar_age_hours: barAge,
    bar_stale: barAge != null && barAge > BAR_STALE_H,
    mean_wf_ic: null,
    last_run_at: d.latest_pipeline_run?.started_at ?? null,
    run_age_hours: runAge,
    last_trained: null,
  }
}

export function usePipelineHealth(enabled = true) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['research-pipeline-health'],
    queryFn: () => advFetch('pipeline/health'),
    enabled,
    staleTime: 60_000,
    refetchInterval: 120_000,
    retry: 1,
  })
  const health: PipelineHealth | null = data && data.available ? mapHealth(data) : null
  return { health, isLoading, isError }
}

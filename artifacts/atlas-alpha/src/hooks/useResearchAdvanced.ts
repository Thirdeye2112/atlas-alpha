import { useQuery } from '@tanstack/react-query'

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '')

async function advFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}/api/research/${path}`, {
    headers: { 'Content-Type': 'application/json' },
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json() as Promise<T>
}

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface AdvancedAvailable {
  available: true
}
export interface AdvancedUnavailable {
  available: false
  reason?: string
  detail?: string
}

// ---------------------------------------------------------------------------
// Confluence
// ---------------------------------------------------------------------------

export interface ConfluenceData extends AdvancedAvailable {
  ticker: string
  setups: Record<string, unknown>[]
  // The fields below are present only when at least one setup row exists.
  confluence_score?: number | null
  direction?: string | null
  regime_gate?: string | null
  time_gate?: string | null
  similarity_return_6?: number | null
  similarity_hitrate?: number | null
  updated_at?: string | null
}

export type ConfluenceResult = ConfluenceData | AdvancedUnavailable

export function useConfluence(ticker: string | null) {
  return useQuery<ConfluenceResult>({
    queryKey: ['research-confluence', ticker],
    queryFn: () => advFetch<ConfluenceResult>(`confluence/${ticker}`),
    enabled: !!ticker,
    staleTime: 60_000,
    retry: 1,
  })
}

// ---------------------------------------------------------------------------
// Meta Filter
// ---------------------------------------------------------------------------

export interface MetaData extends AdvancedAvailable {
  ticker: string
  date: string | null
  expected_return: number | null
  probability_positive: number | null
  confidence: number | null
  rank_percentile: number | null
  combo_key: string | null
  meta_score: number | null
  combo_status: string | null
  combo_pf_60d: number | null
  combo_expectancy_60d: number | null
  meta_filter_pass: boolean
}

export type MetaResult = MetaData | AdvancedUnavailable

export function useMeta(ticker: string | null) {
  return useQuery<MetaResult>({
    queryKey: ['research-meta', ticker],
    queryFn: () => advFetch<MetaResult>(`meta/${ticker}`),
    enabled: !!ticker,
    staleTime: 120_000,
    retry: 1,
  })
}

// ---------------------------------------------------------------------------
// Behavior layer
// ---------------------------------------------------------------------------

export interface BehaviorItem {
  behavior_id: string
  intensity: number
  event_date: string
  category: string
  direction: string
  intraday_weight: number
  hit_lift: number | null
  hit_rate_with: number | null
  expectancy_with: number | null
  is_informative: boolean | null
}

export interface BehaviorData extends AdvancedAvailable {
  ticker: string
  event_date: string | null
  behaviors: BehaviorItem[]
  dominant_behavior: BehaviorItem | null
  expected_direction: 'BULLISH' | 'BEARISH' | 'MIXED' | 'NEUTRAL'
  direction_confidence: 'HIGH' | 'MODERATE' | 'LOW'
  bullish_count: number
  bearish_count: number
  informative_count: number
}

export type BehaviorResult = BehaviorData | AdvancedUnavailable

export function useBehavior(ticker: string | null) {
  return useQuery<BehaviorResult>({
    queryKey: ['research-behavior', ticker],
    queryFn: () => advFetch<BehaviorResult>(`intraday/behavior/${ticker}`),
    enabled: !!ticker,
    staleTime: 60_000,
    retry: 1,
  })
}

// ---------------------------------------------------------------------------
// Template eligibility
// ---------------------------------------------------------------------------

export interface TemplateData extends AdvancedAvailable {
  ticker: string
  eligible: boolean
  reason?: string
  confidence: number | null
  rank_percentile: number | null
  combo_key: string | null
  meta_score: number | null
  combo_status: string | null
  active_patterns: string[]
  eligibility_detail: { conf_ok: boolean; rank_ok: boolean; combo_ok: boolean }
}

export type TemplateResult = TemplateData | AdvancedUnavailable

export function useTemplateEligible(ticker: string | null) {
  return useQuery<TemplateResult>({
    queryKey: ['research-template-eligible', ticker],
    queryFn: () => advFetch<TemplateResult>(`template/eligible/${ticker}`),
    enabled: !!ticker,
    staleTime: 120_000,
    retry: 1,
  })
}

// ---------------------------------------------------------------------------
// Batch enrichment
// ---------------------------------------------------------------------------

export interface EnrichmentItem {
  ticker: string
  date: string | null
  expected_return: number | null
  probability_positive: number | null
  confidence: number | null
  rank_percentile: number | null
  combo_key: string | null
  meta_score: number | null
  combo_status: string | null
  behaviors: { behavior_id: string; direction: string; intensity: number }[]
}

export interface BatchEnrichmentData extends AdvancedAvailable {
  tickers: EnrichmentItem[]
}

export type BatchEnrichmentResult = BatchEnrichmentData | AdvancedUnavailable

export function useBatchEnrichment(tickers: string[]) {
  const param = tickers.join(',')
  return useQuery<BatchEnrichmentResult>({
    queryKey: ['research-batch-enrichment', param],
    queryFn: () => advFetch<BatchEnrichmentResult>(`batch/enrichment?tickers=${encodeURIComponent(param)}`),
    enabled: tickers.length > 0,
    staleTime: 120_000,
    retry: 1,
  })
}

// ---------------------------------------------------------------------------
// Pipeline health
// ---------------------------------------------------------------------------

export interface TableChecks {
  [tableName: string]: boolean
}

export interface PipelineHealthData extends AdvancedAvailable {
  status: 'healthy' | 'degraded' | 'critical'
  checked_at: string
  tables: TableChecks
  missing_tables: string[]
  latest_prediction_date: string | null
  prediction_count: number
  latest_pipeline_run: Record<string, unknown> | null
  latest_behavior_date: string | null
  latest_candle_memory_ts: string | null
}

export type PipelineHealthResult = PipelineHealthData | AdvancedUnavailable

export function usePipelineHealth(enabled = true) {
  return useQuery<PipelineHealthResult>({
    queryKey: ['research-pipeline-health'],
    queryFn: () => advFetch<PipelineHealthResult>('pipeline/health'),
    enabled,
    staleTime: 60_000,
    refetchInterval: 120_000,
    retry: 1,
  })
}

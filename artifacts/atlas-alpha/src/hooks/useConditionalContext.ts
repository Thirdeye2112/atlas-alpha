import { useQuery } from '@tanstack/react-query'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ConditionalOutcome {
  horizon_days: number
  sample_size: number
  hit_rate: number
  avg_return: number
  sharpe: number | null
  p_value: number | null
}

export interface ActivePattern {
  pattern_name: string
  condition_type: string
  description: string
  ticker_outcomes: ConditionalOutcome[]
  aggregate_outcomes: ConditionalOutcome[]
}

export interface TickerContext {
  ticker: string
  available: boolean
  as_of: string | null
  active_patterns: ActivePattern[]
  message?: string
}

export interface SPYStreakInfo {
  direction: 'up' | 'down' | 'flat'
  days: number
  matched_patterns: string[]
  active: boolean
}

export interface SPYBest5d {
  hit_rate: number
  avg_return: number
  sample_size: number
  pattern: string
}

export interface SPYContext {
  available: boolean
  as_of: string | null
  spy_price: number | null
  spy_change_pct: number | null
  streak: SPYStreakInfo | null
  best_5d: SPYBest5d | null
  outcomes: Record<string, ConditionalOutcome[]>
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

const EMPTY_CONTEXT: TickerContext = {
  ticker: '', available: false, as_of: null, active_patterns: [],
}

const EMPTY_SPY: SPYContext = {
  available: false, as_of: null, spy_price: null, spy_change_pct: null,
  streak: null, best_5d: null, outcomes: {},
}

async function fetchTickerContext(ticker: string): Promise<TickerContext> {
  const res = await fetch(`/api/research/conditional/context/${ticker}`)
  if (!res.ok) return { ...EMPTY_CONTEXT, ticker }
  return res.json()
}

async function fetchSPYContext(): Promise<SPYContext> {
  const res = await fetch('/api/research/conditional/spy')
  if (!res.ok) return EMPTY_SPY
  return res.json()
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

export function useConditionalContext(ticker: string | null | undefined) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['conditional-context', ticker],
    queryFn: () => fetchTickerContext(ticker!),
    enabled: !!ticker,
    staleTime: 10 * 60 * 1000,
    retry: 1,
  })
  return {
    context: data ?? { ...EMPTY_CONTEXT, ticker: ticker ?? '' },
    isLoading,
    isError,
    available: data?.available ?? false,
    activePatterns: data?.active_patterns ?? [],
  }
}

export function useSPYContext() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['spy-context'],
    queryFn: fetchSPYContext,
    staleTime: 10 * 60 * 1000,
    retry: 1,
  })
  return {
    spyContext: data ?? EMPTY_SPY,
    isLoading,
    isError,
    streakActive: (data?.streak?.active ?? false) && (data?.streak?.days ?? 0) >= 3,
  }
}

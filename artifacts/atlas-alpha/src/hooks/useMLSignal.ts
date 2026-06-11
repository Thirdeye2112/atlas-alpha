import { useQuery } from '@tanstack/react-query'

export type MLSignalStrength = 'STRONG' | 'MODERATE' | 'WEAK' | 'NEUTRAL'
export type MLDirection = 'BULLISH' | 'BEARISH' | 'NEUTRAL'

export interface MLSignal {
  ticker: string; date: string | null
  ml_rank_percentile: number | null; ml_expected_return_5d: number | null
  ml_probability_positive: number | null; ml_confidence: number | null
  ml_expected_drawdown: number | null; ml_signal_strength: MLSignalStrength
  ml_direction: MLDirection; wf_mean_ic: number | null
  regime_note: string | null; available: boolean
  omni_green: boolean | null; omni_distance_pct: number | null; omni_slope: number | null
}

const NEUTRAL = (t: string): MLSignal => ({
  ticker: t, date: null, ml_rank_percentile: null, ml_expected_return_5d: null,
  ml_probability_positive: null, ml_confidence: null, ml_expected_drawdown: null,
  ml_signal_strength: 'NEUTRAL', ml_direction: 'NEUTRAL', wf_mean_ic: null,
  regime_note: null, available: false,
  omni_green: null, omni_distance_pct: null, omni_slope: null,
})

async function fetchSignal(ticker: string): Promise<MLSignal> {
  const res = await fetch(`/api/research/signal/${ticker}`)
  return res.ok ? res.json() : NEUTRAL(ticker)
}

async function fetchSignals(tickers: string[]) {
  const res = await fetch(`/api/research/signals?tickers=${tickers.join(',')}`)
  return res.ok ? res.json() : { date: null, count: 0, signals: [] }
}

async function fetchHistory(ticker: string) {
  const res = await fetch(`/api/research/signal/${ticker}/history`)
  return res.ok ? res.json() : { ticker, count: 0, history: [] }
}

export function useMLSignal(ticker: string | null | undefined) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['ml-signal', ticker],
    queryFn: () => fetchSignal(ticker!),
    enabled: !!ticker, staleTime: 5 * 60 * 1000, retry: 1,
  })
  return { signal: data ?? NEUTRAL(ticker ?? ''), isLoading, isError, available: data?.available ?? false }
}

export function useMLSignals(tickers: string[]) {
  const key = tickers.slice().sort().join(',')
  const { data, isLoading } = useQuery({
    queryKey: ['ml-signals', key],
    queryFn: () => fetchSignals(tickers),
    enabled: tickers.length > 0, staleTime: 5 * 60 * 1000, retry: 1,
  })
  const map = new Map((data?.signals ?? []).map((s: MLSignal) => [s.ticker, s]))
  return { signals: data?.signals ?? [], signalMap: map, isLoading,
           getSignal: (t: string) => map.get(t) ?? NEUTRAL(t) }
}

export function useMLSignalHistory(ticker: string | null | undefined) {
  const { data, isLoading } = useQuery({
    queryKey: ['ml-signal-history', ticker],
    queryFn: () => fetchHistory(ticker!),
    enabled: !!ticker, staleTime: 60 * 60 * 1000, retry: 1,
  })
  return { history: data?.history ?? [], count: data?.count ?? 0, isLoading }
}

export const signalColor = (s: MLSignalStrength) =>
  ({ STRONG: '#22c55e', MODERATE: '#f59e0b', WEAK: '#94a3b8', NEUTRAL: '#475569' }[s])

export const directionArrow = (d: MLDirection) =>
  ({ BULLISH: '↑', BEARISH: '↓', NEUTRAL: '→' }[d])

export const formatRank = (p: number | null) => p == null ? '—' : `${Math.round(p)}th`

export const formatExpReturn = (r: number | null) =>
  r == null ? '—' : `${((Math.exp(r) - 1) * 100) >= 0 ? '+' : ''}${((Math.exp(r) - 1) * 100).toFixed(1)}%`
/**
 * BotTemplateSignals — paper-trade-only signals panel for BotLab.
 *
 * Shows prediction enrichment and behavior signals for all open
 * paper-trade positions. Read-only; no trading actions.
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useBatchEnrichment, usePipelineHealth } from '../hooks/useResearchAdvanced'

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '')

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}/api/${path}`, {
    headers: { 'Content-Type': 'application/json' },
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json() as Promise<T>
}

interface PaperTrade {
  id: number
  ticker: string
  entryPrice: number
  entryScore: number
  entryDirection: string
  status: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function confidenceColor(c: number | null) {
  if (c == null) return '#6b7280'
  if (c >= 0.7)  return '#22c55e'
  if (c >= 0.5)  return '#86efac'
  if (c >= 0.35) return '#fbbf24'
  return '#ef4444'
}

function directionIcon(d: string | null) {
  if (!d) return '—'
  if (d.toUpperCase() === 'BULLISH' || d === 'bull') return '▲'
  if (d.toUpperCase() === 'BEARISH' || d === 'bear') return '▼'
  return '—'
}

function fmtPct(v: number | null | undefined) {
  if (v == null) return '—'
  return `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`
}

function fmtNum(v: number | null | undefined, dp = 1) {
  if (v == null) return '—'
  return v.toFixed(dp)
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

interface SignalRowProps {
  item: ReturnType<typeof useBatchEnrichment>['data'] extends { tickers: infer T[] } ? T : never
  entryDirection: string
}

function SignalRow({ item, entryDirection }: SignalRowProps) {
  const bullBehaviors = item.behaviors.filter((b) => b.direction === 'BULLISH')
  const bearBehaviors = item.behaviors.filter((b) => b.direction === 'BEARISH')
  const behaviorSummary =
    item.behaviors.length === 0 ? 'none'
    : `${bullBehaviors.length}↑ ${bearBehaviors.length}↓`

  const alignedWithEntry =
    item.confidence !== null && item.confidence >= 0.5
      ? (entryDirection === 'bull' && (item.expected_return ?? 0) > 0) ||
        (entryDirection === 'bear' && (item.expected_return ?? 0) < 0)
      : null

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '72px 64px 64px 72px 60px 80px',
      alignItems: 'center',
      padding: '5px 8px',
      borderBottom: '1px solid #1e2533',
      fontFamily: 'monospace',
      fontSize: 11,
      gap: 4,
    }}>
      <span style={{ fontWeight: 600, color: '#e5e7eb' }}>{item.ticker}</span>

      <span style={{ color: item.expected_return != null && item.expected_return > 0 ? '#22c55e' : '#ef4444' }}>
        {fmtPct(item.expected_return)}
      </span>

      <span style={{ color: '#9ca3af' }}>
        {item.probability_positive != null ? `${Math.round(item.probability_positive * 100)}%` : '—'}
      </span>

      <span style={{ color: confidenceColor(item.confidence) }}>
        {item.confidence != null ? `${Math.round(item.confidence * 100)}%` : '—'}
      </span>

      <span style={{ color: '#9ca3af' }}>
        {item.rank_percentile != null ? `${fmtNum(item.rank_percentile)}%ile` : '—'}
      </span>

      <span style={{ color: '#6b7280' }}>
        {behaviorSummary}
        {alignedWithEntry === true && (
          <span style={{ color: '#22c55e', marginLeft: 4 }}>✓</span>
        )}
        {alignedWithEntry === false && (
          <span style={{ color: '#f59e0b', marginLeft: 4 }}>!</span>
        )}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function BotTemplateSignals() {
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: trades = [] } = useQuery<PaperTrade[]>({
    queryKey: ['bot-trades'],
    queryFn:  () => apiFetch<PaperTrade[]>('bot/trades?status=all'),
    staleTime: 30_000,
  })

  const openTrades = trades.filter((t) => t.status === 'open')
  const openTickers = [...new Set(openTrades.map((t) => t.ticker))].slice(0, 20)

  const { data: enrichment, isLoading: enrichLoading } = useBatchEnrichment(openTickers)
  const { data: health } = usePipelineHealth()

  const enrichItems = enrichment?.available ? enrichment.tickers : []

  const tradesByTicker = Object.fromEntries(
    openTrades.map((t) => [t.ticker, t])
  )

  return (
    <div style={{ fontFamily: 'monospace', color: '#d1d5db' }}>
      {/* Header strip */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 12px',
        borderBottom: '1px solid #1e2533',
        background: '#0f1623',
      }}>
        <div style={{ fontWeight: 700, fontSize: 12, color: '#e5e7eb' }}>
          ⚡ SIGNALS
          <span style={{ color: '#4b5563', fontWeight: 400, marginLeft: 8, fontSize: 10 }}>
            read-only · paper trade enrichment
          </span>
        </div>

        {health?.available && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            fontSize: 10,
            color: health.status === 'healthy' ? '#22c55e' : '#f59e0b',
          }}>
            <span style={{
              display: 'inline-block',
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: health.status === 'healthy' ? '#22c55e' : '#f59e0b',
            }} />
            {health.status}
            {health.latest_prediction_date && (
              <span style={{ color: '#4b5563', marginLeft: 4 }}>
                {health.latest_prediction_date}
              </span>
            )}
          </div>
        )}
      </div>

      {/* No open positions */}
      {openTickers.length === 0 && (
        <div style={{ padding: 24, textAlign: 'center', color: '#4b5563', fontSize: 11 }}>
          No open paper positions. Open positions appear here with live signal enrichment.
        </div>
      )}

      {/* Backend unavailable */}
      {openTickers.length > 0 && enrichment && !enrichment.available && (
        <div style={{
          padding: '8px 12px',
          background: '#1c1010',
          borderBottom: '1px solid #3b1010',
          color: '#f87171',
          fontSize: 10,
        }}>
          Research backend unavailable — enrichment data not loaded.
          {enrichment.detail && <span style={{ color: '#6b7280', marginLeft: 6 }}>{enrichment.detail}</span>}
        </div>
      )}

      {/* Column headers */}
      {openTickers.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: '72px 64px 64px 72px 60px 80px',
          padding: '4px 8px',
          borderBottom: '1px solid #1e2533',
          fontSize: 9,
          color: '#4b5563',
          gap: 4,
          background: '#0f1623',
        }}>
          <span>TICKER</span>
          <span>EXP RET</span>
          <span>PROB+</span>
          <span>CONF</span>
          <span>RANK</span>
          <span>BEHAVIOR</span>
        </div>
      )}

      {/* Loading */}
      {enrichLoading && openTickers.length > 0 && (
        <div style={{ padding: 12, color: '#6b7280', fontSize: 10 }}>
          Loading enrichment…
        </div>
      )}

      {/* Rows */}
      {enrichItems.map((item) => (
        <div key={item.ticker}>
          <div
            onClick={() => setExpanded(expanded === item.ticker ? null : item.ticker)}
            style={{ cursor: 'pointer' }}
          >
            <SignalRow
              item={item}
              entryDirection={tradesByTicker[item.ticker]?.entryDirection ?? ''}
            />
          </div>

          {/* Expanded behavior detail */}
          {expanded === item.ticker && item.behaviors.length > 0 && (
            <div style={{
              background: '#090e18',
              padding: '8px 16px',
              borderBottom: '1px solid #1e2533',
              fontSize: 10,
              color: '#9ca3af',
            }}>
              <div style={{ fontWeight: 600, color: '#e5e7eb', marginBottom: 6, fontSize: 11 }}>
                Active behaviors — {item.ticker}
              </div>
              {item.behaviors.map((b) => (
                <div key={b.behavior_id} style={{
                  display: 'flex',
                  gap: 12,
                  marginBottom: 3,
                  color: b.direction === 'BULLISH' ? '#86efac' : b.direction === 'BEARISH' ? '#fca5a5' : '#9ca3af',
                }}>
                  <span style={{ width: 180 }}>{b.behavior_id}</span>
                  <span>{b.direction} {directionIcon(b.direction)}</span>
                  <span>intensity {b.intensity.toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      {/* Tickers with no prediction */}
      {openTickers.filter((t) => !enrichItems.find((e) => e.ticker === t)).map((t) => (
        <div key={t} style={{
          display: 'grid',
          gridTemplateColumns: '72px 1fr',
          padding: '5px 8px',
          borderBottom: '1px solid #1e2533',
          fontSize: 11,
          color: '#4b5563',
          gap: 4,
        }}>
          <span style={{ fontWeight: 600 }}>{t}</span>
          <span>no prediction available</span>
        </div>
      ))}

      {/* Footer note */}
      {openTickers.length > 0 && (
        <div style={{
          padding: '6px 12px',
          fontSize: 9,
          color: '#374151',
          borderTop: '1px solid #1e2533',
        }}>
          Click a row to expand behavior detail. ✓ = signal aligned with entry. ! = signal diverges from entry direction.
          Paper trade only — no live orders.
        </div>
      )}
    </div>
  )
}

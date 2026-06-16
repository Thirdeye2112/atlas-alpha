/**
 * BotTemplateSignals — paper-trade-only signals panel for BotLab.
 *
 * Shows ML enrichment for all open paper-trade positions.
 * Read-only; no trading actions.
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useBatchEnrichment, usePipelineHealth, type BatchEnrichmentResult, type PipelineHealth } from '../hooks/useResearchAdvanced'

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '')

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}/api/${path}`, { headers: { 'Content-Type': 'application/json' } })
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

// ── Palette ───────────────────────────────────────────────────────────────────
const BG0  = '#0f1623'
const BG1  = '#090e18'
const BD   = '#1e2533'
const G    = '#22c55e'
const R    = '#ef4444'
const AM   = '#f59e0b'
const DIM  = '#4b5563'
const MUT  = '#6b7280'
const HI   = '#e5e7eb'

// ── Helpers ───────────────────────────────────────────────────────────────────

function Dot({ color }: { color: string }) {
  return <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0 }} />
}

function fmtPct(v: number | null | undefined) {
  if (v == null) return '—'
  const x = v * 100
  return `${x >= 0 ? '+' : ''}${x.toFixed(1)}%`
}

function rankColor(r: number | null) {
  if (r == null) return MUT
  if (r >= 75) return G
  if (r >= 50) return AM
  return MUT
}

// ── Status header ─────────────────────────────────────────────────────────────

function HeaderStrip({ health }: { health: PipelineHealth | null }) {
  const sc = !health ? MUT : health.healthy ? G : health.status === 'degraded' ? AM : R
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderBottom: `1px solid ${BD}`, background: BG0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 12, color: HI }}>⚡ SIGNALS</span>
        <span style={{ color: DIM, fontSize: 10 }}>read-only · paper trade enrichment</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10 }}>
        {health && <Dot color={sc} />}
        <span style={{ color: sc, fontWeight: 600 }}>{health ? health.status.toUpperCase() : 'CONNECTING…'}</span>
        {health?.last_pred_date && <span style={{ color: DIM }}>preds: {health.last_pred_date}</span>}
        {health?.pred_stale && <span style={{ color: AM, fontSize: 9 }}>stale</span>}
      </div>
    </div>
  )
}

// ── Column headers ────────────────────────────────────────────────────────────
const COLS = '70px 60px 60px 70px 55px 60px'

function ColumnHeaders() {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: COLS, padding: '4px 12px', gap: 4,
      fontSize: 9, color: DIM, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
      borderBottom: `1px solid ${BD}`, background: BG0,
    }}>
      <span>Ticker</span>
      <span>Rank</span>
      <span>P(+)</span>
      <span>Meta Score</span>
      <span>Win %</span>
      <span>Template</span>
    </div>
  )
}

// ── Signal row ────────────────────────────────────────────────────────────────

function SignalRow({
  item,
  expanded,
  onToggle,
}: {
  item: BatchEnrichmentResult
  expanded: boolean
  onToggle: () => void
}) {
  const hasDetail = item.combo_key != null

  return (
    <>
      <div
        onClick={hasDetail ? onToggle : undefined}
        style={{
          display: 'grid', gridTemplateColumns: COLS, gap: 4,
          padding: '6px 12px', alignItems: 'center',
          borderBottom: `1px solid ${BD}`, fontFamily: 'monospace', fontSize: 11,
          cursor: hasDetail ? 'pointer' : 'default',
          background: expanded ? BG1 : 'transparent',
        }}
      >
        <span style={{ fontWeight: 700, color: HI }}>
          {item.ticker}
          {hasDetail && <span style={{ color: DIM, marginLeft: 3, fontSize: 9 }}>{expanded ? '▲' : '▼'}</span>}
        </span>

        <span style={{ color: rankColor(item.rank_percentile) }}>
          {item.rank_percentile != null ? `${Math.round(item.rank_percentile)}%ile` : '—'}
        </span>

        <span style={{ color: item.probability_positive != null && item.probability_positive >= 0.55 ? G : MUT }}>
          {item.probability_positive != null ? `${Math.round(item.probability_positive * 100)}%` : '—'}
        </span>

        <span style={{ color: item.composite_score != null ? (item.composite_score >= 0 ? G : R) : MUT }}>
          {item.composite_score != null ? item.composite_score.toFixed(2) : '—'}
        </span>

        <span style={{ color: MUT }}>
          {fmtPct(item.mean_ic)}
        </span>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {item.eligible && <span title="Template eligible" style={{ color: G }}>⚡</span>}
          {item.top_20_pct && (
            <span style={{
              fontSize: 8, fontWeight: 800, padding: '1px 3px', borderRadius: 2,
              color: G, background: 'rgba(34,197,94,0.10)', border: '1px solid rgba(34,197,94,0.26)',
            }}>F</span>
          )}
          {!item.eligible && !item.top_20_pct && <span style={{ color: DIM }}>—</span>}
        </div>
      </div>

      {expanded && item.combo_key && (
        <div style={{ background: BG1, padding: '8px 16px 10px', borderBottom: `1px solid ${BD}` }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: HI, marginBottom: 5, fontFamily: 'monospace' }}>
            Pattern detail — {item.ticker}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', fontSize: 10, fontFamily: 'monospace' }}>
            <div><span style={{ color: DIM }}>Combo key </span><span style={{ color: '#9ca3af', fontSize: 9 }}>{item.combo_key}</span></div>
            <div><span style={{ color: DIM }}>Rank check </span><span style={{ color: item.rank_ok ? G : MUT }}>{item.rank_ok ? '✓' : '✗'}</span></div>
            <div><span style={{ color: DIM }}>IC check </span><span style={{ color: item.ic_ok ? G : MUT }}>{item.ic_ok ? '✓' : '✗'}</span></div>
            <div><span style={{ color: DIM }}>Confluence </span><span style={{ color: item.confluence_ok ? G : MUT }}>{item.confluence_ok ? '✓' : '✗'}</span></div>
            <div><span style={{ color: DIM }}>Meta top 20 </span><span style={{ color: item.meta_top20 ? G : MUT }}>{item.meta_top20 ? '✓' : '✗'}</span></div>
            {item.confluence_score != null && (
              <div><span style={{ color: DIM }}>CF score </span><span style={{ color: '#9ca3af' }}>{Math.round(item.confluence_score)}</span></div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

function NoPredRow({ ticker }: { ticker: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '70px 1fr', padding: '6px 12px', borderBottom: `1px solid ${BD}`, fontSize: 11, fontFamily: 'monospace', gap: 4 }}>
      <span style={{ fontWeight: 700, color: DIM }}>{ticker}</span>
      <span style={{ color: DIM }}>no prediction available</span>
    </div>
  )
}

function LoadingSkeleton() {
  return (
    <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {[1, 2, 3].map(i => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: COLS, gap: 4 }}>
          {[45, 40, 35, 55, 35, 30].map((w, j) => (
            <div key={j} style={{ height: 10, borderRadius: 3, background: 'rgba(255,255,255,0.04)', width: `${w + i * 4}%` }} />
          ))}
        </div>
      ))}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function BotTemplateSignals() {
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: trades = [] } = useQuery<PaperTrade[]>({
    queryKey: ['bot-trades'],
    queryFn:  () => apiFetch<PaperTrade[]>('bot/trades?status=all'),
    staleTime: 30_000,
  })

  const openTrades  = trades.filter(t => t.status === 'open')
  const openTickers = [...new Set(openTrades.map(t => t.ticker))].slice(0, 20)

  const { items, isLoading: enrichLoading, isError: enrichError } = useBatchEnrichment(openTickers)
  const { health } = usePipelineHealth()

  const enrichMap = new Map(items.map(i => [i.ticker, i]))
  const toggle = (t: string) => setExpanded(prev => prev === t ? null : t)

  return (
    <div style={{ fontFamily: 'monospace', color: '#d1d5db', display: 'flex', flexDirection: 'column', height: '100%' }}>
      <HeaderStrip health={health} />

      {openTickers.length === 0 && (
        <div style={{ padding: '32px 24px', textAlign: 'center', color: DIM, fontSize: 11 }}>
          <div style={{ marginBottom: 6, fontSize: 20 }}>📭</div>
          No open paper positions.
          <div style={{ marginTop: 4, fontSize: 10 }}>Open positions appear here with live signal enrichment.</div>
        </div>
      )}

      {enrichError && openTickers.length > 0 && (
        <div style={{ padding: '7px 12px', background: 'rgba(239,68,68,0.06)', borderBottom: `1px solid rgba(239,68,68,0.2)`, color: '#f87171', fontSize: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Dot color={R} />
          Research backend unavailable — enrichment data not loaded.
        </div>
      )}

      {openTickers.length > 0 && (
        <>
          <ColumnHeaders />
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {enrichLoading && <LoadingSkeleton />}
            {!enrichLoading && items.map(item => (
              <SignalRow
                key={item.ticker}
                item={item}
                expanded={expanded === item.ticker}
                onToggle={() => toggle(item.ticker)}
              />
            ))}
            {!enrichLoading && openTickers
              .filter(t => !enrichMap.has(t))
              .map(t => <NoPredRow key={t} ticker={t} />)}
          </div>
        </>
      )}

      {openTickers.length > 0 && (
        <div style={{ padding: '5px 12px', fontSize: 9, color: '#374151', borderTop: `1px solid ${BD}`, background: BG0 }}>
          Click a row to expand pattern detail. <span style={{ color: G }}>⚡</span> = template eligible. <span style={{ color: G }}>F</span> = meta top 20%. Paper trade only.
        </div>
      )}
    </div>
  )
}

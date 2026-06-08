/**
 * ResearchLab.tsx — Research Lab page for Atlas Alpha (Phase 2 iteration)
 * -------------------------------------------------------------------------
 * PLACEMENT: artifacts/api-client-react/src/pages/ResearchLab.tsx
 *
 * Changes from Phase 1:
 *  - Q1: Champion combined view as default; Advanced model selector
 *  - Q2: 90-day lightweight-charts v5 P(+) sparkline in ticker drawer
 *  - Q3: Health strip shows "Latest IC / WF Mean IC" dual metric
 *
 * lightweight-charts v5 API (from Atlas Alpha review doc):
 *   chart.addSeries(LineSeries, opts)   — NOT addLineSeries()
 *   createSeriesMarkers(series, markers)
 *   All series data must be sorted ascending by time.
 *
 * No trading actions. No training buttons. No agent controls. Read-only.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'

// ─── lightweight-charts v5 imports ───────────────────────────────────────────
// Atlas Alpha already has this as a dependency (used in Dashboard.tsx).
import {
  createChart,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type LineData,
} from 'lightweight-charts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Prediction {
  ticker:               string
  date:                 string
  model_name:           string
  model_version:        string
  expected_return:      number | null
  probability_positive: number | null
  expected_drawdown:    number | null
  confidence:           number | null
  rank_percentile:      number | null
}

interface PredictionsResponse {
  date:        string | null
  model:       string
  predictions: Prediction[]
  count:       number
}

interface TickerHistoryResponse {
  ticker:      string
  model:       string
  history:     Prediction[]
  latestLabel: { return_5d: number | null; positive_5d: boolean | null; date: string } | null
  count:       number
  series: {
    prob:  { time: string; value: number }[]  // P(+) 0–100
    ret:   { time: string; value: number }[]  // Expected return %
    rank:  { time: string; value: number }[]  // Rank percentile 0–100
  }
}

interface ModelMetrics {
  id:             number
  model_name:     string
  model_version:  string
  target:         string
  horizon:        number | null
  training_start: string | null
  training_end:   string | null
  auc:            number | null
  brier:          number | null
  ic:             number | null
  rank_ic:        number | null
  sharpe:         number | null
  promoted:       boolean
  created_at:     string
  notes:          string | null
}

interface FoldSummary {
  model_version:  string
  target:         string
  horizon:        number | null
  n_folds:        number
  mean_rank_ic:   number | null
  std_rank_ic:    number | null
  mean_auc:       number | null
  mean_brier:     number | null
  mean_sharpe:    number | null
}

interface ResearchRun {
  id:                 number
  run_type:           string
  started_at:         string
  finished_at:        string | null
  status:             string
  tickers_processed:  number
  bars_inserted:      number
  features_generated: number
  labels_generated:   number
  error_message:      string | null
}

interface MetricsResponse {
  coverage: {
    raw_bars: number; tickers: number; feature_rows: number
    labeled_rows: number; first_bar: string; last_bar: string
    label_coverage_pct: number
  } | null
  today: {
    pred_date: string; n_predictions: number
    mean_prob: number | null; pct_bullish: number | null
  } | null
  // Q3: dual IC fields
  champion: {
    model_name:      string
    model_version:   string
    latest_rank_ic:  number | null   // Most recent model's IC
    wf_mean_rank_ic: number | null   // Mean IC across all folds (robustness metric)
    wf_std_rank_ic:  number | null
    wf_n_folds:      number | null
    auc:             number | null
    brier:           number | null
    training_end:    string | null
  } | null
  lastRun: {
    run_type: string; status: string
    started_at: string; tickers_processed: number
  } | null
  topFeatures: { feature_name: string; mean_ic: number; n_folds: number }[]
  generatedAt: string
}

// Q1: model selector options
type ModelMode = 'champion' | 'return' | 'probability' | 'drawdown'
const MODEL_OPTIONS: { value: ModelMode; label: string; desc: string }[] = [
  { value: 'champion',    label: '◈ Champion',    desc: 'Combined regressor + classifier' },
  { value: 'return',      label: '↗ Return',       desc: 'Expected 5-day return (regressor)' },
  { value: 'probability', label: '% Probability',  desc: 'P(positive 5D) (classifier)' },
  { value: 'drawdown',    label: '↘ Drawdown',     desc: 'Ranked by expected drawdown' },
]

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

const api = {
  get: async <T>(path: string, params?: Record<string, string | number>) => {
    const url = new URL(`/api/research${path}`, window.location.origin)
    if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)))
    const res = await fetch(url.toString())
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }))
      throw new Error((err as { error: string }).error ?? res.statusText)
    }
    return res.json() as Promise<T>
  },
}

// ---------------------------------------------------------------------------
// Formatting utils
// ---------------------------------------------------------------------------

const fmt = {
  pct:   (v: number | null, d = 1)  => v == null ? '—' : `${(v * 100).toFixed(d)}%`,
  dec:   (v: number | null, d = 4)  => v == null ? '—' : v.toFixed(d),
  num:   (v: number | null)         => v == null ? '—' : v.toLocaleString(),
  date:  (s: string | null)         => s ? s.slice(0, 10) : '—',
  dt:    (s: string | null) => {
    if (!s) return '—'
    try { return new Date(s).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }
    catch { return s.slice(0, 16) }
  },
}

function icRating(ic: number | null): string {
  if (ic == null) return ''
  const a = Math.abs(ic)
  return a >= 0.05 ? 'STRONG' : a >= 0.02 ? 'MODERATE' : 'WEAK'
}
function icColor(ic: number | null): string {
  if (ic == null) return '#6b7280'
  const r = icRating(ic)
  return r === 'STRONG' ? '#22c55e' : r === 'MODERATE' ? '#f59e0b' : '#ef4444'
}
function probColor(p: number | null): string {
  if (p == null) return '#6b7280'
  return p >= 0.65 ? '#22c55e' : p >= 0.55 ? '#86efac' : p >= 0.45 ? '#9ca3af' : p >= 0.35 ? '#fca5a5' : '#ef4444'
}
function statusColor(s: string): string {
  if (s === 'complete' || s === 'success') return '#22c55e'
  if (s === 'running')                     return '#3b82f6'
  if (s === 'partial')                     return '#f59e0b'
  return '#ef4444'
}

// ---------------------------------------------------------------------------
// Shared primitive components
// ---------------------------------------------------------------------------

function MetricCell({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
      <span style={{ fontFamily: '"JetBrains Mono", "Fira Code", monospace', fontSize: 14, color: color ?? '#e5e7eb', fontWeight: 500 }}>{value}</span>
      {sub && <span style={{ fontSize: 10, color: '#6b7280' }}>{sub}</span>}
    </div>
  )
}

function SectionHeader({ title, badge, right }: { title: string; badge?: string; right?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.10em' }}>{title}</span>
        {badge && (
          <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 3, background: '#1f2937', color: '#6b7280', border: '1px solid #374151', fontFamily: 'monospace' }}>
            {badge}
          </span>
        )}
      </div>
      {right}
    </div>
  )
}

function Skeleton({ width = '100%', height = 14 }: { width?: string | number; height?: number }) {
  return (
    <div style={{ width, height, borderRadius: 3, background: 'linear-gradient(90deg,#1f2937 0%,#374151 50%,#1f2937 100%)', backgroundSize: '200% 100%', animation: 'shimmer 1.4s ease-in-out infinite' }} />
  )
}

function ConfidenceBar({ value }: { value: number | null }) {
  if (value == null) return <span style={{ color: '#4b5563', fontFamily: 'monospace', fontSize: 11 }}>—</span>
  const pct = Math.round(value * 100)
  const col = pct >= 70 ? '#22c55e' : pct >= 50 ? '#f59e0b' : '#6b7280'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
      <div style={{ width: 48, height: 4, background: '#1f2937', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: col, borderRadius: 2, transition: 'width 0.3s' }} />
      </div>
      <span style={{ fontFamily: 'monospace', fontSize: 11, color: col, width: 32, textAlign: 'right' }}>{pct}%</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Q3: Health strip with dual IC cell
// ---------------------------------------------------------------------------

function HealthPanel({ data, isLoading }: { data: MetricsResponse | undefined; isLoading: boolean }) {
  const champ = data?.champion

  const latestIC = champ?.latest_rank_ic ?? null
  const wfMean   = champ?.wf_mean_rank_ic ?? null
  const wfStd    = champ?.wf_std_rank_ic  ?? null
  const wfFolds  = champ?.wf_n_folds      ?? null

  // WF IC cell value: "0.0312 ± 0.0089" or "—" when no folds yet
  const wfICValue = wfMean != null
    ? wfStd != null ? `${wfMean.toFixed(4)} ± ${wfStd.toFixed(4)}` : wfMean.toFixed(4)
    : '—'
  // Latest IC: most recent fold's val IC
  const latestICValue = latestIC != null ? latestIC.toFixed(4) : '—'

  const cells = [
    { label: 'Raw Bars',       value: fmt.num(data?.coverage?.raw_bars ?? null),       sub: `${fmt.num(data?.coverage?.tickers ?? null)} tickers` },
    { label: 'Date Range',     value: fmt.date(data?.coverage?.first_bar ?? null),       sub: `→ ${fmt.date(data?.coverage?.last_bar ?? null)}` },
    { label: 'Label Coverage', value: `${data?.coverage?.label_coverage_pct ?? '—'}%`, sub: `${fmt.num(data?.coverage?.labeled_rows ?? null)} labeled` },
    {
      // WF IC: mean ± std across folds — the robustness metric
      label: 'WF IC',
      value: wfICValue,
      color: icColor(wfMean),
      sub:   wfFolds != null
        ? `${wfFolds} fold${wfFolds !== 1 ? 's' : ''}  ${icRating(wfMean)}`
        : icRating(wfMean) || '—',
    },
    {
      // Latest IC: single fold val IC, shown for comparison with WF mean
      label: 'Latest IC',
      value: latestICValue,
      color: icColor(latestIC),
      sub:   latestIC != null ? icRating(latestIC) : '—',
    },
    { label: 'AUC / Brier', value: `${fmt.dec(champ?.auc ?? null, 3)} / ${fmt.dec(champ?.brier ?? null, 4)}`, sub: 'baseline brier 0.25' },
    { label: "Today's Preds", value: fmt.num(data?.today?.n_predictions ?? null), sub: data?.today ? `${data.today.pct_bullish ?? '—'}% bullish` : 'no predictions yet' },
    { label: 'Last Run', value: data?.lastRun?.status ?? '—', color: statusColor(data?.lastRun?.status ?? ''), sub: fmt.dt(data?.lastRun?.started_at ?? null) },
    { label: 'Trained Through', value: fmt.date(champ?.training_end ?? null), sub: champ ? `v${champ.model_version} · ${champ.wf_n_folds ?? 0} folds` : '—' },
  ]

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 1, background: '#111827', border: '1px solid #1f2937', borderRadius: 6, overflow: 'hidden', marginBottom: 20 }}>
      {cells.map((c, i) => (
        <div key={i} style={{ padding: '14px 16px', background: '#0f172a', borderRight: i < cells.length - 1 ? '1px solid #1f2937' : 'none' }}>
          {isLoading
            ? <><Skeleton width={60} height={10} /><div style={{ height: 6 }} /><Skeleton width={80} height={16} /><div style={{ height: 4 }} /><Skeleton width={50} height={10} /></>
            : <MetricCell label={c.label} value={c.value ?? '—'} color={c.color} sub={c.sub} />
          }
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Q1: Advanced model selector
// ---------------------------------------------------------------------------

function ModelSelector({ value, onChange }: { value: ModelMode; onChange: (m: ModelMode) => void }) {
  const [open, setOpen] = useState(false)
  const current = MODEL_OPTIONS.find(o => o.value === value) ?? MODEL_OPTIONS[0]

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          background: '#111827', border: '1px solid #374151', color: '#9ca3af',
          padding: '5px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 11,
          fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6,
          whiteSpace: 'nowrap',
        }}
      >
        <span style={{ color: '#e5e7eb' }}>{current.label}</span>
        <span style={{ opacity: 0.5 }}>▾</span>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 20,
            background: '#111827', border: '1px solid #374151', borderRadius: 5,
            minWidth: 240, boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
          }}
          onMouseLeave={() => setOpen(false)}
        >
          {MODEL_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => { onChange(opt.value); setOpen(false) }}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                background: opt.value === value ? '#1f2937' : 'transparent',
                border: 'none', color: opt.value === value ? '#f9fafb' : '#9ca3af',
                padding: '10px 14px', cursor: 'pointer', fontFamily: 'inherit',
                borderBottom: '1px solid #1f2937',
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 2 }}>{opt.label}</div>
              <div style={{ fontSize: 10, color: '#4b5563' }}>{opt.desc}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Predictions table
// ---------------------------------------------------------------------------

type SortKey = 'rank_percentile' | 'probability_positive' | 'expected_return' | 'confidence' | 'ticker'
type SortDir = 'asc' | 'desc'

function PredictionsTable({
  data, isLoading, modelMode, onModelChange, onTickerClick,
}: {
  data: PredictionsResponse | undefined
  isLoading: boolean
  modelMode: ModelMode
  onModelChange: (m: ModelMode) => void
  onTickerClick: (t: string) => void
}) {
  const [sortKey, setSortKey] = useState<SortKey>('rank_percentile')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [filter, setFilter]   = useState('')
  const [minProb, setMinProb] = useState(0)

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const rows = (data?.predictions ?? [])
    .filter(p =>
      (!filter || p.ticker.includes(filter.toUpperCase())) &&
      (minProb === 0 || (p.probability_positive ?? 0) >= minProb)
    )
    .sort((a, b) => {
      const va = a[sortKey] ?? (sortKey === 'ticker' ? '' : -Infinity)
      const vb = b[sortKey] ?? (sortKey === 'ticker' ? '' : -Infinity)
      if (typeof va === 'string') return sortDir === 'asc' ? (va as string).localeCompare(vb as string) : (vb as string).localeCompare(va as string)
      return sortDir === 'asc' ? (va as number) - (vb as number) : (vb as number) - (va as number)
    })

  return (
    <div style={{ background: '#0f172a', border: '1px solid #1f2937', borderRadius: 6, overflow: 'hidden' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid #1f2937', background: '#111827', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.10em' }}>Ranked Predictions</span>
          {data?.date && <span style={{ fontSize: 10, color: '#4b5563', fontFamily: 'monospace' }}>{data.date}</span>}
          <span style={{ fontSize: 10, color: '#374151', fontFamily: 'monospace' }}>{rows.length} rows</span>
        </div>

        <input
          placeholder="Filter ticker…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          style={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 4, color: '#e5e7eb', padding: '5px 10px', fontSize: 12, fontFamily: 'monospace', outline: 'none', width: 120 }}
        />

        <select
          value={minProb}
          onChange={e => setMinProb(parseFloat(e.target.value))}
          style={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 4, color: '#e5e7eb', padding: '5px 8px', fontSize: 11, fontFamily: 'monospace', outline: 'none' }}
        >
          <option value={0}>All</option>
          <option value={0.55}>P(+) ≥55%</option>
          <option value={0.60}>P(+) ≥60%</option>
          <option value={0.65}>P(+) ≥65%</option>
          <option value={0.70}>P(+) ≥70%</option>
        </select>

        {/* Q1: Model selector */}
        <ModelSelector value={modelMode} onChange={onModelChange} />
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #1f2937' }}>
              {([
                { key: 'rank_percentile' as SortKey,      label: 'RANK',        align: 'right' as const },
                { key: 'ticker' as SortKey,               label: 'TICKER',      align: 'left' as const  },
                { key: 'probability_positive' as SortKey, label: 'P(+) 5D',     align: 'right' as const },
                { key: 'expected_return' as SortKey,      label: 'EXP RETURN',  align: 'right' as const },
                { key: 'expected_return' as SortKey,      label: 'EXP DD',      align: 'right' as const },
                { key: 'confidence' as SortKey,           label: 'CONFIDENCE',  align: 'right' as const },
              ]).map((col, i) => {
                const active = sortKey === col.key
                return (
                  <th key={i} onClick={() => handleSort(col.key)} style={{ padding: '9px 16px', textAlign: col.align, color: active ? '#e5e7eb' : '#4b5563', fontWeight: 500, fontSize: 10, letterSpacing: '0.08em', cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', background: active ? '#111827' : 'transparent' }}>
                    {col.label} {active ? (sortDir === 'desc' ? '↓' : '↑') : <span style={{ opacity: 0.3 }}>↕</span>}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {isLoading
              ? Array.from({ length: 15 }).map((_, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #0f172a' }}>
                    {Array.from({ length: 6 }).map((_, j) => (
                      <td key={j} style={{ padding: '10px 16px' }}><Skeleton width={j === 1 ? 50 : 60} height={12} /></td>
                    ))}
                  </tr>
                ))
              : rows.length === 0
              ? (
                  <tr><td colSpan={6} style={{ padding: '40px 16px', textAlign: 'center', color: '#4b5563', fontSize: 12 }}>
                    {data?.date ? 'No predictions match the current filter.' : 'No predictions found. Run the training pipeline first.'}
                  </td></tr>
                )
              : rows.map((p, i) => {
                  const prob   = p.probability_positive
                  const expRet = p.expected_return
                  const isTop  = (p.rank_percentile ?? 0) >= 0.80
                  const isBot  = (p.rank_percentile ?? 1) <= 0.20
                  return (
                    <tr key={p.ticker} style={{ borderBottom: '1px solid #111827', background: i % 2 === 0 ? '#0a0f1a' : '#0f172a', cursor: 'pointer' }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#1a2235')}
                      onMouseLeave={e => (e.currentTarget.style.background = i % 2 === 0 ? '#0a0f1a' : '#0f172a')}
                      onClick={() => onTickerClick(p.ticker)}
                    >
                      <td style={{ padding: '9px 16px', textAlign: 'right', fontFamily: 'monospace', color: '#4b5563', fontSize: 11 }}>
                        {p.rank_percentile != null ? `${(p.rank_percentile * 100).toFixed(0)}th` : '—'}
                        {isTop && <span style={{ color: '#22c55e', marginLeft: 4 }}>▲</span>}
                        {isBot && <span style={{ color: '#ef4444', marginLeft: 4 }}>▼</span>}
                      </td>
                      <td style={{ padding: '9px 16px' }}>
                        <span style={{ color: '#f9fafb', fontFamily: 'monospace', fontWeight: 600, fontSize: 13, letterSpacing: '0.04em' }}>{p.ticker}</span>
                      </td>
                      <td style={{ padding: '9px 16px', textAlign: 'right', fontFamily: 'monospace' }}>
                        <span style={{ color: probColor(prob), fontWeight: prob != null && prob > 0.6 ? 600 : 400 }}>{fmt.pct(prob)}</span>
                      </td>
                      <td style={{ padding: '9px 16px', textAlign: 'right', fontFamily: 'monospace' }}>
                        <span style={{ color: (expRet ?? 0) >= 0 ? '#86efac' : '#fca5a5' }}>
                          {expRet != null ? `${(expRet * 100).toFixed(2)}%` : '—'}
                        </span>
                      </td>
                      <td style={{ padding: '9px 16px', textAlign: 'right', fontFamily: 'monospace', color: '#ef4444' }}>
                        {p.expected_drawdown != null ? `${(p.expected_drawdown * 100).toFixed(2)}%` : '—'}
                      </td>
                      <td style={{ padding: '9px 16px', textAlign: 'right' }}>
                        <ConfidenceBar value={p.confidence} />
                      </td>
                    </tr>
                  )
                })
            }
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Q2: Sparkline component using lightweight-charts v5
// Shows P(+) over 90 days as a line series.
// ---------------------------------------------------------------------------

type SparklineSeries = 'prob' | 'ret' | 'rank'

const SPARKLINE_CONFIGS: Record<SparklineSeries, { label: string; color: string; suffix: string }> = {
  prob:  { label: 'P(+)',       color: '#3b82f6', suffix: '%'  },
  ret:   { label: 'Exp Return', color: '#22c55e', suffix: '%'  },
  rank:  { label: 'Rank Pctile',color: '#f59e0b', suffix: 'th' },
}

function Sparkline({
  data,
  seriesKey,
  height = 140,
}: {
  data:      { time: string; value: number }[]
  seriesKey: SparklineSeries
  height?:   number
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef     = useRef<IChartApi | null>(null)
  const seriesRef    = useRef<ISeriesApi<'Line'> | null>(null)
  const cfg          = SPARKLINE_CONFIGS[seriesKey]

  useEffect(() => {
    if (!containerRef.current) return

    // Create chart — lightweight-charts v5 API
    const chart = createChart(containerRef.current, {
      width:  containerRef.current.clientWidth,
      height,
      layout: {
        background:  { color: 'transparent' },
        textColor:   '#6b7280',
        fontFamily:  '"JetBrains Mono", monospace',
        fontSize:    10,
      },
      grid: {
        vertLines:   { color: '#1f2937' },
        horzLines:   { color: '#1f2937' },
      },
      rightPriceScale: {
        borderColor: '#1f2937',
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderColor:     '#1f2937',
        fixLeftEdge:     true,
        fixRightEdge:    true,
        timeVisible:     true,
        secondsVisible:  false,
      },
      crosshair: {
        vertLine:  { color: '#374151', width: 1, style: 3 },
        horzLine:  { color: '#374151', width: 1, style: 3 },
      },
      handleScroll: false,
      handleScale:  false,
    })

    // v5 API: addSeries(LineSeries, opts) — NOT addLineSeries()
    const series = chart.addSeries(LineSeries, {
      color:     cfg.color,
      lineWidth: 2,
      priceFormat: {
        type:      'custom',
        formatter: (v: number) => `${v.toFixed(1)}${cfg.suffix}`,
        minMove:   0.01,
      },
    })

    chartRef.current  = chart
    seriesRef.current = series

    // Resize observer
    const ro = new ResizeObserver(entries => {
      if (entries[0]) {
        chart.resize(entries[0].contentRect.width, height)
      }
    })
    ro.observe(containerRef.current)

    return () => {
      ro.disconnect()
      chart.remove()
      chartRef.current  = null
      seriesRef.current = null
    }
  }, [height, cfg.color, cfg.suffix])

  // Update data whenever it changes
  useEffect(() => {
    if (!seriesRef.current || !data.length) return
    seriesRef.current.setData(data as LineData[])
    chartRef.current?.timeScale().fitContent()
  }, [data])

  if (!data.length) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4b5563', fontSize: 11 }}>
        No {cfg.label} history
      </div>
    )
  }

  return <div ref={containerRef} style={{ width: '100%', height }} />
}

// ---------------------------------------------------------------------------
// Ticker drawer with Q2 sparkline
// ---------------------------------------------------------------------------

function TickerDrawer({ ticker, onClose }: { ticker: string; onClose: () => void }) {
  const [activeSeries, setActiveSeries] = useState<SparklineSeries>('prob')

  const { data, isLoading } = useQuery({
    queryKey: ['research', 'ticker', ticker],
    queryFn:  () => api.get<TickerHistoryResponse>(`/predictions/${ticker}`),
    staleTime: 60_000,
  })

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const seriesData  = data?.series?.[activeSeries] ?? []
  const latestPred  = data?.history?.[0]

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.75)', display: 'flex', justifyContent: 'flex-end' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{ width: 440, height: '100%', background: '#0a0f1a', borderLeft: '1px solid #1f2937', padding: '0', overflowY: 'auto', animation: 'slideIn 0.2s ease-out', display: 'flex', flexDirection: 'column' }}>

        {/* Drawer header */}
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #1f2937', background: '#080e1a', position: 'sticky', top: 0, zIndex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 22, fontFamily: '"JetBrains Mono", monospace', color: '#f9fafb', fontWeight: 700, letterSpacing: '0.04em' }}>{ticker}</div>
              <div style={{ fontSize: 10, color: '#4b5563', marginTop: 3 }}>90-day prediction history</div>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: '1px solid #374151', color: '#6b7280', borderRadius: 4, padding: '5px 9px', cursor: 'pointer', fontSize: 11, fontFamily: 'inherit' }}>
              ESC
            </button>
          </div>

          {/* Latest snapshot */}
          {latestPred && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginTop: 14 }}>
              <MetricCell label="Latest P(+)" value={fmt.pct(latestPred.probability_positive)} color={probColor(latestPred.probability_positive)} />
              <MetricCell label="Exp Return"  value={latestPred.expected_return != null ? `${(latestPred.expected_return*100).toFixed(2)}%` : '—'} color={(latestPred.expected_return??0)>=0?'#86efac':'#fca5a5'} />
              <MetricCell label="Rank"        value={latestPred.rank_percentile != null ? `${(latestPred.rank_percentile*100).toFixed(0)}th` : '—'} />
            </div>
          )}
        </div>

        {/* Actual label */}
        {data?.latestLabel && (
          <div style={{ margin: '16px 24px 0', background: '#111827', border: '1px solid #1f2937', borderRadius: 5, padding: '10px 14px' }}>
            <div style={{ fontSize: 10, color: '#4b5563', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Actual Outcome (as of {fmt.date(data.latestLabel.date)})</div>
            <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
              <MetricCell
                label="5D Return"
                value={data.latestLabel.return_5d != null ? `${(data.latestLabel.return_5d * 100).toFixed(2)}%` : '—'}
                color={(data.latestLabel.return_5d ?? 0) >= 0 ? '#22c55e' : '#ef4444'}
              />
              {data.latestLabel.positive_5d != null && (
                <span style={{ fontSize: 11, fontFamily: 'monospace', color: data.latestLabel.positive_5d ? '#22c55e' : '#ef4444' }}>
                  {data.latestLabel.positive_5d ? '▲ POSITIVE' : '▼ NEGATIVE'}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Q2: Sparkline */}
        <div style={{ margin: '16px 24px 0', background: '#0f172a', border: '1px solid #1f2937', borderRadius: 5, overflow: 'hidden' }}>
          {/* Series toggle */}
          <div style={{ display: 'flex', borderBottom: '1px solid #1f2937' }}>
            {(Object.entries(SPARKLINE_CONFIGS) as [SparklineSeries, typeof SPARKLINE_CONFIGS[SparklineSeries]][]).map(([key, cfg]) => (
              <button
                key={key}
                onClick={() => setActiveSeries(key)}
                style={{
                  flex: 1, padding: '8px 0', fontSize: 10, fontFamily: 'inherit',
                  background: activeSeries === key ? '#111827' : 'transparent',
                  border: 'none', borderRight: '1px solid #1f2937',
                  color: activeSeries === key ? cfg.color : '#4b5563',
                  cursor: 'pointer', fontWeight: activeSeries === key ? 600 : 400,
                  textTransform: 'uppercase', letterSpacing: '0.06em',
                  transition: 'all 0.15s',
                }}
              >
                {cfg.label}
              </button>
            ))}
          </div>

          {/* Chart area */}
          <div style={{ padding: '4px 0 0' }}>
            {isLoading
              ? <div style={{ height: 140, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Skeleton width="90%" height={100} /></div>
              : <Sparkline data={seriesData} seriesKey={activeSeries} height={140} />
            }
          </div>
        </div>

        {/* History list */}
        <div style={{ padding: '16px 24px', flex: 1 }}>
          <div style={{ fontSize: 10, color: '#4b5563', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Prediction Log</div>

          {isLoading
            ? Array.from({ length: 8 }).map((_, i) => (
                <div key={i} style={{ marginBottom: 6 }}><Skeleton height={36} /></div>
              ))
            : (data?.history ?? []).map(p => (
                <div key={p.date} style={{ padding: '8px 0', borderBottom: '1px solid #111827', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: '#6b7280', fontFamily: 'monospace' }}>{p.date}</span>
                  <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                    <span style={{ fontSize: 12, fontFamily: 'monospace', color: probColor(p.probability_positive) }}>{fmt.pct(p.probability_positive)}</span>
                    <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#4b5563' }}>
                      {p.rank_percentile != null ? `${(p.rank_percentile*100).toFixed(0)}th` : '—'}
                    </span>
                  </div>
                </div>
              ))
          }
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Model metrics panel
// ---------------------------------------------------------------------------

function ModelMetricsPanel({ data, isLoading }: { data: { models: ModelMetrics[]; foldSummary: FoldSummary[] } | undefined; isLoading: boolean }) {
  return (
    <div style={{ background: '#0f172a', border: '1px solid #1f2937', borderRadius: 6, padding: '16px 18px' }}>
      <SectionHeader title="Model Registry" badge={`${data?.models?.length ?? 0} models`} />

      {isLoading
        ? <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} height={48} />)}</div>
        : !data?.models?.length
        ? <div style={{ color: '#4b5563', fontSize: 12, padding: '20px 0' }}>No models trained yet. Run: <code style={{ color: '#6b7280' }}>python scripts/run_training.py --baseline</code></div>
        : (
          <>
            {data.foldSummary.map(fold => {
              // Consistent vocabulary across every IC surface:
              //   mean_rank_ic  = signal strength  (is there alpha?)
              //   std_rank_ic   = stability        (is it consistent across folds?)
              //   n_folds       = sample robustness (how much evidence?)
              const icMean  = fold.mean_rank_ic
              const icStd   = fold.std_rank_ic
              const icMeanStr = icMean != null ? icMean.toFixed(4) : '—'
              const icStdStr  = icStd  != null ? icStd.toFixed(4)  : null
              // Combined "mean ± std" for the primary IC display
              const icLabel   = icStdStr != null ? `${icMeanStr} ± ${icStdStr}` : icMeanStr
              return (
              <div key={`${fold.model_version}-${fold.target}-${fold.horizon ?? 'x'}`} style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 5, padding: '12px 14px', marginBottom: 10 }}>
                {/* Card header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 11, color: '#9ca3af', fontFamily: 'monospace' }}>v{fold.model_version}</span>
                    <span style={{ fontSize: 10, color: '#4b5563' }}>{fold.target}</span>
                    {fold.horizon != null && (
                      <span style={{ fontSize: 10, color: '#374151' }}>{fold.horizon}d</span>
                    )}
                  </div>
                  {/* n_folds = sample robustness */}
                  <span style={{ fontSize: 10, color: '#4b5563', fontFamily: 'monospace' }}>
                    {fold.n_folds} fold{fold.n_folds !== 1 ? 's' : ''}
                  </span>
                </div>

                {/* Primary IC row: mean ± std (signal strength + stability in one line) */}
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                    Rank IC — signal strength
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                    <span style={{ fontFamily: '"JetBrains Mono", "Fira Code", monospace', fontSize: 18, color: icColor(icMean), fontWeight: 600 }}>
                      {icMeanStr}
                    </span>
                    {icStdStr && (
                      <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#6b7280' }}>
                        ± {icStdStr}
                      </span>
                    )}
                    <span style={{ fontSize: 10, color: icColor(icMean), marginLeft: 4 }}>
                      {icRating(icMean)}
                    </span>
                  </div>
                  {/* Stability bar: std relative to mean gives coefficient of variation */}
                  {icMean != null && icStd != null && (
                    <div style={{ marginTop: 6 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                        <span style={{ fontSize: 10, color: '#4b5563' }}>stability</span>
                        <span style={{ fontSize: 10, color: '#4b5563', fontFamily: 'monospace' }}>
                          {icStd < Math.abs(icMean) * 0.5 ? 'HIGH' : icStd < Math.abs(icMean) ? 'MODERATE' : 'LOW'}
                        </span>
                      </div>
                      {/* Bar: narrower std relative to mean = more stable signal */}
                      <div style={{ height: 3, background: '#1f2937', borderRadius: 2 }}>
                        <div style={{
                          height: '100%', borderRadius: 2,
                          background: icStd < Math.abs(icMean) * 0.5 ? '#22c55e' : icStd < Math.abs(icMean) ? '#f59e0b' : '#ef4444',
                          width: `${Math.max(5, Math.min(100, (1 - icStd / Math.max(Math.abs(icMean), 0.001)) * 100))}%`,
                          transition: 'width 0.4s ease',
                        }} />
                      </div>
                    </div>
                  )}
                </div>

                {/* Secondary metrics row */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, paddingTop: 10, borderTop: '1px solid #1f2937' }}>
                  <MetricCell label="Mean AUC"   value={fmt.dec(fold.mean_auc, 3)}   color={(fold.mean_auc   ?? 0) > 0.53 ? '#22c55e' : '#f59e0b'} />
                  <MetricCell label="Mean Brier" value={fmt.dec(fold.mean_brier, 4)} color={(fold.mean_brier ?? 1) < 0.24 ? '#22c55e' : '#f59e0b'} sub="baseline 0.25" />
                  <MetricCell label="Sharpe"     value={fmt.dec(fold.mean_sharpe, 2)} />
                </div>
              </div>
              )
            })}
            <div style={{ height: 1, background: '#1f2937', margin: '12px 0' }} />
            {data.models.map(m => (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid #111827' }}>
                <div>
                  <span style={{ fontSize: 12, color: '#e5e7eb', fontFamily: 'monospace' }}>{m.model_name}</span>
                  <span style={{ fontSize: 10, color: '#4b5563', marginLeft: 8 }}>{fmt.date(m.training_start)} → {fmt.date(m.training_end)}</span>
                </div>
                <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                  <span style={{ fontSize: 11, fontFamily: 'monospace', color: icColor(m.rank_ic) }}>IC {fmt.dec(m.rank_ic)}</span>
                  <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#9ca3af' }}>AUC {fmt.dec(m.auc, 3)}</span>
                  <span style={{ fontSize: 10, color: '#4b5563' }}>v{m.model_version}</span>
                </div>
              </div>
            ))}
          </>
        )
      }
    </div>
  )
}

// ---------------------------------------------------------------------------
// Feature importance panel
// ---------------------------------------------------------------------------

function TopFeaturesPanel({ data, isLoading }: { data: MetricsResponse | undefined; isLoading: boolean }) {
  const features = data?.topFeatures ?? []
  const maxIC = Math.max(...features.map(f => Math.abs(f.mean_ic)), 0.001)
  return (
    <div style={{ background: '#0f172a', border: '1px solid #1f2937', borderRadius: 6, padding: '16px 18px' }}>
      <SectionHeader title="Feature IC" badge="Top 10 · 5D target" />
      {isLoading
        ? <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} height={24} />)}</div>
        : features.length === 0
        ? <div style={{ color: '#4b5563', fontSize: 12 }}>Run walk-forward training to populate feature IC.</div>
        : features.map((f, i) => {
            const absIC = Math.abs(f.mean_ic)
            const pct   = (absIC / maxIC) * 100
            const col   = absIC > 0.03 ? '#22c55e' : absIC > 0.01 ? '#f59e0b' : '#6b7280'
            return (
              <div key={f.feature_name} style={{ marginBottom: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span style={{ fontSize: 11, color: '#9ca3af', fontFamily: 'monospace' }}>{i+1}. {f.feature_name}</span>
                  <span style={{ fontSize: 11, color: col, fontFamily: 'monospace' }}>{f.mean_ic > 0 ? '+' : ''}{f.mean_ic.toFixed(4)}</span>
                </div>
                <div style={{ height: 3, background: '#1f2937', borderRadius: 2 }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: col, borderRadius: 2, transition: 'width 0.4s ease' }} />
                </div>
              </div>
            )
          })
      }
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pipeline runs panel
// ---------------------------------------------------------------------------

function RunsPanel({ data, isLoading }: { data: { runs: ResearchRun[] } | undefined; isLoading: boolean }) {
  return (
    <div style={{ background: '#0f172a', border: '1px solid #1f2937', borderRadius: 6, padding: '16px 18px' }}>
      <SectionHeader title="Pipeline Runs" badge={`${data?.runs?.length ?? 0} recent`} />
      {isLoading
        ? <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} height={36} />)}</div>
        : !data?.runs?.length
        ? <div style={{ color: '#4b5563', fontSize: 12 }}>No pipeline runs recorded.</div>
        : data.runs.map(r => (
            <div key={r.id} style={{ padding: '8px 0', borderBottom: '1px solid #111827', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                  <span style={{ fontSize: 11, fontFamily: 'monospace', color: statusColor(r.status), fontWeight: 600 }}>{r.status.toUpperCase()}</span>
                  <span style={{ fontSize: 10, color: '#4b5563' }}>{r.run_type}</span>
                </div>
                <div style={{ fontSize: 10, color: '#6b7280' }}>{fmt.dt(r.started_at)}</div>
                {r.error_message && <div style={{ fontSize: 10, color: '#ef4444', marginTop: 2, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.error_message.slice(0, 80)}</div>}
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 10, color: '#4b5563', fontFamily: 'monospace' }}>{r.tickers_processed} tickers</div>
                <div style={{ fontSize: 10, color: '#374151', fontFamily: 'monospace' }}>{fmt.num(r.features_generated)} feats</div>
              </div>
            </div>
          ))
      }
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function ResearchLab() {
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null)
  const [activeTab, setActiveTab]           = useState<'predictions' | 'models' | 'runs'>('predictions')
  // Q1: model mode state lives here so the query key updates with it
  const [modelMode, setModelMode]           = useState<ModelMode>('champion')

  const metricsQuery = useQuery({
    queryKey: ['research', 'metrics'],
    queryFn:  () => api.get<MetricsResponse>('/metrics/latest'),
    staleTime: 120_000,
    refetchInterval: 120_000,
  })

  const predictionsQuery = useQuery({
    queryKey: ['research', 'predictions', modelMode],
    queryFn:  () => api.get<PredictionsResponse>('/predictions', { model: modelMode, limit: 200 }),
    staleTime: 120_000,
  })

  const modelsQuery = useQuery({
    queryKey: ['research', 'models'],
    queryFn:  () => api.get<{ models: ModelMetrics[]; foldSummary: FoldSummary[] }>('/models/latest'),
    staleTime: 120_000,
  })

  const runsQuery = useQuery({
    queryKey: ['research', 'runs'],
    queryFn:  () => api.get<{ runs: ResearchRun[] }>('/runs/latest'),
    staleTime: 60_000,
  })

  const handleTickerClick = useCallback((t: string) => setSelectedTicker(t), [])
  const refetchAll = useCallback(() => {
    metricsQuery.refetch()
    predictionsQuery.refetch()
    modelsQuery.refetch()
    runsQuery.refetch()
  }, [metricsQuery, predictionsQuery, modelsQuery, runsQuery])

  const hasError = metricsQuery.isError || predictionsQuery.isError

  return (
    <div style={{ minHeight: '100vh', background: '#030712', color: '#e5e7eb', fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace' }}>
      <style>{`
        @keyframes shimmer { 0%{background-position:-200% 0} 100%{background-position:200% 0} }
        @keyframes slideIn { from{transform:translateX(100%)} to{transform:translateX(0)} }
        *{box-sizing:border-box}
        ::-webkit-scrollbar{width:6px;height:6px}
        ::-webkit-scrollbar-track{background:#0f172a}
        ::-webkit-scrollbar-thumb{background:#374151;border-radius:3px}
        ::-webkit-scrollbar-thumb:hover{background:#4b5563}
      `}</style>

      {/* Page header */}
      <div style={{ borderBottom: '1px solid #1f2937', padding: '14px 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#080e1a', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#f9fafb', letterSpacing: '0.05em' }}>◈ RESEARCH LAB</div>
            <div style={{ fontSize: 10, color: '#374151', marginTop: 1 }}>Read-only · atlas-research engine</div>
          </div>
          <div style={{ display: 'flex', gap: 2, marginLeft: 24 }}>
            {(['predictions', 'models', 'runs'] as const).map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)} style={{ background: activeTab === tab ? '#1f2937' : 'transparent', border: activeTab === tab ? '1px solid #374151' : '1px solid transparent', color: activeTab === tab ? '#e5e7eb' : '#4b5563', padding: '5px 12px', borderRadius: 4, cursor: 'pointer', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: 'inherit', transition: 'all 0.15s' }}>
                {tab}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {metricsQuery.data?.generatedAt && (
            <span style={{ fontSize: 10, color: '#374151' }}>Updated {fmt.dt(metricsQuery.data.generatedAt)}</span>
          )}
          <button onClick={refetchAll} style={{ background: '#111827', border: '1px solid #374151', color: '#9ca3af', padding: '5px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 11, fontFamily: 'inherit' }}>
            ↺ Refresh
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: '20px 28px', maxWidth: 1600, margin: '0 auto' }}>
        {hasError && (
          <div style={{ background: '#1a0f0f', border: '1px solid #7f1d1d', borderRadius: 6, padding: '12px 16px', marginBottom: 16, fontSize: 12, color: '#fca5a5' }}>
            ⚠ Cannot reach atlas-research API. Verify DATABASE_URL_RESEARCH is set and the Research Engine DB is reachable.
            {metricsQuery.error instanceof Error && <span style={{ color: '#ef4444', marginLeft: 8 }}>{metricsQuery.error.message}</span>}
          </div>
        )}

        {/* Health strip always visible */}
        <HealthPanel data={metricsQuery.data} isLoading={metricsQuery.isLoading} />

        {activeTab === 'predictions' && (
          <PredictionsTable
            data={predictionsQuery.data}
            isLoading={predictionsQuery.isLoading}
            modelMode={modelMode}
            onModelChange={m => { setModelMode(m) }}
            onTickerClick={handleTickerClick}
          />
        )}

        {activeTab === 'models' && (
          <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 16 }}>
            <ModelMetricsPanel data={modelsQuery.data} isLoading={modelsQuery.isLoading} />
            <TopFeaturesPanel  data={metricsQuery.data} isLoading={metricsQuery.isLoading} />
          </div>
        )}

        {activeTab === 'runs' && (
          <RunsPanel data={runsQuery.data} isLoading={runsQuery.isLoading} />
        )}
      </div>

      {selectedTicker && (
        <TickerDrawer ticker={selectedTicker} onClose={() => setSelectedTicker(null)} />
      )}
    </div>
  )
}

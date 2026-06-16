/**
 * BackendHealthPanel — compact strip and full-card pipeline health.
 *
 * compact=true  → single row strip for Research.tsx header
 * compact=false → full table card
 */

import { usePipelineHealth, type PipelineHealth } from '../hooks/useResearchAdvanced'

const G   = '#22c55e'
const AM  = '#f59e0b'
const R   = '#ef4444'
const MUT = '#6b7280'
const DIM = '#4b5563'
const HI  = '#e5e7eb'
const SUB = '#9ca3af'
const BG  = '#111827'
const BD  = '#1e2533'

function Dot({ ok, stale }: { ok?: boolean; stale?: boolean }) {
  const color = stale ? AM : ok ? G : R
  return (
    <span style={{
      display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
      background: color, flexShrink: 0, boxShadow: `0 0 4px ${color}50`,
    }} />
  )
}

function statusColor(h: PipelineHealth) {
  if (h.healthy) return G
  if (h.status === 'degraded') return AM
  return R
}

function freshAge(hours: number | null): string {
  if (hours == null) return '—'
  if (hours < 1)  return '< 1h ago'
  if (hours < 24) return `${Math.round(hours)}h ago`
  return `${Math.round(hours / 24)}d ago`
}

interface Props { compact?: boolean }

export function BackendHealthPanel({ compact = false }: Props) {
  const { health, isLoading, isError } = usePipelineHealth()

  if (isLoading) {
    return (
      <div style={{ fontFamily: 'monospace', fontSize: 10, color: DIM, padding: compact ? '4px 8px' : 8, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: DIM }} />
        Checking backend health…
      </div>
    )
  }

  if (isError || !health) {
    return (
      <div style={{ fontFamily: 'monospace', fontSize: 10, color: R, padding: compact ? '4px 8px' : 8, display: 'flex', alignItems: 'center', gap: 6 }}>
        <Dot ok={false} />
        Backend health: unreachable
      </div>
    )
  }

  const sc = statusColor(health)

  if (compact) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        fontFamily: 'monospace', fontSize: 10, color: SUB,
        padding: '4px 8px', background: BG, borderRadius: 4, border: `1px solid ${BD}`,
      }}>
        <Dot ok={health.healthy} stale={health.pred_stale} />
        <span style={{ color: sc, fontWeight: 700 }}>{health.status.toUpperCase()}</span>
        {health.last_pred_date && (
          <>
            <span style={{ color: DIM }}>·</span>
            <span>preds {freshAge(health.pred_age_hours)}</span>
          </>
        )}
        {health.pred_tickers != null && (
          <>
            <span style={{ color: DIM }}>·</span>
            <span>{health.pred_tickers.toLocaleString()} tickers</span>
          </>
        )}
        {health.mean_wf_ic != null && (
          <>
            <span style={{ color: DIM }}>·</span>
            <span>IC {health.mean_wf_ic.toFixed(3)}</span>
          </>
        )}
        {health.pred_stale && <span style={{ color: AM }}>stale</span>}
      </div>
    )
  }

  return (
    <div style={{ fontFamily: 'monospace', fontSize: 11, color: HI, padding: 12, background: '#0f1623', borderRadius: 6, border: `1px solid ${BD}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <Dot ok={health.healthy} stale={health.pred_stale} />
        <span style={{ color: sc, fontWeight: 700, fontSize: 12 }}>BACKEND {health.status.toUpperCase()}</span>
        {health.last_run_at && (
          <span style={{ color: DIM, marginLeft: 'auto', fontSize: 9 }}>
            last run {freshAge(health.run_age_hours)}
          </span>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', marginBottom: 10 }}>
        {[
          { label: 'Predictions', val: health.pred_tickers != null ? `${health.pred_tickers.toLocaleString()} tickers` : '—', ok: !health.pred_stale },
          { label: 'Active tickers', val: health.active_tickers != null ? `${health.active_tickers.toLocaleString()}` : '—', ok: true },
          { label: 'Latest pred date', val: health.last_pred_date ?? '—', ok: !health.pred_stale },
          { label: 'Latest bar date', val: health.last_bar_date ?? '—', ok: !health.bar_stale },
          { label: 'Mean WF IC', val: health.mean_wf_ic != null ? health.mean_wf_ic.toFixed(4) : '—', ok: health.mean_wf_ic != null && health.mean_wf_ic >= 0.03 },
          { label: 'Last trained', val: health.last_trained ?? '—', ok: true },
        ].map(({ label, val, ok }) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ color: DIM }}>{label}</span>
            <span style={{ color: ok ? SUB : AM }}>{val}</span>
          </div>
        ))}
      </div>

      <div style={{ borderTop: `1px solid ${BD}`, paddingTop: 8, display: 'flex', gap: 12 }}>
        {[
          { label: 'Pred age', val: freshAge(health.pred_age_hours), stale: health.pred_stale },
          { label: 'Bar age', val: freshAge(health.bar_age_hours), stale: health.bar_stale },
          { label: 'Run age', val: freshAge(health.run_age_hours), stale: false },
        ].map(({ label, val, stale }) => (
          <div key={label}>
            <div style={{ fontSize: 9, color: DIM }}>{label}</div>
            <div style={{ fontSize: 11, fontWeight: 600, color: stale ? AM : SUB }}>{val}</div>
          </div>
        ))}
      </div>

      {(health.pred_stale || health.bar_stale) && (
        <div style={{ marginTop: 8, padding: '5px 8px', borderRadius: 4, fontSize: 9, background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.20)', color: AM }}>
          {health.pred_stale && 'Predictions stale — run atlas-research pipeline. '}
          {health.bar_stale && 'Bar data stale — update raw_bars table.'}
        </div>
      )}
    </div>
  )
}

export default BackendHealthPanel

import { usePipelineHealth } from '../hooks/useResearchAdvanced'

interface Props {
  compact?: boolean
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 7,
        height: 7,
        borderRadius: '50%',
        background: ok ? '#22c55e' : '#ef4444',
        flexShrink: 0,
      }}
    />
  )
}

export function BackendHealthPanel({ compact = false }: Props) {
  const { data, isLoading, isError } = usePipelineHealth()

  if (isLoading) {
    return (
      <div style={{ fontFamily: 'monospace', fontSize: 10, color: '#6b7280', padding: compact ? '4px 8px' : 8 }}>
        Checking backend health…
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div style={{ fontFamily: 'monospace', fontSize: 10, color: '#ef4444', padding: compact ? '4px 8px' : 8 }}>
        Backend health: unreachable
      </div>
    )
  }

  if (!data.available) {
    return (
      <div style={{ fontFamily: 'monospace', fontSize: 10, color: '#f59e0b', padding: compact ? '4px 8px' : 8 }}>
        Backend: {data.reason ?? 'unavailable'}
      </div>
    )
  }

  const statusColor =
    data.status === 'healthy' ? '#22c55e' :
    data.status === 'degraded' ? '#f59e0b' : '#ef4444'

  if (compact) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontFamily: 'monospace',
        fontSize: 10,
        color: '#9ca3af',
        padding: '4px 8px',
        background: '#111827',
        borderRadius: 4,
        border: '1px solid #1e2533',
      }}>
        <StatusDot ok={data.status === 'healthy'} />
        <span style={{ color: statusColor, fontWeight: 600 }}>{data.status.toUpperCase()}</span>
        {data.latest_prediction_date && (
          <span>preds: {data.latest_prediction_date}</span>
        )}
        {data.missing_tables.length > 0 && (
          <span style={{ color: '#ef4444' }}>{data.missing_tables.length} missing</span>
        )}
      </div>
    )
  }

  const tableKeys = Object.keys(data.tables).sort()

  return (
    <div style={{
      fontFamily: 'monospace',
      fontSize: 11,
      color: '#d1d5db',
      padding: 12,
      background: '#0f1623',
      borderRadius: 6,
      border: '1px solid #1e2533',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <StatusDot ok={data.status === 'healthy'} />
        <span style={{ color: statusColor, fontWeight: 700, fontSize: 12 }}>
          BACKEND {data.status.toUpperCase()}
        </span>
        <span style={{ color: '#4b5563', marginLeft: 'auto' }}>
          {new Date(data.checked_at).toLocaleTimeString()}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 16px', marginBottom: 8 }}>
        {tableKeys.map((t) => (
          <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <StatusDot ok={data.tables[t]} />
            <span style={{ color: data.tables[t] ? '#9ca3af' : '#ef4444' }}>{t}</span>
          </div>
        ))}
      </div>

      <div style={{ borderTop: '1px solid #1e2533', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div>
          <span style={{ color: '#4b5563' }}>Latest prediction: </span>
          <span style={{ color: data.latest_prediction_date ? '#22c55e' : '#ef4444' }}>
            {data.latest_prediction_date ?? 'none'}
          </span>
          {data.prediction_count > 0 && (
            <span style={{ color: '#6b7280' }}> ({data.prediction_count.toLocaleString()} rows)</span>
          )}
        </div>
        {data.latest_behavior_date && (
          <div>
            <span style={{ color: '#4b5563' }}>Latest behavior: </span>
            <span>{data.latest_behavior_date}</span>
          </div>
        )}
        {data.latest_pipeline_run && (
          <div>
            <span style={{ color: '#4b5563' }}>Last run: </span>
            <span style={{
              color: data.latest_pipeline_run.status === 'complete' ? '#22c55e' : '#ef4444'
            }}>
              {String(data.latest_pipeline_run.status ?? 'unknown')}
            </span>
            {data.latest_pipeline_run.started_at && (
              <span style={{ color: '#6b7280' }}>
                {' '}@ {new Date(data.latest_pipeline_run.started_at as string).toLocaleDateString()}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

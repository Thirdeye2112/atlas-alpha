import { useState, useEffect, useCallback } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface HypothesisSpec {
  market_object: string
  condition: string
  condition_params: Record<string, number>
  direction: 'long' | 'short'
  horizons: number[]
  extracted_claim: string
}

interface HorizonResult {
  n: number
  hit_rate: number
  avg_return: number
  p_value: number | null
}

interface BacktestResults {
  market_object: string
  condition: string
  n_signals: number
  horizons: Record<string, HorizonResult>
  yearly: Record<string, { hit_rate: number; n: number }>
  narrative: string
}

interface TestResponse {
  spec: HypothesisSpec
  results: BacktestResults
  narrative: string
}

interface HistoryRow {
  hypothesis_id: string
  extracted_claim: string
  market_object: string
  condition: string
  direction: string
  test_status: string
  created_at: string
}

// ── Condition definitions (for fallback form) ─────────────────────────────────

const CONDITIONS = [
  { value: 'down_streak',    label: 'Down streak (N consecutive down days)',   params: [{ key: 'days',       label: 'Days',       default: 3  }] },
  { value: 'up_streak',      label: 'Up streak (N consecutive up days)',        params: [{ key: 'days',       label: 'Days',       default: 3  }] },
  { value: 'rsi_below',      label: 'RSI below threshold',                      params: [{ key: 'threshold',  label: 'Threshold',  default: 30 }, { key: 'period', label: 'Period', default: 14 }] },
  { value: 'rsi_above',      label: 'RSI above threshold',                      params: [{ key: 'threshold',  label: 'Threshold',  default: 70 }, { key: 'period', label: 'Period', default: 14 }] },
  { value: 'gap_down',       label: 'Gap down >X% from prior close',            params: [{ key: 'pct',        label: 'Pct (%)',    default: 2  }] },
  { value: 'gap_up',         label: 'Gap up >X% from prior close',              params: [{ key: 'pct',        label: 'Pct (%)',    default: 2  }] },
  { value: 'price_below_ma', label: 'Price below N-day SMA',                    params: [{ key: 'period',     label: 'Period',     default: 50 }] },
  { value: 'price_above_ma', label: 'Price above N-day SMA',                    params: [{ key: 'period',     label: 'Period',     default: 50 }] },
  { value: 'volume_spike',   label: 'Volume spike (>N× 20-day avg)',             params: [{ key: 'multiplier', label: 'Multiplier', default: 2  }] },
]

// ── Styles (shared tokens) ────────────────────────────────────────────────────

const s = {
  card: { background: '#0d111a', border: '1px solid #1e2533', borderRadius: 8, padding: 20, marginBottom: 16 } as React.CSSProperties,
  label: { fontSize: 9, color: '#60a5fa', letterSpacing: '0.1em', marginBottom: 8 } as React.CSSProperties,
  input: { background: '#060b14', border: '1px solid #1e2533', borderRadius: 4, color: '#e5e7eb', padding: '6px 10px', fontSize: 12, fontFamily: 'inherit', boxSizing: 'border-box' as const },
  btn: (active: boolean) => ({
    background: active ? 'rgba(96,165,250,0.15)' : 'transparent',
    border: `1px solid ${active ? 'rgba(96,165,250,0.4)' : '#1e2533'}`,
    color: active ? '#93c5fd' : '#4b5563',
    padding: '7px 20px', borderRadius: 5, cursor: 'pointer',
    fontSize: 11, fontFamily: 'inherit', letterSpacing: '0.06em',
  } as React.CSSProperties),
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function pctFmt(v: number) { return `${(v * 100).toFixed(1)}%` }
function retFmt(v: number) { return `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%` }
function pFmt(p: number | null) { return p == null ? '—' : p < 0.001 ? '<0.001' : p.toFixed(3) }
function sigStars(p: number | null) { return p == null ? '' : p < 0.01 ? '**' : p < 0.05 ? '*' : '' }
function hrColor(hr: number) { return hr >= 0.65 ? '#86efac' : hr >= 0.55 ? '#fbbf24' : '#9ca3af' }

// ── Component ─────────────────────────────────────────────────────────────────

export function ConceptLab() {
  const [concept, setConcept]     = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [result, setResult]       = useState<TestResponse | null>(null)
  const [error, setError]         = useState<string | null>(null)
  const [requiresKey, setRequiresKey] = useState(false)
  const [history, setHistory]     = useState<HistoryRow[]>([])

  // Fallback structured form state
  const [fbTicker,    setFbTicker]    = useState('SPY')
  const [fbCondition, setFbCondition] = useState('down_streak')
  const [fbParams,    setFbParams]    = useState<Record<string, number>>({ days: 3 })
  const [fbDirection, setFbDirection] = useState<'long' | 'short'>('long')

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/research/hypothesis/history')
      if (res.ok) {
        const data = await res.json() as { history: HistoryRow[] }
        setHistory(data.history ?? [])
      }
    } catch { /* non-critical */ }
  }, [])

  useEffect(() => { loadHistory() }, [loadHistory])

  const runTest = async (body: { concept?: string; spec?: HypothesisSpec }) => {
    setIsLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch('/api/research/hypothesis/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json() as TestResponse & { error?: string; requiresKey?: boolean }
      if (!res.ok) {
        if (data.requiresKey) setRequiresKey(true)
        setError(data.error ?? `Request failed (${res.status})`)
      } else {
        setResult(data)
        setRequiresKey(false)
        loadHistory()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setIsLoading(false)
    }
  }

  const handleConceptSubmit = () => {
    if (!concept.trim() || isLoading) return
    runTest({ concept: concept.trim() })
  }

  const handleFallbackSubmit = () => {
    if (isLoading) return
    const spec: HypothesisSpec = {
      market_object:   fbTicker.toUpperCase(),
      condition:       fbCondition,
      condition_params: fbParams,
      direction:       fbDirection,
      horizons:        [5, 10, 20],
      extracted_claim: `${fbTicker.toUpperCase()} ${fbCondition.replace(/_/g, ' ')} → ${fbDirection}`,
    }
    runTest({ spec })
  }

  const selectedCondDef = CONDITIONS.find(c => c.value === fbCondition)

  return (
    <div style={{ fontFamily: '"JetBrains Mono", "Fira Code", monospace' }}>

      {/* ── Input card ──────────────────────────────────────────────────────── */}
      <div style={s.card}>
        <div style={s.label}>CONCEPT LAB — NATURAL LANGUAGE BACKTEST</div>
        <div style={{ fontSize: 11, color: '#4b5563', marginBottom: 16 }}>
          Describe a trading concept in plain English. Claude will parse it into a testable condition and backtest it against historical price data.
        </div>

        {!requiresKey ? (
          <>
            <textarea
              value={concept}
              onChange={e => setConcept(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleConceptSubmit() }}
              placeholder={'"buy SPY when it drops 3 days in a row" · "short QQQ when RSI above 75" · "buy after a 2% gap down"'}
              rows={3}
              style={{
                width: '100%', ...s.input, padding: '10px 12px', fontSize: 13,
                resize: 'vertical', outline: 'none', borderRadius: 6,
              }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
              <button
                onClick={handleConceptSubmit}
                disabled={isLoading || !concept.trim()}
                style={{ ...s.btn(!isLoading && !!concept.trim()), cursor: isLoading || !concept.trim() ? 'not-allowed' : 'pointer' }}
              >
                {isLoading ? '⟳ RUNNING...' : '⚡ TEST HYPOTHESIS'}
              </button>
              <span style={{ fontSize: 10, color: '#374151' }}>Ctrl+Enter</span>
            </div>
          </>
        ) : (
          // ── Fallback structured form ─────────────────────────────────────
          <>
            <div style={{ background: '#1a0f0f', border: '1px solid #7f1d1d', borderRadius: 6, padding: '10px 14px', marginBottom: 16, fontSize: 11, color: '#fca5a5' }}>
              ⚠ ANTHROPIC_API_KEY not configured — natural language parsing unavailable.
              Use the structured form below to specify the condition directly.
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <div style={{ ...s.label, marginBottom: 4 }}>TICKER</div>
                <input
                  value={fbTicker}
                  onChange={e => setFbTicker(e.target.value.toUpperCase())}
                  style={{ ...s.input, width: '100%' }}
                />
              </div>
              <div>
                <div style={{ ...s.label, marginBottom: 4 }}>DIRECTION</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {(['long', 'short'] as const).map(d => (
                    <button key={d} onClick={() => setFbDirection(d)} style={{
                      background: fbDirection === d ? (d === 'long' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)') : 'transparent',
                      border: `1px solid ${fbDirection === d ? (d === 'long' ? '#16a34a' : '#dc2626') : '#1e2533'}`,
                      color: fbDirection === d ? (d === 'long' ? '#86efac' : '#fca5a5') : '#4b5563',
                      padding: '6px 14px', borderRadius: 4, cursor: 'pointer', fontSize: 11, fontFamily: 'inherit',
                    }}>
                      {d === 'long' ? '▲ LONG' : '▼ SHORT'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <div style={{ ...s.label, marginBottom: 4 }}>CONDITION</div>
              <select
                value={fbCondition}
                onChange={e => {
                  const v = e.target.value
                  setFbCondition(v)
                  const def = CONDITIONS.find(c => c.value === v)
                  if (def) {
                    const p: Record<string, number> = {}
                    def.params.forEach(pp => { p[pp.key] = pp.default })
                    setFbParams(p)
                  }
                }}
                style={{ ...s.input, width: '100%' }}
              >
                {CONDITIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>

            {selectedCondDef && (
              <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
                {selectedCondDef.params.map(p => (
                  <div key={p.key}>
                    <div style={{ ...s.label, marginBottom: 4 }}>{p.label.toUpperCase()}</div>
                    <input
                      type="number"
                      value={fbParams[p.key] ?? p.default}
                      onChange={e => setFbParams(prev => ({ ...prev, [p.key]: Number(e.target.value) }))}
                      style={{ ...s.input, width: 80 }}
                    />
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={handleFallbackSubmit}
              disabled={isLoading}
              style={{ ...s.btn(!isLoading), cursor: isLoading ? 'not-allowed' : 'pointer' }}
            >
              {isLoading ? '⟳ RUNNING...' : '⚡ TEST HYPOTHESIS'}
            </button>
          </>
        )}

        {error && !requiresKey && (
          <div style={{ marginTop: 12, fontSize: 11, color: '#ef4444', background: '#1a0f0f', border: '1px solid #7f1d1d', borderRadius: 4, padding: '8px 12px' }}>
            {error}
          </div>
        )}
      </div>

      {/* ── Results card ────────────────────────────────────────────────────── */}
      {result && (
        <div style={s.card}>

          {/* Spec summary */}
          <div style={{ borderBottom: '1px solid #1e2533', paddingBottom: 12, marginBottom: 14 }}>
            <div style={s.label}>EXTRACTED HYPOTHESIS</div>
            <div style={{ fontSize: 13, color: '#e5e7eb', marginBottom: 8 }}>{result.spec.extracted_claim}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 10, background: 'rgba(96,165,250,0.1)', border: '1px solid rgba(96,165,250,0.2)', color: '#93c5fd', padding: '2px 8px', borderRadius: 3 }}>
                {result.spec.market_object}
              </span>
              <span style={{ fontSize: 10, color: '#6b7280' }}>{result.spec.condition.replace(/_/g, ' ')}</span>
              <span style={{ fontSize: 10, color: '#374151' }}>·</span>
              <span style={{ fontSize: 10, color: result.spec.direction === 'long' ? '#86efac' : '#fca5a5' }}>
                {result.spec.direction === 'long' ? '▲ LONG' : '▼ SHORT'}
              </span>
              <span style={{ fontSize: 10, color: '#374151' }}>·</span>
              <span style={{ fontSize: 10, color: '#6b7280' }}>{result.results.n_signals} signals</span>
            </div>
          </div>

          {/* Hit rate table */}
          <div style={{ marginBottom: 16 }}>
            <div style={s.label}>HIT RATE BY HORIZON</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr>
                  {['HORIZON', 'N', 'HIT RATE', 'AVG RETURN', 'P-VALUE', ''].map((h, i) => (
                    <th key={i} style={{ textAlign: 'left', padding: '4px 8px', color: '#374151', fontWeight: 400, borderBottom: '1px solid #1e2533', fontSize: 9 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.entries(result.results.horizons)
                  .sort(([a], [b]) => Number(a) - Number(b))
                  .map(([h, data]) => (
                    <tr key={h}>
                      <td style={{ padding: '6px 8px', color: '#9ca3af' }}>{h}d</td>
                      <td style={{ padding: '6px 8px', color: '#6b7280' }}>{data.n}</td>
                      <td style={{ padding: '6px 8px', color: hrColor(data.hit_rate), fontWeight: 600 }}>{pctFmt(data.hit_rate)}</td>
                      <td style={{ padding: '6px 8px', color: data.avg_return >= 0 ? '#86efac' : '#fca5a5' }}>{retFmt(data.avg_return)}</td>
                      <td style={{ padding: '6px 8px', color: '#6b7280' }}>{pFmt(data.p_value)}</td>
                      <td style={{ padding: '6px 8px', color: '#fbbf24', fontWeight: 700 }}>{sigStars(data.p_value)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
            <div style={{ marginTop: 6, fontSize: 9, color: '#374151' }}>* p&lt;0.05 &nbsp;&nbsp; ** p&lt;0.01 &nbsp;&nbsp; Hit rate ≥65%: green · ≥55%: yellow</div>
          </div>

          {/* Yearly breakdown */}
          {Object.keys(result.results.yearly).length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={s.label}>YEARLY BREAKDOWN (5D EXIT)</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {Object.entries(result.results.yearly).map(([year, data]) => {
                  const hr = data.hit_rate
                  const color = hr >= 0.65 ? '#86efac' : hr >= 0.55 ? '#fbbf24' : hr >= 0.45 ? '#9ca3af' : '#fca5a5'
                  return (
                    <div key={year} style={{ background: '#060b14', border: '1px solid #1e2533', borderRadius: 4, padding: '6px 10px', textAlign: 'center' }}>
                      <div style={{ fontSize: 9, color: '#4b5563', marginBottom: 2 }}>{year}</div>
                      <div style={{ fontSize: 12, color, fontWeight: 600 }}>{pctFmt(hr)}</div>
                      <div style={{ fontSize: 9, color: '#374151' }}>n={data.n}</div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Narrative */}
          <div style={{ background: '#060b14', border: '1px solid #1e2533', borderRadius: 6, padding: '12px 14px', fontSize: 12, color: '#9ca3af', lineHeight: 1.65 }}>
            {result.narrative}
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <button
              title="Save to conditional patterns — coming soon"
              style={{ background: 'transparent', border: '1px solid #1e2533', color: '#374151', padding: '6px 14px', borderRadius: 4, cursor: 'not-allowed', fontSize: 10, fontFamily: 'inherit' }}
            >
              ☆ Save to Patterns
            </button>
            <button
              title="Run across full 1,287-ticker universe — coming soon"
              style={{ background: 'transparent', border: '1px solid #1e2533', color: '#374151', padding: '6px 14px', borderRadius: 4, cursor: 'not-allowed', fontSize: 10, fontFamily: 'inherit' }}
            >
              ⟳ Run on Full Universe
            </button>
          </div>
        </div>
      )}

      {/* ── History ──────────────────────────────────────────────────────────── */}
      {history.length > 0 && (
        <div style={s.card}>
          <div style={s.label}>RECENT HYPOTHESES</div>
          <div>
            {history.map((row, idx) => (
              <div key={row.hypothesis_id} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0',
                borderBottom: idx < history.length - 1 ? '1px solid #1e2533' : 'none',
              }}>
                <span style={{ fontSize: 10, background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.15)', color: '#93c5fd', padding: '2px 6px', borderRadius: 3, minWidth: 44, textAlign: 'center' }}>
                  {row.market_object}
                </span>
                <span style={{ fontSize: 11, color: '#9ca3af', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {row.extracted_claim}
                </span>
                <span style={{ fontSize: 9, color: '#374151', whiteSpace: 'nowrap', marginLeft: 8 }}>
                  {new Date(row.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

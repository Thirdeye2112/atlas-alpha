import { useState, useEffect, useCallback } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Condition {
  type: string
  params: Record<string, number>
}

interface HypothesisSpec {
  ticker: string
  conditions: Condition[]
  direction: 'long' | 'short'
  horizons: number[]
  extracted_claim: string
}

interface HorizonResult {
  days: number
  n: number
  hit_rate: number
  avg_return: number  // percent
  p_value: number | null
}

interface BacktestResults {
  ticker: string
  conditions_desc: string
  sample_size: number
  horizons: HorizonResult[]
  yearly: Record<string, { hit_rate: number; n: number }>
  passed_permutation: boolean
  p_value: number | null
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

// ── Condition catalogue (for fallback form) ───────────────────────────────────

interface ParamDef { key: string; label: string; default: number }
interface CondDef  { value: string; label: string; params: ParamDef[] }

const CONDITIONS: CondDef[] = [
  { value: 'consecutive_down', label: 'Down streak (N consecutive down days)',      params: [{ key: 'n',          label: 'Days',       default: 3    }] },
  { value: 'consecutive_up',   label: 'Up streak (N consecutive up days)',           params: [{ key: 'n',          label: 'Days',       default: 3    }] },
  { value: 'rsi_below',        label: 'RSI below threshold',                         params: [{ key: 'threshold',  label: 'Threshold',  default: 30   }, { key: 'period', label: 'Period', default: 14 }] },
  { value: 'rsi_above',        label: 'RSI above threshold',                         params: [{ key: 'threshold',  label: 'Threshold',  default: 70   }, { key: 'period', label: 'Period', default: 14 }] },
  { value: 'price_above_sma',  label: 'Price above N-day SMA',                       params: [{ key: 'period',     label: 'Period',     default: 50   }] },
  { value: 'price_below_sma',  label: 'Price below N-day SMA',                       params: [{ key: 'period',     label: 'Period',     default: 50   }] },
  { value: 'jarvis_green',     label: 'Jarvis green (ML bullish signal)',             params: [] },
  { value: 'jarvis_red',       label: 'Jarvis red (ML bearish signal)',               params: [] },
  { value: 'gap_up',           label: 'Gap up >X% from prior close',                  params: [{ key: 'pct',        label: 'Pct (%)',    default: 2    }] },
  { value: 'gap_down',         label: 'Gap down >X% from prior close',                params: [{ key: 'pct',        label: 'Pct (%)',    default: 2    }] },
  { value: 'volume_spike',     label: 'Volume spike (>N× 20-day avg)',                params: [{ key: 'multiplier', label: 'Multiplier', default: 2    }] },
  { value: 'near_52w_high',    label: 'Near 52-week high (within X%)',                params: [{ key: 'pct',        label: 'Pct (%)',    default: 3    }] },
  { value: 'near_52w_low',     label: 'Near 52-week low (within X%)',                 params: [{ key: 'pct',        label: 'Pct (%)',    default: 3    }] },
  { value: 'nr7',              label: 'NR7 — narrowest range in 7 bars',              params: [] },
  { value: 'inside_bar',       label: 'Inside bar (range within prior bar)',           params: [] },
]

function defaultParams(condValue: string): Record<string, number> {
  const def = CONDITIONS.find(c => c.value === condValue)
  if (!def) return {}
  const p: Record<string, number> = {}
  def.params.forEach(pp => { p[pp.key] = pp.default })
  return p
}

// ── Styles ────────────────────────────────────────────────────────────────────

const card: React.CSSProperties = { background: '#0d111a', border: '1px solid #1e2533', borderRadius: 8, padding: 20, marginBottom: 16 }
const lbl:  React.CSSProperties = { fontSize: 9, color: '#60a5fa', letterSpacing: '0.1em', marginBottom: 8 }
const inp   = { background: '#060b14', border: '1px solid #1e2533', borderRadius: 4, color: '#e5e7eb', padding: '6px 10px', fontSize: 12, fontFamily: 'inherit', boxSizing: 'border-box' as const }

function PrimaryBtn({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background: disabled ? '#1e2533' : 'rgba(96,165,250,0.15)',
      border: `1px solid ${disabled ? '#1e2533' : 'rgba(96,165,250,0.4)'}`,
      color: disabled ? '#4b5563' : '#93c5fd',
      padding: '7px 20px', borderRadius: 5, cursor: disabled ? 'not-allowed' : 'pointer',
      fontSize: 11, fontFamily: 'inherit', letterSpacing: '0.06em',
    }}>{children}</button>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const pctFmt  = (v: number)          => `${(v * 100).toFixed(1)}%`
const retFmt  = (v: number)          => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
const pFmt    = (p: number | null)   => p == null ? '—' : p < 0.001 ? '<0.001' : p.toFixed(3)
const sigStar = (p: number | null)   => p == null ? '' : p < 0.01 ? '**' : p < 0.05 ? '*' : ''
const hrColor = (hr: number)         => hr >= 0.65 ? '#86efac' : hr >= 0.55 ? '#fbbf24' : '#9ca3af'

// ── Component ─────────────────────────────────────────────────────────────────

export function ConceptLab() {
  const [concept, setConcept]         = useState('')
  const [isLoading, setIsLoading]     = useState(false)
  const [result, setResult]           = useState<TestResponse | null>(null)
  const [error, setError]             = useState<string | null>(null)
  const [requiresKey, setRequiresKey] = useState(false)
  const [history, setHistory]         = useState<HistoryRow[]>([])

  // Fallback form: ticker + direction + conditions array
  const [fbTicker,    setFbTicker]    = useState('SPY')
  const [fbDirection, setFbDirection] = useState<'long' | 'short'>('long')
  const [fbConds,     setFbConds]     = useState<Condition[]>([{ type: 'consecutive_down', params: { n: 3 } }])
  const [fbNewType,   setFbNewType]   = useState('consecutive_down')

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
      const res  = await fetch('/api/research/hypothesis/test', {
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

  const handleFallbackSubmit = () => {
    if (isLoading || fbConds.length === 0) return
    const spec: HypothesisSpec = {
      ticker:         fbTicker.toUpperCase(),
      conditions:     fbConds,
      direction:      fbDirection,
      horizons:       [1, 5, 10, 20],
      extracted_claim: `${fbTicker.toUpperCase()} ${fbConds.map(c => c.type.replace(/_/g, ' ')).join(' AND ')} → ${fbDirection}`,
    }
    runTest({ spec })
  }

  const addCondition = () => {
    setFbConds(prev => [...prev, { type: fbNewType, params: defaultParams(fbNewType) }])
  }

  const removeCondition = (idx: number) => {
    setFbConds(prev => prev.filter((_, i) => i !== idx))
  }

  const updateCondParam = (idx: number, key: string, val: number) => {
    setFbConds(prev => prev.map((c, i) => i === idx ? { ...c, params: { ...c.params, [key]: val } } : c))
  }

  return (
    <div style={{ fontFamily: '"JetBrains Mono", "Fira Code", monospace' }}>

      {/* ── Input card ──────────────────────────────────────────────────────── */}
      <div style={card}>
        <div style={lbl}>CONCEPT LAB — NATURAL LANGUAGE BACKTEST</div>
        <div style={{ fontSize: 11, color: '#4b5563', marginBottom: 16 }}>
          Describe a trading concept in plain English. Claude converts it to a testable condition and backtests it against historical price data.
        </div>

        {!requiresKey ? (
          <>
            <textarea
              value={concept}
              onChange={e => setConcept(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) runTest({ concept: concept.trim() }) }}
              placeholder={'"buy SPY when it drops 3 days in a row" · "short QQQ when RSI > 75" · "buy after a 2% gap down AND RSI < 35"'}
              rows={3}
              style={{ width: '100%', ...inp, padding: '10px 12px', fontSize: 13, resize: 'vertical', outline: 'none', borderRadius: 6 }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
              <PrimaryBtn onClick={() => runTest({ concept: concept.trim() })} disabled={isLoading || !concept.trim()}>
                {isLoading ? '⟳ RUNNING...' : '⚡ TEST HYPOTHESIS'}
              </PrimaryBtn>
              <span style={{ fontSize: 10, color: '#374151' }}>Ctrl+Enter</span>
            </div>
          </>
        ) : (
          // ── Fallback structured form ─────────────────────────────────────
          <>
            <div style={{ background: '#1a0f0f', border: '1px solid #7f1d1d', borderRadius: 6, padding: '10px 14px', marginBottom: 16, fontSize: 11, color: '#fca5a5' }}>
              ⚠ ANTHROPIC_API_KEY not configured — natural language parsing unavailable. Build the condition manually below.
            </div>

            {/* Ticker + direction */}
            <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 12, marginBottom: 14 }}>
              <div>
                <div style={{ ...lbl, marginBottom: 4 }}>TICKER</div>
                <input value={fbTicker} onChange={e => setFbTicker(e.target.value.toUpperCase())}
                  style={{ ...inp, width: '100%' }} />
              </div>
              <div>
                <div style={{ ...lbl, marginBottom: 4 }}>DIRECTION</div>
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

            {/* Conditions list */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ ...lbl, marginBottom: 8 }}>CONDITIONS (AND-combined)</div>
              {fbConds.map((cond, idx) => {
                const def = CONDITIONS.find(c => c.value === cond.type)
                return (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, background: '#060b14', border: '1px solid #1e2533', borderRadius: 4, padding: '8px 10px' }}>
                    <span style={{ fontSize: 9, color: '#374151', minWidth: 24, textAlign: 'center' }}>
                      {idx === 0 ? 'IF' : 'AND'}
                    </span>
                    <span style={{ fontSize: 11, color: '#9ca3af', flex: 1 }}>{def?.label ?? cond.type}</span>
                    {def?.params.map(pp => (
                      <div key={pp.key} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ fontSize: 9, color: '#4b5563' }}>{pp.label}:</span>
                        <input type="number" value={cond.params[pp.key] ?? pp.default}
                          onChange={e => updateCondParam(idx, pp.key, Number(e.target.value))}
                          style={{ ...inp, width: 60, padding: '3px 6px' }} />
                      </div>
                    ))}
                    <button onClick={() => removeCondition(idx)} style={{ background: 'transparent', border: 'none', color: '#4b5563', cursor: 'pointer', fontSize: 13, padding: '0 4px', fontFamily: 'inherit' }}>×</button>
                  </div>
                )
              })}

              {/* Add condition row */}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <select value={fbNewType} onChange={e => setFbNewType(e.target.value)}
                  style={{ ...inp, flex: 1 }}>
                  {CONDITIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
                <button onClick={addCondition} style={{ ...inp, padding: '6px 12px', cursor: 'pointer', color: '#60a5fa', border: '1px solid rgba(96,165,250,0.3)', borderRadius: 4 }}>
                  + Add
                </button>
              </div>
            </div>

            <PrimaryBtn onClick={handleFallbackSubmit} disabled={isLoading || fbConds.length === 0}>
              {isLoading ? '⟳ RUNNING...' : '⚡ TEST HYPOTHESIS'}
            </PrimaryBtn>
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
        <div style={card}>

          {/* Header: ticker + conditions + badges */}
          <div style={{ borderBottom: '1px solid #1e2533', paddingBottom: 12, marginBottom: 14 }}>
            <div style={lbl}>BACKTEST RESULTS</div>
            <div style={{ fontSize: 13, color: '#e5e7eb', marginBottom: 8 }}>{result.spec.extracted_claim}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 10, background: 'rgba(96,165,250,0.1)', border: '1px solid rgba(96,165,250,0.2)', color: '#93c5fd', padding: '2px 8px', borderRadius: 3 }}>
                {result.results.ticker}
              </span>
              <span style={{ fontSize: 10, color: '#6b7280' }}>{result.results.conditions_desc}</span>
              <span style={{ fontSize: 10, color: '#374151' }}>·</span>
              <span style={{ fontSize: 10, color: result.spec.direction === 'long' ? '#86efac' : '#fca5a5' }}>
                {result.spec.direction === 'long' ? '▲ LONG' : '▼ SHORT'}
              </span>
              <span style={{ fontSize: 10, color: '#374151' }}>·</span>
              <span style={{ fontSize: 10, color: '#6b7280' }}>{result.results.sample_size} signals</span>
              {/* Verification badge */}
              <span style={{
                fontSize: 9, padding: '2px 8px', borderRadius: 3, fontWeight: 700,
                background: result.results.passed_permutation ? 'rgba(34,197,94,0.12)' : 'rgba(107,114,128,0.12)',
                border: `1px solid ${result.results.passed_permutation ? '#16a34a' : '#374151'}`,
                color: result.results.passed_permutation ? '#86efac' : '#6b7280',
              }}>
                {result.results.passed_permutation ? '✓ VERIFIED p<0.05' : '○ NOT SIGNIFICANT'}
              </span>
            </div>
          </div>

          {/* Hit rate table */}
          <div style={{ marginBottom: 16 }}>
            <div style={lbl}>HIT RATE BY HORIZON</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr>
                  {['HORIZON', 'N', 'HIT RATE', 'AVG RETURN', 'P-VALUE', ''].map((h, i) => (
                    <th key={i} style={{ textAlign: 'left', padding: '4px 8px', color: '#374151', fontWeight: 400, borderBottom: '1px solid #1e2533', fontSize: 9 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.results.horizons.map(h => (
                  <tr key={h.days}>
                    <td style={{ padding: '6px 8px', color: '#9ca3af' }}>{h.days}d</td>
                    <td style={{ padding: '6px 8px', color: '#6b7280' }}>{h.n}</td>
                    <td style={{ padding: '6px 8px', color: hrColor(h.hit_rate), fontWeight: 600 }}>{pctFmt(h.hit_rate)}</td>
                    <td style={{ padding: '6px 8px', color: h.avg_return >= 0 ? '#86efac' : '#fca5a5' }}>{retFmt(h.avg_return)}</td>
                    <td style={{ padding: '6px 8px', color: '#6b7280' }}>{pFmt(h.p_value)}</td>
                    <td style={{ padding: '6px 8px', color: '#fbbf24', fontWeight: 700 }}>{sigStar(h.p_value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop: 6, fontSize: 9, color: '#374151' }}>* p&lt;0.05 &nbsp; ** p&lt;0.01 &nbsp; hit rate ≥65%: green · ≥55%: yellow</div>
          </div>

          {/* Yearly breakdown */}
          {Object.keys(result.results.yearly).length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={lbl}>YEARLY BREAKDOWN (5D EXIT)</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {Object.entries(result.results.yearly).map(([year, data]) => {
                  const hr = data.hit_rate
                  const col = hr >= 0.65 ? '#86efac' : hr >= 0.55 ? '#fbbf24' : hr >= 0.45 ? '#9ca3af' : '#fca5a5'
                  return (
                    <div key={year} style={{ background: '#060b14', border: '1px solid #1e2533', borderRadius: 4, padding: '6px 10px', textAlign: 'center' }}>
                      <div style={{ fontSize: 9, color: '#4b5563', marginBottom: 2 }}>{year}</div>
                      <div style={{ fontSize: 12, color: col, fontWeight: 600 }}>{pctFmt(hr)}</div>
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
            <button title="Save to conditional patterns — coming soon"
              style={{ background: 'transparent', border: '1px solid #1e2533', color: '#374151', padding: '6px 14px', borderRadius: 4, cursor: 'not-allowed', fontSize: 10, fontFamily: 'inherit' }}>
              ☆ Save to Patterns
            </button>
            <button title="Run across full 1,287-ticker universe — coming soon"
              style={{ background: 'transparent', border: '1px solid #1e2533', color: '#374151', padding: '6px 14px', borderRadius: 4, cursor: 'not-allowed', fontSize: 10, fontFamily: 'inherit' }}>
              ⟳ Run on Full Universe
            </button>
          </div>
        </div>
      )}

      {/* ── History ──────────────────────────────────────────────────────────── */}
      {history.length > 0 && (
        <div style={card}>
          <div style={lbl}>RECENT HYPOTHESES</div>
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

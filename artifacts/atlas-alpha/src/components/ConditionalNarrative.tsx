import React from "react"
import { useConditionalContext, useSPYContext, ConditionalOutcome, ActivePattern } from "@/hooks/useConditionalContext"

// ── Colour palette (matches MLSignalBadge) ────────────────────────────────────

const C = {
  bg:      "rgba(15,23,42,0.85)",
  border:  "rgba(148,163,184,0.12)",
  green:   "#22c55e",
  red:     "#ef4444",
  yellow:  "#f59e0b",
  blue:    "#38bdf8",
  text:    "#94a3b8",
  dim:     "#475569",
  label:   "rgba(148,163,184,0.7)",
}

// ── Sub-components ────────────────────────────────────────────────────────────

function pct(v: number | null | undefined, decimals = 1): string {
  if (v == null) return "—"
  return `${(v * 100) >= 0 ? "+" : ""}${(v * 100).toFixed(decimals)}%`
}

function hitColor(rate: number): string {
  if (rate >= 0.65) return C.green
  if (rate >= 0.55) return C.yellow
  return C.text
}

function OutcomeRow({ o }: { o: ConditionalOutcome }) {
  const hc = hitColor(o.hit_rate)
  const retColor = o.avg_return >= 0 ? C.green : C.red
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 10 }}>
      <span style={{ color: C.dim, width: 22, textAlign: "right" }}>{o.horizon_days}d</span>
      <span style={{ color: hc, fontWeight: 700, width: 36 }}>{Math.round(o.hit_rate * 100)}%</span>
      <span style={{ color: retColor, width: 44 }}>{pct(o.avg_return, 2)}</span>
      <span style={{ color: C.dim }}>n={o.sample_size.toLocaleString()}</span>
    </div>
  )
}

function PatternCard({ pattern, ticker }: { pattern: ActivePattern; ticker: string }) {
  const tickerOuts = pattern.ticker_outcomes.filter(o => [5, 10, 20].includes(o.horizon_days))
  const aggOuts = pattern.aggregate_outcomes.filter(o => [5, 10, 20].includes(o.horizon_days))
  const hasTickerData = tickerOuts.length > 0

  return (
    <div style={{ padding: "8px 10px", borderRadius: 5, border: `1px solid ${C.border}`, backgroundColor: "rgba(15,23,42,0.6)", display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <span style={{ fontSize: 10, color: C.text, fontWeight: 600 }}>{pattern.description}</span>
        <span style={{ fontSize: 9, color: C.dim, marginLeft: 8, flexShrink: 0 }}>
          {pattern.condition_type.replace(/_/g, " ")}
        </span>
      </div>

      {/* Header row */}
      <div style={{ display: "flex", gap: 8, fontSize: 9, color: C.dim }}>
        <span style={{ width: 22 }}></span>
        <span style={{ width: 36 }}>hit%</span>
        <span style={{ width: 44 }}>avg ret</span>
        <span>n</span>
      </div>

      {/* Ticker-specific outcomes */}
      {hasTickerData && (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={{ fontSize: 9, color: C.blue, marginBottom: 1 }}>{ticker}</div>
          {tickerOuts.map(o => <OutcomeRow key={o.horizon_days} o={o} />)}
        </div>
      )}

      {/* Aggregate outcomes */}
      {aggOuts.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 2, borderTop: hasTickerData ? `1px solid ${C.border}` : "none", paddingTop: hasTickerData ? 4 : 0 }}>
          {hasTickerData && <div style={{ fontSize: 9, color: C.dim, marginBottom: 1 }}>SP500 avg</div>}
          {aggOuts.map(o => <OutcomeRow key={o.horizon_days} o={o} />)}
        </div>
      )}

      {!hasTickerData && aggOuts.length === 0 && (
        <div style={{ fontSize: 9, color: C.dim }}>No backtest data available</div>
      )}
    </div>
  )
}

function SPYBanner({ ticker }: { ticker: string }) {
  const { spyContext, isLoading, streakActive } = useSPYContext()
  if (isLoading || !spyContext.available || !streakActive) return null

  const { streak, best_5d, spy_change_pct } = spyContext
  if (!streak) return null

  const isDown = streak.direction === "down"
  const color = isDown ? C.red : C.green
  const arrow = isDown ? "↓" : "↑"
  const label = isDown ? "oversold" : "extended"
  const changeFmt = spy_change_pct != null ? ` (${spy_change_pct >= 0 ? "+" : ""}${spy_change_pct.toFixed(2)}%)` : ""

  return (
    <div style={{
      padding: "7px 10px",
      borderRadius: 5,
      border: `1px solid ${color}30`,
      backgroundColor: `${color}0d`,
      display: "flex",
      flexDirection: "column",
      gap: 4,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 9, color: C.dim, letterSpacing: "0.08em", fontWeight: 600, textTransform: "uppercase" }}>
          SPY Regime
        </span>
        <span style={{ fontSize: 9, color: C.dim }}>{spyContext.as_of}</span>
      </div>
      <div style={{ fontSize: 11, color, fontWeight: 700 }}>
        {arrow} SPY {isDown ? "down" : "up"} {streak.days} day{streak.days > 1 ? "s" : ""}{changeFmt} — {label}
      </div>
      {best_5d && (
        <div style={{ fontSize: 10, color: C.text }}>
          In {best_5d.sample_size} similar setups:{" "}
          <span style={{ color: hitColor(best_5d.hit_rate), fontWeight: 600 }}>
            {Math.round(best_5d.hit_rate * 100)}% recovered
          </span>{" "}
          within 5d (avg {pct(best_5d.avg_return, 2)})
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function ConditionalNarrative({ ticker, className = "" }: { ticker?: string; className?: string }) {
  const { context, isLoading, available, activePatterns } = useConditionalContext(ticker)

  // Always render the SPY banner (it manages its own visibility)
  const spyBanner = ticker ? <SPYBanner ticker={ticker} /> : null

  if (!ticker) return null

  if (isLoading) {
    return (
      <div className={className} style={{ padding: "8px 10px", borderRadius: 6, border: `1px solid ${C.border}`, backgroundColor: C.bg }}>
        <div style={{ fontSize: 9, color: C.dim, letterSpacing: "0.08em", fontWeight: 600, textTransform: "uppercase" }}>
          Pattern Context
        </div>
        <div style={{ fontSize: 10, color: C.dim, marginTop: 4 }}>Loading...</div>
      </div>
    )
  }

  // No active patterns — only render if SPY banner is also invisible (handled by SPYBanner itself)
  if (!available || activePatterns.length === 0) {
    // Still render SPY banner wrapper — it will be null if no streak
    return <div className={className}>{spyBanner}</div>
  }

  return (
    <div className={className} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {spyBanner}
      <div style={{ padding: "8px 10px", borderRadius: 6, border: `1px solid ${C.border}`, backgroundColor: C.bg, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 9, color: C.dim, letterSpacing: "0.08em", fontWeight: 600, textTransform: "uppercase" }}>
            Pattern Context
          </span>
          <span style={{ fontSize: 9, color: C.dim }}>{context.as_of}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {activePatterns.map(p => (
            <PatternCard key={p.pattern_name} pattern={p} ticker={ticker} />
          ))}
        </div>
      </div>
    </div>
  )
}

export default ConditionalNarrative

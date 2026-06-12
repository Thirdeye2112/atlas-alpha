import React from "react"
import { useQuery } from "@tanstack/react-query"

interface TargetData {
  ticker: string
  price: number
  atr_14: number
  direction: "BULLISH" | "BEARISH" | "NEUTRAL"
  stop: number; stop_pct: number
  t1: number; t1_pct: number; t1_rr: number
  t2: number; t2_pct: number; t2_rr: number
  t3: number; t3_pct: number; t3_rr: number
  swing_high_20d: number; swing_low_20d: number
  fib_t3: number
  available: boolean
}

const C = {
  bg: "rgba(15,23,42,0.85)",
  border: "rgba(148,163,184,0.12)",
  dim: "#475569",
  text: "#94a3b8",
  stop: "#ef4444",
  t1: "#f59e0b",
  t2: "#22c55e",
  t3: "#4ade80",
}

function fmt(p: number): string {
  return `$${p.toFixed(2)}`
}
function fmtPct(p: number): string {
  return `${p >= 0 ? "+" : ""}${p.toFixed(1)}%`
}

function Row({ label, price, pct, rr, color }: {
  label: string; price: number; pct: number; rr?: number; color: string
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4 }}>
      <span style={{
        fontSize: 10, fontWeight: 700, fontFamily: "monospace",
        color, minWidth: 32
      }}>{label}</span>
      <span style={{ fontSize: 11, fontWeight: 600, color, fontFamily: "monospace", flex: 1, textAlign: "right" }}>
        {fmt(price)}
      </span>
      <span style={{ fontSize: 10, color: C.text, fontFamily: "monospace", minWidth: 44, textAlign: "right" }}>
        {fmtPct(pct)}
      </span>
      {rr !== undefined && (
        <span style={{ fontSize: 9, color: C.dim, fontFamily: "monospace", minWidth: 32, textAlign: "right" }}>
          {rr.toFixed(1)}R
        </span>
      )}
    </div>
  )
}

export function SignalTargets({ ticker, className = "" }: { ticker?: string; className?: string }) {
  const { data, isLoading } = useQuery<TargetData>({
    queryKey: ["targets", ticker],
    queryFn: () => fetch(`/api/targets/${encodeURIComponent(ticker!)}`).then(r => r.json()),
    enabled: !!ticker,
    staleTime: 5 * 60 * 1000,
    retry: false,
  })

  if (!ticker || isLoading) return null
  if (!data?.available) return null

  const isLong = data.direction !== "BEARISH"
  const dirLabel = isLong ? "Long Setup" : "Short Setup"
  const dirColor = isLong ? "#22c55e" : "#ef4444"

  return (
    <div
      className={className}
      style={{
        padding: "10px 12px",
        borderRadius: 6,
        border: `1px solid ${C.border}`,
        backgroundColor: C.bg,
        display: "flex",
        flexDirection: "column",
        gap: 7,
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 9, color: C.dim, letterSpacing: "0.08em", fontWeight: 600, textTransform: "uppercase", fontFamily: "monospace" }}>
          Price Targets
        </span>
        <span style={{ fontSize: 9, fontWeight: 700, color: dirColor, fontFamily: "monospace" }}>
          {dirLabel}
        </span>
      </div>

      {/* ATR info */}
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontSize: 9, color: C.dim, fontFamily: "monospace" }}>ATR(14)</span>
        <span style={{ fontSize: 9, color: C.text, fontFamily: "monospace" }}>${data.atr_14.toFixed(2)}</span>
      </div>

      {/* Divider */}
      <div style={{ borderTop: `1px solid ${C.border}` }} />

      {/* Target rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <Row label="STOP" price={data.stop} pct={data.stop_pct} color={C.stop} />
        <Row label="T1"   price={data.t1}   pct={data.t1_pct}   rr={data.t1_rr} color={C.t1} />
        <Row label="T2"   price={data.t2}   pct={data.t2_pct}   rr={data.t2_rr} color={C.t2} />
        <Row label="T3"   price={data.t3}   pct={data.t3_pct}   rr={data.t3_rr} color={C.t3} />
      </div>

      {/* Fib T3 */}
      <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 5 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 9, color: C.dim, fontFamily: "monospace" }}>Fib 2.618×</span>
          <span style={{ fontSize: 10, color: "#a78bfa", fontWeight: 600, fontFamily: "monospace" }}>{fmt(data.fib_t3)}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3 }}>
          <span style={{ fontSize: 9, color: C.dim, fontFamily: "monospace" }}>20d High</span>
          <span style={{ fontSize: 9, color: C.text, fontFamily: "monospace" }}>{fmt(data.swing_high_20d)}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ fontSize: 9, color: C.dim, fontFamily: "monospace" }}>20d Low</span>
          <span style={{ fontSize: 9, color: C.text, fontFamily: "monospace" }}>{fmt(data.swing_low_20d)}</span>
        </div>
      </div>
    </div>
  )
}

export default SignalTargets

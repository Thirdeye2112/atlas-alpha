/**
 * ScannerMLCell.tsx
 * -----------------
 * Scanner row ML enrichment — rank badge + direction arrow.
 *
 * Optional `enrichmentItem` prop (BatchEnrichmentResult) adds
 * confluence dot, meta-top-20 badge, and template ⚡ flash.
 * Pass it from useBatchEnrichment in the parent scanner.
 * If absent, only the core rank+direction renders.
 */

import React from "react"
import { useMLSignals, type MLSignal, type MLSignalStrength, type MLDirection } from "@/hooks/useMLSignal"
import type { BatchEnrichmentResult } from "@/hooks/useResearchAdvanced"

const C = {
  STRONG:   "#22c55e",
  MODERATE: "#f59e0b",
  WEAK:     "#64748b",
  NEUTRAL:  "#475569",
  BULLISH:  "#22c55e",
  BEARISH:  "#ef4444",
  dim:      "#475569",
  text:     "#94a3b8",
}

export function useScannerML(tickers: string[]) { return useMLSignals(tickers) }

function RankBadge({ rank }: { rank: number | null; strength?: MLSignalStrength }) {
  if (rank == null) return <span style={{ fontSize: 11, color: C.dim }}>—</span>
  const r = Math.round(rank)
  const color = r >= 75 ? C.STRONG : r >= 50 ? C.MODERATE : r >= 25 ? C.WEAK : C.NEUTRAL
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      width: 30, height: 18, borderRadius: 3,
      backgroundColor: `${color}18`, border: `1px solid ${color}35`,
      fontSize: 10, fontWeight: 700, color,
    }}>
      {r}
    </span>
  )
}

function DirectionIcon({ direction }: { direction: MLDirection }) {
  const map: Record<MLDirection, { icon: string; color: string }> = {
    BULLISH: { icon: "↑", color: C.BULLISH },
    BEARISH: { icon: "↓", color: C.BEARISH },
    NEUTRAL: { icon: "→", color: C.NEUTRAL },
  }
  const cfg = map[direction] ?? map.NEUTRAL
  return <span style={{ fontSize: 11, color: cfg.color, fontWeight: 700, lineHeight: "1" }}>{cfg.icon}</span>
}

// ── Priority 4 enrichment badges ─────────────────────────────────────────────

function ConfDot({ score }: { score: number | null | undefined }) {
  if (score == null) return null
  const color = score >= 75 ? C.STRONG : score >= 55 ? C.MODERATE : C.NEUTRAL
  return (
    <span
      title={`Confluence ${Math.round(score)}`}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 22, height: 18, borderRadius: 3,
        backgroundColor: `${color}12`, border: `1px solid ${color}28`,
        fontSize: 9, fontWeight: 700, color,
      }}
    >
      {Math.round(score)}
    </span>
  )
}

function MetaBadge({ top20 }: { top20: boolean }) {
  if (!top20) return null
  return (
    <span
      title="Meta top 20%"
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        padding: "1px 4px", borderRadius: 3, height: 18,
        fontSize: 8, fontWeight: 800, letterSpacing: "0.04em",
        color: C.STRONG, backgroundColor: "rgba(34,197,94,0.10)",
        border: "1px solid rgba(34,197,94,0.26)",
      }}
    >
      F
    </span>
  )
}

function TemplateFlash({ eligible }: { eligible: boolean }) {
  if (!eligible) return null
  return <span title="Template eligible" style={{ fontSize: 11, lineHeight: "1" }}>⚡</span>
}

// ── Main cell ─────────────────────────────────────────────────────────────────

export function ScannerMLCell({
  signal,
  showProbability = false,
  enrichmentItem = null,
}: {
  signal: MLSignal
  showProbability?: boolean
  enrichmentItem?: BatchEnrichmentResult | null
}) {
  if (!signal.available) {
    return <div style={{ display: "flex", alignItems: "center", gap: 5, opacity: 0.3 }}><span style={{ fontSize: 10, color: C.dim }}>—</span></div>
  }
  const prob    = signal.ml_probability_positive
  const probPct = prob != null ? Math.round(prob * 100) : null

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "nowrap" }}>
      <RankBadge rank={signal.ml_rank_percentile} strength={signal.ml_signal_strength} />
      <DirectionIcon direction={signal.ml_direction} />
      {showProbability && probPct != null && (
        <span style={{ fontSize: 10, color: probPct >= 55 ? C.BULLISH : probPct <= 45 ? C.BEARISH : C.dim }}>{probPct}%</span>
      )}
      {enrichmentItem && (
        <>
          <ConfDot score={enrichmentItem.confluence_score} />
          <MetaBadge top20={enrichmentItem.top_20_pct} />
          <TemplateFlash eligible={enrichmentItem.eligible} />
        </>
      )}
    </div>
  )
}

export function ScannerMLHeader({ showEnrichment = false }: { showEnrichment?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <span style={{ fontSize: 10, fontWeight: 600, color: C.text }}>ML</span>
      <span style={{ fontSize: 9, color: C.dim }}>{showEnrichment ? "Rank · CF · F" : "Rank"}</span>
    </div>
  )
}

export function MLDirectionFilter({
  value,
  onChange,
}: {
  value: "ALL" | "BULLISH" | "BEARISH" | "STRONG"
  onChange: (v: "ALL" | "BULLISH" | "BEARISH" | "STRONG") => void
}) {
  const opts = [
    { key: "ALL",     label: "All" },
    { key: "BULLISH", label: "↑ Bull" },
    { key: "BEARISH", label: "↓ Bear" },
    { key: "STRONG",  label: "★ Strong" },
  ] as const
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
      <span style={{ fontSize: 10, color: C.dim, marginRight: 4 }}>ML:</span>
      {opts.map(o => (
        <button key={o.key} onClick={() => onChange(o.key)} style={{
          padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 500, cursor: "pointer",
          border: "1px solid",
          borderColor: value === o.key ? C.MODERATE : "rgba(148,163,184,0.2)",
          backgroundColor: value === o.key ? `${C.MODERATE}18` : "transparent",
          color: value === o.key ? C.MODERATE : C.dim,
        }}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function filterByMLDirection<T extends { ticker: string }>(
  results: T[],
  filter: "ALL" | "BULLISH" | "BEARISH" | "STRONG",
  getSignal: (t: string) => MLSignal,
): T[] {
  if (filter === "ALL") return results
  return results.filter(r => {
    const s = getSignal(r.ticker)
    if (!s.available) return false
    if (filter === "STRONG")  return s.ml_signal_strength === "STRONG"
    if (filter === "BULLISH") return s.ml_direction === "BULLISH"
    if (filter === "BEARISH") return s.ml_direction === "BEARISH"
    return true
  })
}

export default ScannerMLCell

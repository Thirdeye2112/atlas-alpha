import React from "react"

// Validated multi-modality confluence read (the "confidence gate"). Mirrors the
// api-server AnalysisResult.confluence shape (lib/confluenceStore.ts). POSITIVE-ONLY:
// only validated, direction-aligned, in-regime layers carry weight; null layers show
// with weight 0. The gate lifts confidenceScore only, never the directional score.
export interface ConfluenceLayer {
  layer: string
  signal: string
  dir?: string
  weight: number
  validated: boolean
  note?: string
}
export interface ConfluenceEvidence {
  lift: number
  tier: number
  layers: ConfluenceLayer[]
  veto: string[]
  asOf: string
}

const C = {
  bg:     "rgba(15,23,42,0.85)",
  border: "rgba(148,163,184,0.12)",
  green:  "#22c55e",
  red:    "#ef4444",
  yellow: "#f59e0b",
  blue:   "#38bdf8",
  text:   "#94a3b8",
  dim:    "#475569",
  label:  "rgba(148,163,184,0.7)",
}

const TIER_LABEL = ["none", "low", "moderate", "high", "max"] as const

export function ConfluencePanel({ confluence }: { confluence?: ConfluenceEvidence | null }) {
  if (!confluence) return null
  const { lift, tier, layers, veto, asOf } = confluence
  const gateCrossed = tier >= 1
  const tierColor = tier >= 3 ? C.green : tier >= 1 ? C.yellow : C.dim

  return (
    <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: 10, fontSize: 11 }}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ color: C.label, fontWeight: 700, letterSpacing: 0.5 }}>CONFLUENCE</span>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: tierColor, fontWeight: 700 }}>
            tier {tier} · {TIER_LABEL[Math.max(0, Math.min(4, tier))]}
          </span>
          <span style={{ color: C.dim }}>lift {lift.toFixed(2)}</span>
        </span>
      </div>

      {/* gate status */}
      <div style={{ color: gateCrossed ? C.green : C.dim, fontSize: 10, marginBottom: 6 }}>
        {gateCrossed
          ? "✓ Validated confluence present — confidence lifted"
          : "No validated confluence — confidence unchanged"}
      </div>

      {/* per-layer evidence */}
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {layers.map((l, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10 }}>
            <span style={{ color: C.dim, width: 78 }}>{l.layer}</span>
            <span style={{ color: l.validated ? C.text : C.dim, flex: 1 }}>
              {l.signal}{l.dir ? ` (${l.dir})` : ""}
            </span>
            {l.weight > 0
              ? <span style={{ color: C.green, fontWeight: 700, width: 42, textAlign: "right" }}>+{l.weight.toFixed(2)}</span>
              : <span style={{ color: C.dim, width: 42, textAlign: "right" }}>{l.validated ? "0" : "—"}</span>}
          </div>
        ))}
      </div>

      {/* contrary-evidence veto */}
      {veto && veto.length > 0 && (
        <div style={{ color: C.red, fontSize: 10, marginTop: 6 }}>
          ⚠ contrary validated pattern(s): {veto.join(", ")}
        </div>
      )}

      <div style={{ color: C.dim, fontSize: 9, marginTop: 6 }}>
        daily signal · as of {asOf?.slice(0, 10)} · lifts confidence only
      </div>
    </div>
  )
}

export default ConfluencePanel

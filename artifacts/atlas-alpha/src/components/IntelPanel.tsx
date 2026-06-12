import React, { useState, useEffect } from "react"
import { cn } from "@/lib/utils"
import { useMLSignal } from "@/hooks/useMLSignal"
import { useSPYContext } from "@/hooks/useConditionalContext"
import { useQuery } from "@tanstack/react-query"
import SignalTargets from "./SignalTargets"
import IPOAnalysis from "./IPOAnalysis"

interface Analysis {
  atlasScore: {
    signalNarrative?: string | null
    direction?: string | null
  }
}

interface SectorSnapshot {
  available: boolean
  regime: string
  leaders: { ticker: string; rs_20d: number | null }[]
}

const C = {
  border: "rgba(148,163,184,0.12)",
  dim:    "#475569",
  text:   "#94a3b8",
  green:  "#22c55e",
  red:    "#ef4444",
  amber:  "#f59e0b",
}

function pctFmt(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span style={{ fontSize: 10, color: C.dim }}>{label}</span>
      <span style={{ fontSize: 10, color: C.text, fontWeight: 500 }}>{value}</span>
    </div>
  )
}

interface Props {
  ticker?: string
  analysis?: Analysis | null
}

export function IntelPanel({ ticker, analysis }: Props) {
  const [tab, setTab] = useState<"SCORE" | "INTEL" | "TARGETS">("SCORE")

  useEffect(() => { setTab("SCORE") }, [ticker])

  const { signal } = useMLSignal(ticker)
  const { spyContext, streakActive } = useSPYContext()
  const { data: sectorData } = useQuery<SectorSnapshot>({
    queryKey: ["sector-snapshot"],
    queryFn: () => fetch("/api/research/sectors/snapshot").then(r => r.json()),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  })

  const jarvisGreen = signal.jarvis_green ?? signal.omni_green
  const jarvisDist  = signal.jarvis_distance_pct ?? signal.omni_distance_pct
  const ic = signal.wf_mean_ic
  const edgeLabel = ic == null ? null : ic < 0.02 ? "Early stage" : ic < 0.04 ? "Developing" : ic < 0.06 ? "Moderate edge" : "Strong edge"

  const jarvisColor = jarvisGreen == null ? C.dim : jarvisGreen ? C.green : C.red
  const jarvisLabel = jarvisGreen == null ? "—" : jarvisGreen ? "Green" : "Red"
  const jarvisDistFmt = jarvisDist != null ? pctFmt(jarvisDist) : ""

  const rank = signal.ml_rank_percentile != null ? Math.round(signal.ml_rank_percentile) : null
  const prob = signal.ml_probability_positive != null ? Math.round(signal.ml_probability_positive * 100) : null
  const probColor = prob == null ? C.dim : prob >= 55 ? C.green : prob <= 45 ? C.red : C.amber

  const sectorRegime = sectorData?.available ? sectorData.regime : null
  const sectorLeader = sectorData?.leaders?.[0]?.ticker ?? null

  const spyStreak = spyContext?.streak
  const spyBest5d = spyContext?.best_5d

  const narrative = analysis?.atlasScore?.signalNarrative ?? null

  const intelDot = jarvisGreen === true ? " \u{1F7E2}" : ""

  return (
    <div className="w-full">
      <div className="flex" style={{ borderBottom: `1px solid ${C.border}` }}>
        {(["SCORE", "INTEL", "TARGETS"] as const).map(t => {
          const label = t === "INTEL" ? `INTEL${intelDot}` : t
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "flex-1 py-1.5 text-[10px] font-mono font-bold tracking-widest uppercase transition-colors",
                "border-b-2 -mb-px",
                tab === t
                  ? "text-primary border-primary"
                  : "text-muted-foreground/40 border-transparent hover:text-muted-foreground/70"
              )}
            >
              {label}
            </button>
          )
        })}
      </div>

      <div className="mt-2">
        {tab === "SCORE" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {sectorRegime && (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "2px 0" }}>
                <span style={{ fontSize: 9, color: C.dim, letterSpacing: "0.08em", textTransform: "uppercase" }}>Regime</span>
                <span style={{ fontSize: 10, color: C.text, fontWeight: 600, textTransform: "capitalize" }}>
                  {sectorRegime}{sectorLeader ? ` · ${sectorLeader}` : ""}
                </span>
              </div>
            )}
            {narrative && (
              <p style={{ fontSize: 10, color: C.text, lineHeight: 1.55, margin: 0 }}>{narrative}</p>
            )}
          </div>
        )}

        {tab === "INTEL" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {/* Jarvis */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", backgroundColor: jarvisColor, flexShrink: 0, display: "inline-block" }} />
                <span style={{ fontSize: 10, color: C.dim }}>Jarvis</span>
              </div>
              <span style={{ fontSize: 11, color: jarvisColor, fontWeight: 600 }}>
                {jarvisLabel}{jarvisDistFmt ? ` ${jarvisDistFmt} above` : ""}
              </span>
            </div>

            {/* ML Rank */}
            {rank != null && (
              <Row label="ML Rank" value={
                <span style={{ color: rank >= 75 ? C.green : rank >= 50 ? C.amber : C.text }}>
                  {rank}th{edgeLabel ? ` · ${edgeLabel}` : ""}
                </span>
              } />
            )}

            {/* P(+5d) */}
            {prob != null && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                  <span style={{ fontSize: 10, color: C.dim }}>P(+5d)</span>
                  <span style={{ fontSize: 10, color: probColor, fontWeight: 600 }}>{prob}%</span>
                </div>
                <div style={{ height: 3, borderRadius: 2, backgroundColor: "rgba(148,163,184,0.15)", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${prob}%`, borderRadius: 2, backgroundColor: probColor, transition: "width 0.4s ease" }} />
                </div>
              </div>
            )}

            {/* SPY streak */}
            {streakActive && spyStreak && (
              <Row label="Streak" value={
                <span style={{ color: spyStreak.direction === "down" ? C.red : C.green }}>
                  {spyStreak.direction === "down" ? "↓" : "↑"}{spyStreak.days}d
                  {spyBest5d ? ` · ${Math.round(spyBest5d.hit_rate * 100)}% rev 5d` : ""}
                </span>
              } />
            )}

            {/* Sector */}
            {sectorRegime && (
              <Row label="Sector" value={
                <span style={{ textTransform: "capitalize" }}>
                  {sectorRegime}{sectorLeader ? ` · ${sectorLeader}` : ""}
                </span>
              } />
            )}

            {/* Model note */}
            {ic != null && edgeLabel && (
              <div style={{ paddingTop: 6, borderTop: `1px solid ${C.border}` }}>
                <span style={{ fontSize: 9, color: C.dim }}>
                  WF IC {ic.toFixed(3)} — {edgeLabel} | 12 folds
                </span>
              </div>
            )}

            {/* IPO analysis — renders null for non-IPO tickers */}
            <IPOAnalysis ticker={ticker} />
          </div>
        )}

        {tab === "TARGETS" && <SignalTargets ticker={ticker} />}
      </div>
    </div>
  )
}

export default IntelPanel

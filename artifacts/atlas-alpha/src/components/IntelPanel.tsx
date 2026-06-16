import React, { useState, useEffect } from "react"
import { cn } from "@/lib/utils"
import { useMLSignal } from "@/hooks/useMLSignal"
import { useSPYContext } from "@/hooks/useConditionalContext"
import { useQuery } from "@tanstack/react-query"
import {
  useConfluence,
  useMetaSignal,
  useIntradayBehavior,
  useTemplateEligible,
  confluenceColor,
  confluenceLabel,
  sentimentColor,
  fmtLift,
  type BehaviorEvent,
} from "@/hooks/useResearchAdvanced"
import SignalTargets from "./SignalTargets"
import IPOAnalysis from "./IPOAnalysis"
import { SignalExplanationPanel } from "./SignalExplanationPanel"

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

// ── Palette ──────────────────────────────────────────────────────────────────
const C = {
  border:  "rgba(148,163,184,0.12)",
  dim:     "#475569",
  text:    "#94a3b8",
  green:   "#22c55e",
  red:     "#ef4444",
  amber:   "#f59e0b",
  blue:    "#3b82f6",
}

function pctFmt(v: number) { return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%` }

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span style={{ fontSize: 10, color: C.dim }}>{label}</span>
      <span style={{ fontSize: 10, color: C.text, fontWeight: 500 }}>{value}</span>
    </div>
  )
}

function MiniBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div style={{ height: 3, borderRadius: 2, background: "rgba(148,163,184,0.10)", overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${Math.min(100, Math.max(0, pct))}%`, background: color, borderRadius: 2, transition: "width 0.4s ease" }} />
    </div>
  )
}

function GateChip({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span style={{
      fontSize: 8, padding: "1px 4px", borderRadius: 3, fontWeight: 700, letterSpacing: "0.04em",
      color: ok ? C.green : C.dim,
      background: ok ? "rgba(34,197,94,0.10)" : "rgba(71,85,105,0.10)",
      border: `1px solid ${ok ? "rgba(34,197,94,0.22)" : "rgba(71,85,105,0.22)"}`,
    }}>
      {label}
    </span>
  )
}

// ── ML tab sub-sections ───────────────────────────────────────────────────────

function TemplateSection({ ticker }: { ticker: string }) {
  const { template } = useTemplateEligible(ticker)
  const { rank_ok, ic_ok, confluence_ok, meta_top20 } = template.checks
  const d = template.data

  return (
    <div style={{
      padding: "6px 8px", borderRadius: 5,
      background: template.eligible ? "rgba(34,197,94,0.07)" : "rgba(71,85,105,0.08)",
      border: `1px solid ${template.eligible ? "rgba(34,197,94,0.20)" : "rgba(71,85,105,0.20)"}`,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <span style={{ fontSize: 10, color: template.eligible ? C.green : C.dim, fontWeight: 700 }}>
          {template.eligible ? "⚡ Template Eligible" : "Template Gate"}
        </span>
        <div style={{ display: "flex", gap: 3 }}>
          <GateChip label="RANK" ok={rank_ok} />
          <GateChip label="IC" ok={ic_ok} />
          <GateChip label="CF" ok={confluence_ok} />
          <GateChip label="META" ok={meta_top20} />
        </div>
      </div>
      <div style={{ display: "flex", gap: 12 }}>
        {d.rank_percentile != null && (
          <div>
            <div style={{ fontSize: 9, color: C.dim }}>Rank</div>
            <div style={{ fontSize: 11, fontWeight: 600, color: d.rank_percentile >= 70 ? C.green : C.text }}>
              {Math.round(d.rank_percentile)}th
            </div>
          </div>
        )}
        {d.probability_positive != null && (
          <div>
            <div style={{ fontSize: 9, color: C.dim }}>P(+)</div>
            <div style={{ fontSize: 11, fontWeight: 600, color: d.probability_positive >= 0.55 ? C.green : d.probability_positive <= 0.45 ? C.red : C.text }}>
              {Math.round(d.probability_positive * 100)}%
            </div>
          </div>
        )}
        {d.mean_ic != null && (
          <div>
            <div style={{ fontSize: 9, color: C.dim }}>IC</div>
            <div style={{ fontSize: 11, fontWeight: 600, color: d.mean_ic >= 0.04 ? C.green : C.text }}>
              {d.mean_ic.toFixed(3)}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ConfluenceSection({ ticker }: { ticker: string }) {
  const { confluence } = useConfluence(ticker)
  if (!confluence.available) return null
  const score = confluence.confluence_score
  const color = confluenceColor(score)
  const label = confluenceLabel(score)
  const components = confluence.component_scores ? Object.entries(confluence.component_scores) : []

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <span style={{ fontSize: 10, color: C.dim }}>Confluence</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {confluence.quality_tier && (
            <span style={{ fontSize: 9, color: C.dim }}>{confluence.quality_tier}</span>
          )}
          {score != null && (
            <span style={{ fontSize: 11, color, fontWeight: 700 }}>
              {Math.round(score)} <span style={{ fontSize: 9, fontWeight: 500 }}>{label}</span>
            </span>
          )}
        </div>
      </div>
      {score != null && <MiniBar pct={score} color={color} />}
      {components.length > 0 && (
        <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 3 }}>
          {components.slice(0, 4).map(([k, v]) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 9, color: C.dim, textTransform: "capitalize" }}>
                {k.replace(/_/g, " ")}
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <div style={{ width: 40, height: 2, background: "rgba(148,163,184,0.10)", borderRadius: 1, overflow: "hidden" }}>
                  <div style={{ width: `${Math.min(100, v)}%`, height: "100%", background: confluenceColor(v), borderRadius: 1 }} />
                </div>
                <span style={{ fontSize: 9, color: confluenceColor(v), fontWeight: 600, minWidth: 22, textAlign: "right" }}>{Math.round(v)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function MetaSection({ ticker }: { ticker: string }) {
  const { meta } = useMetaSignal(ticker)
  if (!meta.available) return null

  return (
    <div style={{
      padding: "6px 8px", borderRadius: 5,
      background: "rgba(59,130,246,0.06)",
      border: "1px solid rgba(59,130,246,0.16)",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
        <span style={{ fontSize: 9, color: C.blue, fontWeight: 700, letterSpacing: "0.07em" }}>META SIGNAL</span>
        <span style={{
          fontSize: 8, fontWeight: 800, padding: "1px 5px", borderRadius: 3,
          color: meta.top_20_pct ? C.green : C.dim,
          background: meta.top_20_pct ? "rgba(34,197,94,0.12)" : "transparent",
          border: `1px solid ${meta.top_20_pct ? "rgba(34,197,94,0.28)" : "transparent"}`,
        }}>
          {meta.top_20_pct ? "TOP 20%" : "STANDARD"}
        </span>
      </div>
      {meta.combo_key && (
        <div style={{ fontSize: 9, color: C.dim, fontFamily: "monospace", marginBottom: 5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {meta.combo_key}
        </div>
      )}
      <div style={{ display: "flex", gap: 14 }}>
        {meta.expected_return_avg != null && (
          <div>
            <div style={{ fontSize: 9, color: C.dim }}>Exp Ret</div>
            <div style={{ fontSize: 11, fontWeight: 600, color: meta.expected_return_avg >= 0 ? C.green : C.red }}>
              {pctFmt(meta.expected_return_avg * 100)}
            </div>
          </div>
        )}
        {meta.win_rate != null && (
          <div>
            <div style={{ fontSize: 9, color: C.dim }}>Win Rate</div>
            <div style={{ fontSize: 11, fontWeight: 600, color: meta.win_rate >= 0.55 ? C.green : C.text }}>
              {Math.round(meta.win_rate * 100)}%
            </div>
          </div>
        )}
        {meta.composite_score != null && (
          <div>
            <div style={{ fontSize: 9, color: C.dim }}>Score</div>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.text }}>{meta.composite_score.toFixed(2)}</div>
          </div>
        )}
        {meta.n_signals != null && (
          <div>
            <div style={{ fontSize: 9, color: C.dim }}>Signals</div>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.text }}>{meta.n_signals}</div>
          </div>
        )}
      </div>
    </div>
  )
}

function BehaviorEventChip({ ev }: { ev: BehaviorEvent }) {
  const color = sentimentColor(ev.sentiment)
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "flex-start",
      padding: "3px 6px", borderRadius: 4,
      background: `${color}09`, border: `1px solid ${color}22`,
    }}>
      <div style={{ minWidth: 0 }}>
        <span style={{ fontSize: 9, color, fontWeight: 600 }}>{ev.label}</span>
        {ev.description && (
          <div style={{ fontSize: 8, color: C.dim, marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 160 }}>
            {ev.description}
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 6, flexShrink: 0, marginLeft: 6, alignItems: "center" }}>
        {ev.hit_lift != null && (
          <span style={{ fontSize: 9, color, fontWeight: 700 }}>{fmtLift(ev.hit_lift)}</span>
        )}
        {ev.confidence != null && (
          <span style={{ fontSize: 9, color: C.dim }}>{Math.round(ev.confidence * 100)}%</span>
        )}
      </div>
    </div>
  )
}

function BehaviorSection({ ticker }: { ticker: string }) {
  const { behavior } = useIntradayBehavior(ticker)
  if (!behavior.available || behavior.events.length === 0) return null

  const bullishCount = behavior.events.filter(e => e.sentiment === "bullish").length
  const bearishCount = behavior.events.filter(e => e.sentiment === "bearish").length
  const dominant = bullishCount > bearishCount ? "BULLISH" : bearishCount > bullishCount ? "BEARISH" : "MIXED"
  const dirColor = dominant === "BULLISH" ? C.green : dominant === "BEARISH" ? C.red : C.amber

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
        <span style={{ fontSize: 9, color: C.dim, letterSpacing: "0.07em", textTransform: "uppercase" }}>Behavior</span>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ fontSize: 9, color: dirColor, fontWeight: 700 }}>
            {dominant === "BULLISH" ? "↑" : dominant === "BEARISH" ? "↓" : "↔"} {dominant}
          </span>
          <span style={{ fontSize: 9, color: C.dim }}>{bullishCount}↑ {bearishCount}↓</span>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {behavior.events.slice(0, 3).map((ev, i) => (
          <BehaviorEventChip key={i} ev={ev} />
        ))}
      </div>
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────

interface Props {
  ticker?: string
  analysis?: Analysis | null
}

export function IntelPanel({ ticker, analysis }: Props) {
  const [tab, setTab] = useState<"SCORE" | "INTEL" | "ML" | "TARGETS">("SCORE")
  useEffect(() => { setTab("SCORE") }, [ticker])

  const { signal } = useMLSignal(ticker)
  const { spyContext, streakActive } = useSPYContext()
  const { data: sectorData } = useQuery<SectorSnapshot>({
    queryKey: ["sector-snapshot"],
    queryFn:  () => fetch("/api/research/sectors/snapshot").then(r => r.json()),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  })
  const { template } = useTemplateEligible(ticker ?? null)

  const jarvisGreen   = signal.jarvis_green ?? signal.omni_green
  const jarvisDist    = signal.jarvis_distance_pct ?? signal.omni_distance_pct
  const ic            = signal.wf_mean_ic
  const edgeLabel     = ic == null ? null : ic < 0.02 ? "Early stage" : ic < 0.04 ? "Developing" : ic < 0.06 ? "Moderate edge" : "Strong edge"
  const jarvisColor   = jarvisGreen == null ? C.dim : jarvisGreen ? C.green : C.red
  const jarvisLabel   = jarvisGreen == null ? "—" : jarvisGreen ? "Green" : "Red"
  const jarvisDistFmt = jarvisDist != null ? pctFmt(jarvisDist) : ""
  const rank          = signal.ml_rank_percentile != null ? Math.round(signal.ml_rank_percentile) : null
  const prob          = signal.ml_probability_positive != null ? Math.round(signal.ml_probability_positive * 100) : null
  const probColor     = prob == null ? C.dim : prob >= 55 ? C.green : prob <= 45 ? C.red : C.amber
  const sectorRegime  = sectorData?.available ? sectorData.regime : null
  const sectorLeader  = sectorData?.leaders?.[0]?.ticker ?? null
  const spyStreak     = spyContext?.streak
  const spyBest5d     = spyContext?.best_5d
  const narrative     = analysis?.atlasScore?.signalNarrative ?? null
  const mlDot         = template.eligible ? " ⚡" : ""

  return (
    <div className="w-full">
      <div className="flex" style={{ borderBottom: `1px solid ${C.border}` }}>
        {(["SCORE", "INTEL", "ML", "TARGETS"] as const).map(t => {
          const label = t === "ML" ? `ML${mlDot}` : t
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
        {/* ── SCORE ─────────────────────────────────────────────────────────── */}
        {tab === "SCORE" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {sectorRegime && (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
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

        {/* ── INTEL ─────────────────────────────────────────────────────────── */}
        {tab === "INTEL" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", backgroundColor: jarvisColor, flexShrink: 0, display: "inline-block" }} />
                <span style={{ fontSize: 10, color: C.dim }}>Jarvis</span>
              </div>
              <span style={{ fontSize: 11, color: jarvisColor, fontWeight: 600 }}>
                {jarvisLabel}{jarvisDistFmt ? ` ${jarvisDistFmt} above` : ""}
              </span>
            </div>
            {rank != null && (
              <Row label="ML Rank" value={
                <span style={{ color: rank >= 75 ? C.green : rank >= 50 ? C.amber : C.text }}>
                  {rank}th{edgeLabel ? ` · ${edgeLabel}` : ""}
                </span>
              } />
            )}
            {prob != null && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                  <span style={{ fontSize: 10, color: C.dim }}>P(+5d)</span>
                  <span style={{ fontSize: 10, color: probColor, fontWeight: 600 }}>{prob}%</span>
                </div>
                <MiniBar pct={prob} color={probColor} />
              </div>
            )}
            {streakActive && spyStreak && (
              <Row label="Streak" value={
                <span style={{ color: spyStreak.direction === "down" ? C.red : C.green }}>
                  {spyStreak.direction === "down" ? "↓" : "↑"}{spyStreak.days}d
                  {spyBest5d ? ` · ${Math.round(spyBest5d.hit_rate * 100)}% rev 5d` : ""}
                </span>
              } />
            )}
            {sectorRegime && (
              <Row label="Sector" value={
                <span style={{ textTransform: "capitalize" }}>
                  {sectorRegime}{sectorLeader ? ` · ${sectorLeader}` : ""}
                </span>
              } />
            )}
            {ic != null && edgeLabel && (
              <div style={{ paddingTop: 6, borderTop: `1px solid ${C.border}` }}>
                <span style={{ fontSize: 9, color: C.dim }}>
                  WF IC {ic.toFixed(3)} — {edgeLabel}
                </span>
              </div>
            )}
            <IPOAnalysis ticker={ticker} />
          </div>
        )}

        {/* ── ML ────────────────────────────────────────────────────────────── */}
        {tab === "ML" && ticker && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <TemplateSection ticker={ticker} />
            <ConfluenceSection ticker={ticker} />
            <div style={{ borderTop: `1px solid ${C.border}` }} />
            <MetaSection ticker={ticker} />
            <BehaviorSection ticker={ticker} />
            {/* Signal Explanation Engine — full evidence narrative */}
            <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
              <SignalExplanationPanel ticker={ticker} analysis={analysis as any} compact />
            </div>
          </div>
        )}

        {tab === "TARGETS" && <SignalTargets ticker={ticker} />}
      </div>
    </div>
  )
}

export default IntelPanel

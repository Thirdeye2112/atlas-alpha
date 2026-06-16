/**
 * SignalExplanationPanel.tsx
 * --------------------------
 * Signal Explanation Engine v1.
 *
 * Provides a complete evidence narrative for any ticker signal.
 * Reusable from Scanner, IntelPanel ML tab, and BotLab.
 *
 * Consumes:
 *   - useMLSignal        (ml_rank_percentile, jarvis, IC, direction)
 *   - useTemplateEligible (gate checks, rank/IC/confluence/meta)
 *   - useConfluence       (confluence_score, component_scores)
 *   - useMetaSignal       (combo_key, expected_return_avg, win_rate, top_20_pct)
 *   - useIntradayBehavior (behavior events, hit lift)
 *   - useIntradaySimilarity (historical analogue matches)
 *
 * No new calculations. Degrades gracefully. Mobile-friendly.
 */

import React, { useState } from "react"
import { useMLSignal } from "@/hooks/useMLSignal"
import {
  useConfluence,
  useMetaSignal,
  useIntradayBehavior,
  useIntradaySimilarity,
  useTemplateEligible,
  confluenceColor,
  sentimentColor,
  fmtLift,
  type BehaviorEvent,
  type SimilarMatch,
} from "@/hooks/useResearchAdvanced"

// ── Types ─────────────────────────────────────────────────────────────────────

interface VolatilityData {
  atrPercent?: number | null
}

export interface SignalExplanationProps {
  ticker: string
  /** Optional analysis object from /api/stock/:ticker/analysis */
  analysis?: { volatility?: VolatilityData } | null
  /** Compact height for embedding inside Scanner / BotLab sidebars */
  compact?: boolean
}

// ── Palette ───────────────────────────────────────────────────────────────────
const P = {
  bg0:    "#0a0f1a",
  bg1:    "#0f1623",
  bg2:    "#141c2d",
  bd:     "#1e2533",
  bdSub:  "rgba(148,163,184,0.10)",
  dim:    "#475569",
  muted:  "#6b7280",
  sub:    "#94a3b8",
  text:   "#d1d5db",
  hi:     "#e5e7eb",
  green:  "#22c55e",
  ga:     "#86efac",
  red:    "#ef4444",
  ra:     "#fca5a5",
  amber:  "#f59e0b",
  blue:   "#3b82f6",
  purple: "#a78bfa",
}

// ── Small atoms ───────────────────────────────────────────────────────────────

function Divider() {
  return <div style={{ borderTop: `1px solid ${P.bd}`, margin: "6px 0" }} />
}

function SectionHeader({ title, badge }: { title: string; badge?: React.ReactNode }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      marginBottom: 8,
    }}>
      <span style={{
        fontSize: 9, fontWeight: 800, letterSpacing: "0.10em",
        textTransform: "uppercase", color: P.dim,
      }}>
        {title}
      </span>
      {badge}
    </div>
  )
}

function Chip({
  label, color, bg, border,
}: {
  label: string; color: string; bg: string; border: string
}) {
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4,
      color, background: bg, border: `1px solid ${border}`,
      letterSpacing: "0.04em", whiteSpace: "nowrap",
    }}>
      {label}
    </span>
  )
}

function GreenChip({ label }: { label: string }) {
  return <Chip label={label} color={P.green} bg="rgba(34,197,94,0.10)" border="rgba(34,197,94,0.24)" />
}
function AmberChip({ label }: { label: string }) {
  return <Chip label={label} color={P.amber} bg="rgba(245,158,11,0.10)" border="rgba(245,158,11,0.24)" />
}
function DimChip({ label }: { label: string }) {
  return <Chip label={label} color={P.dim} bg="rgba(71,85,105,0.10)" border="rgba(71,85,105,0.20)" />
}

function ContribBar({ label, pct, color }: { label: string; pct: number; color: string }) {
  const clamped = Math.max(0, Math.min(100, pct))
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
      <span style={{ fontSize: 9, color: P.dim, width: 72, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: 5, borderRadius: 3, background: "rgba(255,255,255,0.05)", overflow: "hidden" }}>
        <div style={{
          height: "100%", width: `${clamped}%`, background: color,
          borderRadius: 3, transition: "width 0.5s ease",
        }} />
      </div>
      <span style={{ fontSize: 9, color, fontWeight: 700, width: 28, textAlign: "right", flexShrink: 0 }}>
        {clamped > 0 ? Math.round(clamped) : "—"}
      </span>
    </div>
  )
}

// ── Evidence item ─────────────────────────────────────────────────────────────

function EvidenceItem({
  icon, label, detail, color,
}: {
  icon: "✓" | "✗"; label: string; detail?: string; color: string
}) {
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "flex-start", marginBottom: 4 }}>
      <span style={{ fontSize: 11, color, fontWeight: 700, flexShrink: 0, marginTop: 1 }}>{icon}</span>
      <div>
        <span style={{ fontSize: 10, color: P.text }}>{label}</span>
        {detail && (
          <span style={{ fontSize: 9, color: P.muted, marginLeft: 6 }}>{detail}</span>
        )}
      </div>
    </div>
  )
}

// ── Section 1: Summary Verdict ────────────────────────────────────────────────

function SummarySection({ ticker, analysis }: { ticker: string; analysis?: SignalExplanationProps["analysis"] }) {
  const { signal } = useMLSignal(ticker)
  const { template } = useTemplateEligible(ticker)
  const { meta } = useMetaSignal(ticker)

  const rank = signal.ml_rank_percentile
  const quality =
    template.eligible && rank != null && rank >= 75 ? "STRONG"
    : rank != null && rank >= 50 ? "MODERATE"
    : "WEAK"

  const qualityColor = quality === "STRONG" ? P.green : quality === "MODERATE" ? P.amber : P.dim

  const expRet = meta.available && meta.expected_return_avg != null
    ? meta.expected_return_avg * 100 : null
  const winRate = meta.available && meta.win_rate != null
    ? meta.win_rate * 100 : null

  const atr = analysis?.volatility?.atrPercent ?? null
  const dir = signal.ml_direction

  return (
    <div>
      {/* Quality badge row */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8, marginBottom: 10,
        padding: "8px 10px", borderRadius: 6,
        background: `${qualityColor}08`,
        border: `1px solid ${qualityColor}20`,
      }}>
        <div style={{
          width: 8, height: 8, borderRadius: "50%", background: qualityColor, flexShrink: 0,
          boxShadow: `0 0 6px ${qualityColor}`,
        }} />
        <div style={{ flex: 1 }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: qualityColor, letterSpacing: "0.04em" }}>
            {quality}
          </span>
          <span style={{ fontSize: 10, color: P.dim, marginLeft: 8 }}>Signal Quality</span>
        </div>
        <span style={{ fontSize: 12, color: dir === "BULLISH" ? P.green : dir === "BEARISH" ? P.red : P.dim, fontWeight: 700 }}>
          {dir === "BULLISH" ? "↑ LONG" : dir === "BEARISH" ? "↓ SHORT" : "→ NEUTRAL"}
        </span>
      </div>

      {/* Key metrics grid */}
      <div style={{
        display: "grid", gridTemplateColumns: "1fr 1fr",
        gap: "6px 16px", fontFamily: "monospace",
      }}>
        {/* Template */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 9, color: P.dim }}>Template</span>
          {template.eligible
            ? <GreenChip label="⚡ ELIGIBLE" />
            : <DimChip label="NOT ELIGIBLE" />}
        </div>

        {/* Meta filter */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 9, color: P.dim }}>Meta Filter</span>
          {meta.available
            ? meta.top_20_pct
              ? <GreenChip label="✓ PASS" />
              : <DimChip label="— STANDARD" />
            : <DimChip label="—" />}
        </div>

        {/* Expected return */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 9, color: P.dim }}>Exp Return</span>
          <span style={{
            fontSize: 11, fontWeight: 700, fontFamily: "monospace",
            color: expRet == null ? P.dim : expRet >= 0 ? P.green : P.red,
          }}>
            {expRet != null ? `${expRet >= 0 ? "+" : ""}${expRet.toFixed(1)}%` : "—"}
          </span>
        </div>

        {/* Win rate */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 9, color: P.dim }}>Historical Win %</span>
          <span style={{
            fontSize: 11, fontWeight: 700, fontFamily: "monospace",
            color: winRate == null ? P.dim : winRate >= 55 ? P.green : P.sub,
          }}>
            {winRate != null ? `${winRate.toFixed(0)}%` : "—"}
          </span>
        </div>

        {/* ML rank */}
        {rank != null && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 9, color: P.dim }}>ML Rank</span>
            <span style={{
              fontSize: 11, fontWeight: 700, fontFamily: "monospace",
              color: rank >= 75 ? P.green : rank >= 50 ? P.amber : P.sub,
            }}>
              {Math.round(rank)}th %ile
            </span>
          </div>
        )}

        {/* ATR */}
        {atr != null && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 9, color: P.dim }}>ATR %</span>
            <span style={{ fontSize: 11, fontWeight: 700, fontFamily: "monospace", color: P.sub }}>
              {atr.toFixed(2)}%
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Section 2 & 3: Evidence For / Against ────────────────────────────────────

function EvidenceSection({ ticker }: { ticker: string }) {
  const { signal } = useMLSignal(ticker)
  const { template } = useTemplateEligible(ticker)
  const { confluence } = useConfluence(ticker)
  const { meta } = useMetaSignal(ticker)
  const { behavior } = useIntradayBehavior(ticker)
  const { similarity } = useIntradaySimilarity(ticker)

  const rank      = signal.ml_rank_percentile
  const cfScore   = confluence.available ? confluence.confluence_score : null
  const simHitRate = similarity.available && similarity.matches.length > 0
    ? similarity.matches.filter(m => (m.forward_return_5d ?? 0) > 0).length / similarity.matches.length
    : null

  // Build "for" list
  const forItems: { label: string; detail?: string }[] = []
  if (template.checks.rank_ok)
    forItems.push({ label: "ML Rank Top Quintile", detail: rank != null ? `${Math.round(rank)}th percentile` : undefined })
  if (template.checks.ic_ok && template.data.mean_ic != null)
    forItems.push({ label: "IC Quality Validated", detail: `IC ${template.data.mean_ic.toFixed(3)}` })
  if (template.checks.confluence_ok && cfScore != null)
    forItems.push({ label: `Confluence Score ${Math.round(cfScore)}`, detail: confluence.quality_tier ?? undefined })
  if (meta.available && meta.top_20_pct)
    forItems.push({ label: "Meta Combo Top 20%", detail: meta.combo_key ?? undefined })
  if (meta.available && meta.win_rate != null && meta.win_rate >= 0.55)
    forItems.push({ label: `Historical Win Rate ${(meta.win_rate * 100).toFixed(0)}%` })
  if (signal.jarvis_green === true)
    forItems.push({ label: "Jarvis Signal Green" })
  if (simHitRate != null && simHitRate >= 0.55)
    forItems.push({ label: `Similarity Engine ${(simHitRate * 100).toFixed(0)}% Hit Rate`, detail: `${similarity.matches.length} analogues` })
  if (behavior.available)
    behavior.events
      .filter(e => e.sentiment === "bullish")
      .slice(0, 2)
      .forEach(e => forItems.push({ label: `Behavior: ${e.label}`, detail: e.hit_lift != null ? fmtLift(e.hit_lift) : undefined }))

  // Build "against" list
  const againstItems: { label: string; detail?: string }[] = []
  if (!template.checks.rank_ok)
    againstItems.push({ label: "ML Rank Below Threshold", detail: rank != null ? `${Math.round(rank)}th %ile` : "no data" })
  if (!template.checks.ic_ok)
    againstItems.push({ label: "IC Quality Insufficient", detail: template.data.mean_ic != null ? `IC ${template.data.mean_ic.toFixed(3)}` : undefined })
  if (cfScore != null && cfScore < 50)
    againstItems.push({ label: `Weak Confluence Score`, detail: `${Math.round(cfScore)}` })
  if (meta.available && !meta.top_20_pct)
    againstItems.push({ label: "Meta Filter Not In Top 20%" })
  if (signal.jarvis_green === false)
    againstItems.push({ label: "Jarvis Signal Red" })
  if (simHitRate != null && simHitRate < 0.45)
    againstItems.push({ label: `Low Similarity Hit Rate`, detail: `${(simHitRate * 100).toFixed(0)}%` })
  if (signal.ml_expected_drawdown != null && signal.ml_expected_drawdown < -0.03)
    againstItems.push({ label: "Elevated Drawdown Risk", detail: `${(signal.ml_expected_drawdown * 100).toFixed(1)}%` })
  if (behavior.available)
    behavior.events
      .filter(e => e.sentiment === "bearish")
      .slice(0, 2)
      .forEach(e => againstItems.push({ label: `Behavior: ${e.label}`, detail: e.hit_lift != null ? fmtLift(e.hit_lift) : undefined }))

  const hasEvidence = forItems.length > 0 || againstItems.length > 0

  if (!hasEvidence) {
    return (
      <div style={{ fontSize: 10, color: P.dim, textAlign: "center", padding: "8px 0" }}>
        Run atlas-research pipeline to generate evidence.
      </div>
    )
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
      {/* Evidence For */}
      <div>
        <div style={{ fontSize: 9, color: P.green, fontWeight: 700, letterSpacing: "0.08em", marginBottom: 6 }}>FOR</div>
        {forItems.length > 0
          ? forItems.map((it, i) => (
            <EvidenceItem key={i} icon="✓" label={it.label} detail={it.detail} color={P.green} />
          ))
          : <span style={{ fontSize: 9, color: P.dim }}>No positive signals</span>
        }
      </div>

      {/* Evidence Against */}
      <div>
        <div style={{ fontSize: 9, color: P.red, fontWeight: 700, letterSpacing: "0.08em", marginBottom: 6 }}>AGAINST</div>
        {againstItems.length > 0
          ? againstItems.map((it, i) => (
            <EvidenceItem key={i} icon="✗" label={it.label} detail={it.detail} color={P.red} />
          ))
          : <span style={{ fontSize: 9, color: P.dim }}>No negative signals</span>
        }
      </div>
    </div>
  )
}

// ── Section 4: Historical Analogues ──────────────────────────────────────────

function AnaloguesSection({ ticker }: { ticker: string }) {
  const { similarity } = useIntradaySimilarity(ticker)

  if (!similarity.available || similarity.matches.length === 0) {
    return (
      <div style={{ fontSize: 10, color: P.dim, textAlign: "center", padding: "4px 0" }}>
        No historical analogues available
      </div>
    )
  }

  const matches = similarity.matches.slice(0, 5)
  const returns5d = matches.map(m => m.forward_return_5d).filter((v): v is number => v != null)
  const avgRet  = returns5d.length > 0 ? returns5d.reduce((a, b) => a + b, 0) / returns5d.length : null
  const bestRet = returns5d.length > 0 ? Math.max(...returns5d) : null
  const worstRet = returns5d.length > 0 ? Math.min(...returns5d) : null
  const hitRate = returns5d.length > 0 ? returns5d.filter(r => r > 0).length / returns5d.length : null

  const retFmt = (v: number) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`
  const retColor = (v: number) => v >= 0 ? P.green : P.red

  return (
    <div>
      {/* Summary stats */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8,
        padding: "7px 10px", borderRadius: 5,
        background: "rgba(59,130,246,0.05)", border: `1px solid rgba(59,130,246,0.14)`,
        marginBottom: 8,
      }}>
        {[
          { label: "Avg 5D", val: avgRet, fmt: retFmt },
          { label: "Best",   val: bestRet, fmt: retFmt },
          { label: "Worst",  val: worstRet, fmt: retFmt },
          { label: "Hit %",  val: hitRate, fmt: (v: number) => `${(v * 100).toFixed(0)}%` },
        ].map(({ label, val, fmt }) => (
          <div key={label} style={{ textAlign: "center" }}>
            <div style={{ fontSize: 9, color: P.dim }}>{label}</div>
            <div style={{
              fontSize: 11, fontWeight: 700, fontFamily: "monospace",
              color: val == null ? P.dim : label === "Hit %" ? (val >= 0.55 ? P.green : P.sub) : retColor(val as number),
            }}>
              {val != null ? fmt(val) : "—"}
            </div>
          </div>
        ))}
      </div>

      {/* Individual matches */}
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {matches.map((m, i) => {
          const ret = m.forward_return_5d
          return (
            <div key={i} style={{
              display: "grid", gridTemplateColumns: "70px 80px 50px 1fr",
              gap: 8, alignItems: "center",
              padding: "3px 4px", borderRadius: 3,
              background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.015)",
              fontFamily: "monospace", fontSize: 10,
            }}>
              <span style={{ color: P.sub, fontWeight: 600 }}>{m.match_ticker}</span>
              <span style={{ color: P.dim, fontSize: 9 }}>
                {m.match_date ? m.match_date.slice(0, 10) : "—"}
              </span>
              <span style={{ color: ret != null ? retColor(ret) : P.dim, fontWeight: 600 }}>
                {ret != null ? retFmt(ret) : "—"}
              </span>
              <span style={{ color: P.dim, fontSize: 9, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {m.behavior_label ?? ""}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Section 5: Behavior Context ───────────────────────────────────────────────

function BehaviorContextSection({ ticker }: { ticker: string }) {
  const { behavior } = useIntradayBehavior(ticker)

  if (!behavior.available || behavior.events.length === 0) {
    return <div style={{ fontSize: 10, color: P.dim, textAlign: "center", padding: "4px 0" }}>No intraday behaviors detected</div>
  }

  const sorted = [...behavior.events].sort((a, b) =>
    (Math.abs(b.hit_lift ?? 0)) - (Math.abs(a.hit_lift ?? 0))
  )

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {sorted.slice(0, 5).map((ev: BehaviorEvent, i) => {
        const color = sentimentColor(ev.sentiment)
        return (
          <div key={i} style={{
            display: "flex", justifyContent: "space-between", alignItems: "flex-start",
            padding: "5px 8px", borderRadius: 4,
            background: `${color}07`, border: `1px solid ${color}20`,
          }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 10, color, fontWeight: 600 }}>{ev.label}</div>
              {ev.description && (
                <div style={{ fontSize: 9, color: P.muted, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 200 }}>
                  {ev.description}
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: 10, flexShrink: 0, marginLeft: 8, alignItems: "center" }}>
              {ev.hit_lift != null && (
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 9, color: P.dim }}>lift</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color, fontFamily: "monospace" }}>
                    {fmtLift(ev.hit_lift)}
                  </div>
                </div>
              )}
              {ev.confidence != null && (
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 9, color: P.dim }}>conf</div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: P.sub, fontFamily: "monospace" }}>
                    {Math.round(ev.confidence * 100)}%
                  </div>
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Section 6: Trade Template ─────────────────────────────────────────────────

function TradeTemplateSection({ ticker, analysis }: { ticker: string; analysis?: SignalExplanationProps["analysis"] }) {
  const { signal } = useMLSignal(ticker)
  const { template } = useTemplateEligible(ticker)
  const { meta } = useMetaSignal(ticker)

  if (!template.eligible) {
    return (
      <div style={{ fontSize: 10, color: P.dim, textAlign: "center", padding: "8px 0" }}>
        Ticker did not pass all template gates — no trade template available.
        <div style={{ marginTop: 4, fontSize: 9 }}>
          Gates: RANK {template.checks.rank_ok ? "✓" : "✗"} · IC {template.checks.ic_ok ? "✓" : "✗"} · CF {template.checks.confluence_ok ? "✓" : "✗"} · META {template.checks.meta_top20 ? "✓" : "✗"}
        </div>
      </div>
    )
  }

  const dir     = signal.ml_direction
  const atr     = analysis?.volatility?.atrPercent ?? null
  const expRet  = meta.available && meta.expected_return_avg != null ? meta.expected_return_avg * 100 : null
  const winRate = meta.available && meta.win_rate != null ? meta.win_rate * 100 : null
  const stopPct = atr != null ? atr * 1.5 : null
  const tgtPct  = expRet != null ? Math.abs(expRet) : atr != null ? atr * 2.5 : null

  const isLong  = dir === "BULLISH"
  const entryLabel = isLong ? "Long Only" : dir === "BEARISH" ? "Short Only" : "Direction Pending"
  const entryColor = isLong ? P.green : dir === "BEARISH" ? P.red : P.dim

  return (
    <div style={{
      padding: "10px 12px", borderRadius: 6,
      background: `${entryColor}06`,
      border: `1px solid ${entryColor}18`,
    }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: entryColor }}>{entryLabel}</span>
        {meta.available && meta.combo_key && (
          <span style={{ fontSize: 9, color: P.dim, fontFamily: "monospace" }}>{meta.combo_key}</span>
        )}
      </div>

      {/* Entry / Stop / Target grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 10 }}>
        {[
          { label: "Entry", val: entryLabel, color: entryColor, sub: "Market open" },
          { label: "Stop", val: stopPct != null ? `${stopPct.toFixed(1)}%` : "1.5× ATR", color: P.red, sub: "Hard stop" },
          { label: "Target", val: tgtPct != null ? `+${tgtPct.toFixed(1)}%` : "2.5× ATR", color: P.green, sub: "T1" },
        ].map(({ label, val, color, sub }) => (
          <div key={label} style={{
            padding: "6px 8px", borderRadius: 5,
            background: "rgba(255,255,255,0.025)", textAlign: "center",
          }}>
            <div style={{ fontSize: 9, color: P.dim, marginBottom: 3 }}>{label}</div>
            <div style={{ fontSize: 11, fontWeight: 700, color, fontFamily: "monospace" }}>{val}</div>
            <div style={{ fontSize: 8, color: P.dim, marginTop: 2 }}>{sub}</div>
          </div>
        ))}
      </div>

      {/* Management rule */}
      <div style={{ fontSize: 9, color: P.dim, padding: "5px 8px", borderRadius: 3, background: "rgba(255,255,255,0.02)", borderLeft: `2px solid ${entryColor}30` }}>
        Management: Move stop to break-even after hitting T1.
      </div>

      {/* Win rate */}
      {winRate != null && (
        <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 9, color: P.dim }}>Historical Win Rate</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: winRate >= 55 ? P.green : P.sub, fontFamily: "monospace" }}>
            {winRate.toFixed(0)}%
          </span>
        </div>
      )}
    </div>
  )
}

// ── Section 7: Confidence Breakdown ──────────────────────────────────────────

function ConfidenceSection({ ticker }: { ticker: string }) {
  const { signal } = useMLSignal(ticker)
  const { template } = useTemplateEligible(ticker)
  const { confluence } = useConfluence(ticker)
  const { meta } = useMetaSignal(ticker)
  const { behavior } = useIntradayBehavior(ticker)
  const { similarity } = useIntradaySimilarity(ticker)

  const mlScore = template.data.rank_percentile ?? (signal.ml_rank_percentile ?? 0)
  const cfScore = confluence.available ? (confluence.confluence_score ?? 0) : 0
  const metaScore = meta.available
    ? meta.top_20_pct ? 85
      : meta.win_rate != null ? meta.win_rate * 100
      : 0
    : 0
  const behaviorScore = behavior.available && behavior.events.length > 0
    ? Math.min(100, behavior.events.reduce((s, e) => s + (e.confidence ?? 0.5), 0) / behavior.events.length * 100)
    : 0
  const simScore = similarity.available && similarity.matches.length > 0
    ? (similarity.matches.filter(m => (m.forward_return_5d ?? 0) > 0).length / similarity.matches.length) * 100
    : 0

  const bars = [
    { label: "ML Rank",    pct: mlScore,      color: mlScore >= 75 ? P.green : mlScore >= 50 ? P.amber : P.dim },
    { label: "Confluence", pct: cfScore,       color: confluenceColor(cfScore) },
    { label: "Meta",       pct: metaScore,     color: metaScore >= 70 ? P.green : metaScore >= 50 ? P.amber : P.dim },
    { label: "Behavior",   pct: behaviorScore, color: P.purple },
    { label: "Similarity", pct: simScore,      color: simScore >= 55 ? P.green : simScore >= 40 ? P.amber : P.dim },
  ]

  const overall = bars.reduce((s, b) => s + b.pct, 0) / bars.length
  const overallColor = overall >= 65 ? P.green : overall >= 45 ? P.amber : P.red

  return (
    <div>
      {bars.map(b => <ContribBar key={b.label} label={b.label} pct={b.pct} color={b.color} />)}
      <Divider />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
        <span style={{ fontSize: 9, color: P.dim }}>Composite Confidence</span>
        <span style={{ fontSize: 12, fontWeight: 800, color: overallColor, fontFamily: "monospace" }}>
          {Math.round(overall)}
        </span>
      </div>
    </div>
  )
}

// ── Collapsible section wrapper ───────────────────────────────────────────────

function Section({
  id, title, badge, defaultOpen = true, children,
}: {
  id: string; title: string; badge?: React.ReactNode; defaultOpen?: boolean; children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{ borderBottom: `1px solid ${P.bd}` }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "9px 14px", background: "transparent", border: "none",
          cursor: "pointer", textAlign: "left",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: P.sub, letterSpacing: "0.05em" }}>{title}</span>
          {badge}
        </div>
        <span style={{ fontSize: 10, color: P.dim, flexShrink: 0 }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div style={{ padding: "4px 14px 12px" }}>
          {children}
        </div>
      )}
    </div>
  )
}

// ── Root panel ────────────────────────────────────────────────────────────────

export function SignalExplanationPanel({ ticker, analysis, compact = false }: SignalExplanationProps) {
  const { signal, isLoading } = useMLSignal(ticker)
  const { template } = useTemplateEligible(ticker)

  if (isLoading) {
    return (
      <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 8 }}>
        {[80, 60, 90, 50, 70].map((w, i) => (
          <div key={i} style={{ height: 11, borderRadius: 4, background: "rgba(255,255,255,0.04)", width: `${w}%` }} />
        ))}
      </div>
    )
  }

  return (
    <div style={{
      fontFamily: "'Inter', system-ui, monospace",
      background: P.bg1,
      border: `1px solid ${P.bd}`,
      borderRadius: compact ? 0 : 8,
      overflow: "hidden",
      fontSize: 11,
      color: P.text,
      ...(compact ? { maxHeight: 420, overflowY: "auto" } : {}),
    }}>
      {/* Panel header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 14px",
        background: P.bg0,
        borderBottom: `1px solid ${P.bd}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: P.hi, letterSpacing: "0.03em" }}>
            {ticker}
          </span>
          <span style={{ fontSize: 10, color: P.dim }}>Signal Explanation</span>
        </div>
        <div style={{ display: "flex", gap: 5 }}>
          {template.eligible && <GreenChip label="⚡ ELIGIBLE" />}
          {!signal.available && <AmberChip label="ML OFFLINE" />}
        </div>
      </div>

      {/* Sections */}
      <Section id="summary" title="1. Summary Verdict" defaultOpen>
        <SummarySection ticker={ticker} analysis={analysis} />
      </Section>

      <Section id="evidence" title="2–3. Evidence For / Against" defaultOpen>
        <EvidenceSection ticker={ticker} />
      </Section>

      <Section id="analogues" title="4. Historical Analogues" defaultOpen={false}>
        <AnaloguesSection ticker={ticker} />
      </Section>

      <Section id="behavior" title="5. Behavior Context" defaultOpen={false}>
        <BehaviorContextSection ticker={ticker} />
      </Section>

      <Section id="template" title="6. Trade Template" defaultOpen>
        <TradeTemplateSection ticker={ticker} analysis={analysis} />
      </Section>

      <Section id="confidence" title="7. Confidence Breakdown" defaultOpen>
        <ConfidenceSection ticker={ticker} />
      </Section>

      {/* Footer */}
      <div style={{ padding: "6px 14px", fontSize: 9, color: P.dim, background: P.bg0, borderTop: `1px solid ${P.bd}` }}>
        Read-only — consumes existing atlas-research pipeline outputs. No new calculations.
      </div>
    </div>
  )
}

export default SignalExplanationPanel

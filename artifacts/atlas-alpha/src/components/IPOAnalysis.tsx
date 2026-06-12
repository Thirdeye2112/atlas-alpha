/**
 * IPOAnalysis
 * -----------
 * Compact IPO insight block for the INTEL tab.
 * Renders null for any ticker not in ipo_registry.
 *
 * Shows:
 *   - Days since IPO badge
 *   - Day1 category (HOT / WARM / COLD / BROKEN)
 *   - Current return at nearest precomputed horizon
 *   - "You are HERE" curve position text
 *   - Lockup countdown if within lockup window
 *   - Year1 outcome for historical completions
 */

import React from 'react'
import { useQuery } from '@tanstack/react-query'

// ── Benchmark averages from our 8-IPO analysis (Table 1) ──────────────────────
const AVG_AT_HORIZON: Record<number, number> = {
  1: 0.6, 5: 2.1, 10: -0.6, 20: 4.5, 30: 4.8,
  60: 17.8, 90: 27.3, 120: 31.8, 150: 33.7, 180: 41.6, 252: 44.2,
}
const HORIZONS = [1, 5, 10, 20, 30, 60, 90, 120, 150, 180, 252]

// ── Types ─────────────────────────────────────────────────────────────────────

interface IpoData {
  available: boolean
  ticker: string
  company_name: string
  ipo_date: string
  day1_category: 'hot' | 'warm' | 'cold' | 'broken' | null
  sector: string | null
  lockup_days: number
  day1_pop_pct: number | null
  returns: {
    d1: number | null; d5: number | null; d10: number | null; d20: number | null
    d30: number | null; d60: number | null; d90: number | null; d120: number | null
    d150: number | null; d180: number | null; d252: number | null
  }
  vs_spy_252d: number | null
  max_dd: { d30: number | null; d90: number | null; d252: number | null }
  peak: { day: number | null; return_pct: number | null; drop_to_year_end: number | null }
  spy_regime_at_ipo: string | null
  year1_category: string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function calDaysToTradingDays(calDays: number): number {
  return Math.round(calDays * 252 / 365)
}

function nearestHorizon(tradingDays: number): number {
  return HORIZONS.reduce((best, h) =>
    Math.abs(h - tradingDays) < Math.abs(best - tradingDays) ? h : best
  )
}

function getReturnAtHorizon(returns: IpoData['returns'], h: number): number | null {
  const MAP: Record<number, keyof IpoData['returns']> = {
    1: 'd1', 5: 'd5', 10: 'd10', 20: 'd20', 30: 'd30',
    60: 'd60', 90: 'd90', 120: 'd120', 150: 'd150', 180: 'd180', 252: 'd252',
  }
  return returns[MAP[h] ?? 'd252'] ?? null
}

function pctFmt(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`
}

function curvePosition(tradingDays: number, lockupDays: number): string {
  if (tradingDays <= 10)  return 'Early stage — IPO dust settling.'
  if (tradingDays <= 30)  return 'Watch for day-30 entry window (+12.3% avg fwd).'
  if (tradingDays <= 90)  return 'Prime window. Avg IPO +27.3% by day 90.'
  if (tradingDays <= 148) return 'Approaching typical peak (avg day 148).'
  if (tradingDays <= lockupDays + 30) return 'Near lockup expiry — watch for volume spike.'
  if (tradingDays <= 252) return 'Post-lockup — avg drop −3.3% before stabilising.'
  return 'Year 1 complete.'
}

const CAT_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  hot:    { bg: 'rgba(239,68,68,0.12)',   text: '#ef4444', border: 'rgba(239,68,68,0.3)'   },
  warm:   { bg: 'rgba(245,158,11,0.12)',  text: '#f59e0b', border: 'rgba(245,158,11,0.3)'  },
  cold:   { bg: 'rgba(148,163,184,0.10)', text: '#94a3b8', border: 'rgba(148,163,184,0.25)' },
  broken: { bg: 'rgba(239,68,68,0.08)',   text: '#f87171', border: 'rgba(239,68,68,0.2)'   },
}

const YEAR1_COLORS: Record<string, string> = {
  winner:   '#22c55e',
  moderate: '#f59e0b',
  loser:    '#ef4444',
  disaster: '#dc2626',
}

const C = {
  dim:  '#475569',
  text: '#94a3b8',
  sep:  'rgba(148,163,184,0.12)',
}

// ── Fetch ─────────────────────────────────────────────────────────────────────

async function fetchIpoData(ticker: string): Promise<IpoData | null> {
  const res = await fetch(`/api/research/ipo/ticker/${encodeURIComponent(ticker)}`)
  if (res.status === 404) return null
  if (!res.ok) return null
  const data = await res.json()
  return data.available ? data : null
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  ticker: string | null | undefined
}

export default function IPOAnalysis({ ticker }: Props) {
  const { data, isLoading } = useQuery<IpoData | null>({
    queryKey: ['ipo-ticker', ticker],
    queryFn: () => fetchIpoData(ticker!),
    enabled: !!ticker,
    staleTime: 60 * 60 * 1000,
    retry: 0,
  })

  if (!ticker || isLoading || !data) return null

  const ipoDate    = new Date(data.ipo_date)
  const today      = new Date()
  const calDays    = Math.floor((today.getTime() - ipoDate.getTime()) / 86_400_000)
  const tradingDays = calDaysToTradingDays(calDays)
  const isHistorical = tradingDays > 252

  const nearH      = nearestHorizon(Math.min(tradingDays, 252))
  const actualRet  = getReturnAtHorizon(data.returns, nearH)
  const benchRet   = AVG_AT_HORIZON[nearH]

  const catStyle   = data.day1_category ? CAT_COLORS[data.day1_category] : null

  // Lockup countdown
  const daysToLockup = data.lockup_days - tradingDays
  const inLockupZone = daysToLockup > -30 && daysToLockup < 30
  const lockupPassed = daysToLockup <= -30

  // Year display
  const yearsAgo   = (calDays / 365).toFixed(1)

  return (
    <div style={{ paddingTop: 6, borderTop: `1px solid ${C.sep}`, display: 'flex', flexDirection: 'column', gap: 5 }}>

      {/* Header row: company + age */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 9, color: C.dim, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          IPO Analysis
        </span>
        <span style={{ fontSize: 9, color: C.text, fontWeight: 500 }}>
          {isHistorical
            ? `${yearsAgo}y ago`
            : `Day ${tradingDays}`
          }
        </span>
      </div>

      {/* Company name */}
      <div style={{ fontSize: 10, color: C.text, fontWeight: 500 }}>
        {data.company_name || data.ticker}
        {data.sector && (
          <span style={{ color: C.dim, fontWeight: 400, marginLeft: 4 }}>· {data.sector}</span>
        )}
      </div>

      {/* Day1 category badge + regime */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
        {catStyle && data.day1_category && (
          <span style={{
            fontSize: 9, fontWeight: 700, letterSpacing: '0.06em',
            padding: '1px 5px', borderRadius: 3, border: `1px solid ${catStyle.border}`,
            backgroundColor: catStyle.bg, color: catStyle.text, textTransform: 'uppercase',
          }}>
            {data.day1_category}
          </span>
        )}
        {data.day1_pop_pct != null && (
          <span style={{ fontSize: 9, color: data.day1_pop_pct >= 0 ? '#22c55e' : '#ef4444' }}>
            day1 {pctFmt(data.day1_pop_pct)}
          </span>
        )}
        {data.spy_regime_at_ipo && (
          <span style={{ fontSize: 9, color: C.dim }}>
            {data.spy_regime_at_ipo} mkt
          </span>
        )}
      </div>

      {/* Current return vs benchmark */}
      {actualRet != null && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: C.dim }}>
            Return d{nearH}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: actualRet >= 0 ? '#22c55e' : '#ef4444' }}>
              {pctFmt(actualRet)}
            </span>
            {benchRet != null && (
              <span style={{ fontSize: 9, color: C.dim }}>
                avg {pctFmt(benchRet)}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Peak info */}
      {data.peak.return_pct != null && data.peak.day != null && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: C.dim }}>Peak</span>
          <span style={{ fontSize: 10, color: C.text }}>
            {pctFmt(data.peak.return_pct)} @ day {data.peak.day}
            {data.peak.drop_to_year_end != null && (
              <span style={{ color: '#ef4444', marginLeft: 4 }}>
                ({pctFmt(data.peak.drop_to_year_end)} to yr-end)
              </span>
            )}
          </span>
        </div>
      )}

      {/* You are HERE */}
      {!isHistorical && (
        <div style={{
          fontSize: 9, color: '#f59e0b', lineHeight: 1.4,
          padding: '3px 5px', borderRadius: 3,
          backgroundColor: 'rgba(245,158,11,0.06)',
          border: '1px solid rgba(245,158,11,0.15)',
        }}>
          📍 {curvePosition(tradingDays, data.lockup_days)}
        </div>
      )}

      {/* Lockup status */}
      {!isHistorical && !lockupPassed && (
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          fontSize: 9, color: inLockupZone ? '#ef4444' : C.dim,
        }}>
          <span>🔒 Lockup {inLockupZone ? 'expiry NOW' : `~${Math.abs(daysToLockup)}d`}</span>
          {inLockupZone && (
            <span style={{ color: '#ef4444', fontWeight: 600 }}>avg −3.3% post-lockup</span>
          )}
        </div>
      )}

      {/* Year1 outcome (historical) */}
      {isHistorical && data.year1_category && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: C.dim }}>Year 1 outcome</span>
          <span style={{
            fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
            color: YEAR1_COLORS[data.year1_category] ?? C.text,
          }}>
            {data.year1_category}
          </span>
        </div>
      )}

      {/* vs SPY */}
      {data.vs_spy_252d != null && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: C.dim }}>vs SPY yr1</span>
          <span style={{ fontSize: 10, color: data.vs_spy_252d >= 0 ? '#22c55e' : '#ef4444' }}>
            {pctFmt(data.vs_spy_252d)}
          </span>
        </div>
      )}
    </div>
  )
}

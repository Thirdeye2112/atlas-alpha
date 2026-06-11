/**
 * SectorRotationBadge
 * Compact sector rotation indicator showing today's top/bottom sectors
 * and current market regime. Sits below ConditionalNarrative in Dashboard.
 */

import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { cn } from '@/lib/utils'

interface SectorEntry {
  ticker: string
  name: string
  rank: number
  rs_20d: number | null
  is_leading: boolean
  is_lagging: boolean
}

interface SectorSnapshot {
  available: boolean
  as_of: string
  regime: 'growth' | 'defensive' | 'inflation' | 'financial' | 'neutral'
  rotation_signal: string
  xlv_vs_xlk: number | null
  leaders: SectorEntry[]
  laggards: SectorEntry[]
  all_sectors: SectorEntry[]
}

async function fetchSectorSnapshot(): Promise<SectorSnapshot> {
  const res = await fetch('/api/research/sectors/snapshot')
  if (!res.ok) throw new Error('sector snapshot failed')
  return res.json()
}

const REGIME_COLORS: Record<string, string> = {
  growth:    'text-blue-400',
  defensive: 'text-emerald-400',
  inflation: 'text-amber-400',
  financial: 'text-violet-400',
  neutral:   'text-muted-foreground',
}

const RS_BAR_WIDTH = (rs: number | null): string => {
  if (rs == null) return '0%'
  const pct = Math.min(Math.abs(rs) * 500, 100)   // ±20% RS maps to full bar
  return `${pct.toFixed(1)}%`
}

interface Props {
  className?: string
}

export default function SectorRotationBadge({ className }: Props) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['sector-snapshot'],
    queryFn: fetchSectorSnapshot,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  })

  if (isLoading) {
    return (
      <div className={cn('text-[10px] text-muted-foreground animate-pulse px-1', className)}>
        Loading sector data…
      </div>
    )
  }
  if (isError || !data?.available) return null

  const { regime, leaders, laggards, xlv_vs_xlk } = data

  // XLV vs XLK as defensive vs growth meter
  const xlvLabel = xlv_vs_xlk != null
    ? xlv_vs_xlk > 0
      ? `DEF +${(xlv_vs_xlk * 100).toFixed(1)}% vs TECH`
      : `TECH +${(Math.abs(xlv_vs_xlk) * 100).toFixed(1)}% vs DEF`
    : null

  return (
    <div className={cn('w-full text-[10px] font-mono space-y-1 px-1 select-none', className)}>
      {/* Regime header */}
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground uppercase tracking-widest text-[9px]">SECTOR</span>
        <span className={cn('uppercase tracking-wider font-bold', REGIME_COLORS[regime])}>
          {regime}
          {xlvLabel && <span className="ml-1 font-normal opacity-70">· {xlvLabel}</span>}
        </span>
      </div>

      {/* Leaders row */}
      <div className="flex items-center gap-1.5">
        <span className="text-emerald-500 w-3">▲</span>
        <div className="flex gap-1.5 flex-1 flex-wrap">
          {leaders.map(s => (
            <div key={s.ticker} className="flex items-center gap-1">
              <span className="text-emerald-400 font-semibold">{s.ticker}</span>
              {s.rs_20d != null && (
                <div className="flex items-center gap-0.5">
                  <div
                    className="h-1 rounded-full bg-emerald-500/70"
                    style={{ width: RS_BAR_WIDTH(s.rs_20d) }}
                  />
                  <span className="text-emerald-500/80 text-[9px]">
                    +{(s.rs_20d * 100).toFixed(1)}%
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Laggards row */}
      <div className="flex items-center gap-1.5">
        <span className="text-rose-500 w-3">▼</span>
        <div className="flex gap-1.5 flex-1 flex-wrap">
          {laggards.map(s => (
            <div key={s.ticker} className="flex items-center gap-1">
              <span className="text-rose-400 font-semibold">{s.ticker}</span>
              {s.rs_20d != null && (
                <div className="flex items-center gap-0.5">
                  <div
                    className="h-1 rounded-full bg-rose-500/70"
                    style={{ width: RS_BAR_WIDTH(s.rs_20d) }}
                  />
                  <span className="text-rose-500/80 text-[9px]">
                    {(s.rs_20d * 100).toFixed(1)}%
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

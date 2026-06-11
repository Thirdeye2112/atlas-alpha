import React, { useMemo } from "react"
import { useMLSignalHistory } from "@/hooks/useMLSignal"

interface SparkPoint { date: string; rank_percentile: number|null; probability: number|null }

const C = { BULL:"#22c55e",BEAR:"#ef4444",NEUT:"#475569",dim:"#64748b",text:"#94a3b8" }

function Sparkline({ points, width=120, height=32 }: { points: SparkPoint[]; width?: number; height?: number }) {
  const path = useMemo(() => {
    const vals = points.map(p=>p.rank_percentile??0)
    if (!vals.length) return ""
    const min = Math.min(...vals), max = Math.max(...vals)
    const range = max-min||1
    const pts = vals.map((v,i)=>{
      const x = (i/(vals.length-1||1))*(width-8)+4
      const y = height-4-((v-min)/range)*(height-8)
      return `${i===0?"M":"L"}${x.toFixed(1)},${y.toFixed(1)}`
    })
    return pts.join(" ")
  }, [points, width, height])

  const last = points[points.length-1]?.rank_percentile??0
  const color = last>=60?C.BULL:last<=40?C.BEAR:C.NEUT

  return (
    <svg width={width} height={height} style={{overflow:"visible"}}>
      <path d={path} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"/>
      {points.length>0&&(()=>{
        const lx=(width-8)+4, ly=height-4-((last-(Math.min(...points.map(p=>p.rank_percentile??0))))/((Math.max(...points.map(p=>p.rank_percentile??0))-Math.min(...points.map(p=>p.rank_percentile??0)))||1))*(height-8)
        return <circle cx={lx} cy={ly} r={3} fill={color} stroke="rgba(15,23,42,0.9)" strokeWidth={1.5}/>
      })()}
    </svg>
  )
}

export interface MLSignalSparklineProps {
  ticker: string|null|undefined
  width?: number
  height?: number
  showLabel?: boolean
}

export function MLSignalSparkline({ ticker, width=120, height=32, showLabel=true }: MLSignalSparklineProps) {
  const { history, count, isLoading } = useMLSignalHistory(ticker)
  if (!ticker) return null
  if (isLoading) return <div style={{width,height,backgroundColor:"rgba(148,163,184,0.08)",borderRadius:3,animation:"pulse 1.5s ease-in-out infinite"}}/>

  const points: SparkPoint[] = history.slice(-30)
  const last = points[points.length-1]
  const first = points[0]
  const trend = last&&first&&last.rank_percentile!=null&&first.rank_percentile!=null
    ? last.rank_percentile-first.rank_percentile : 0
  const trendLabel = Math.abs(trend)<3?"Stable":trend>0?"Improving":"Declining"
  const trendColor = trend>3?C.BULL:trend<-3?C.BEAR:C.NEUT

  return (
    <div style={{display:"flex",flexDirection:"column",gap:3}}>
      {showLabel&&<div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span style={{fontSize:9,color:C.dim}}>ML Rank (30d)</span>
        <span style={{fontSize:9,color:trendColor,fontWeight:600}}>{trendLabel}</span>
      </div>}
      <Sparkline points={points} width={width} height={height}/>
      {showLabel&&last&&<div style={{display:"flex",justifyContent:"space-between"}}>
        <span style={{fontSize:9,color:C.dim}}>Today</span>
        <span style={{fontSize:9,color:C.text,fontWeight:600}}>{last.rank_percentile!=null?`${Math.round(last.rank_percentile)}th pct`:"—"}</span>
      </div>}
    </div>
  )
}

export default MLSignalSparkline
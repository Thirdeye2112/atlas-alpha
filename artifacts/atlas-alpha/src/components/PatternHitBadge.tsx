import React from "react"
import { useQuery } from "@tanstack/react-query"

const C = { BULL:"#22c55e",BEAR:"#ef4444",NEUT:"#64748b",dim:"#475569",text:"#94a3b8",border:"rgba(148,163,184,0.12)" }

interface PatternStat { pattern_name:string;direction:string;total_signals:number;with_outcomes:number;mean_return_5d_pct:number|null;hit_rate_5d_pct:number|null }

export function usePatternStats() {
  const { data, isLoading } = useQuery({ queryKey:["pattern-stats"], queryFn:async()=>{ const r=await fetch("/api/research/patterns/stats"); return r.ok?r.json():{patterns:[]} }, staleTime:60*60*1000, retry:1 })
  const map = new Map((data?.patterns??[]).map((p:PatternStat)=>[`${p.pattern_name}:${p.direction}`,p]))
  return { isLoading, getStats:(name:string,dir?:string):PatternStat|null=>{ if(dir&&map.has(`${name}:${dir}`)) return map.get(`${name}:${dir}`)!; for(const[k,v]of map){ if(k.startsWith(`${name}:`)) return v } return null } }
}

export function PatternHitBadge({ patternName, direction, getStats, size="sm" }: { patternName:string;direction?:string;getStats:(n:string,d?:string)=>PatternStat|null;size?:"sm"|"md" }) {
  const stats = getStats(patternName, direction)
  if (!stats||stats.with_outcomes<10) return <span style={{fontSize:9,color:C.dim,opacity:0.5}}>no history</span>
  const { hit_rate_5d_pct:hr, mean_return_5d_pct:ret, with_outcomes:n } = stats
  const hc = hr==null?C.NEUT:hr>=60?C.BULL:hr<=40?C.BEAR:C.NEUT
  const rc = ret==null?C.NEUT:ret>0.5?C.BULL:ret<-0.5?C.BEAR:C.NEUT
  if (size==="sm") return <span style={{display:"inline-flex",alignItems:"center",gap:4,padding:"1px 6px",borderRadius:3,border:`1px solid ${hc}30`,backgroundColor:`${hc}10`,fontSize:9,color:hc,fontWeight:600,whiteSpace:"nowrap"}}>{hr!=null?`${hr}% hit`:"—"}{ret!=null&&<span style={{color:rc}}>{ret>=0?"+":""}{ret.toFixed(1)}%</span>}<span style={{color:C.dim,fontWeight:400}}>n={n}</span></span>
  return <div style={{padding:"6px 8px",borderRadius:4,border:`1px solid ${C.border}`,backgroundColor:"rgba(15,23,42,0.6)",display:"flex",flexDirection:"column",gap:3,minWidth:120}}><div style={{display:"flex",justifyContent:"space-between"}}><span style={{fontSize:9,color:C.dim}}>Hit rate (5d)</span><span style={{fontSize:10,color:hc,fontWeight:700}}>{hr!=null?`${hr}%`:"—"}</span></div><div style={{display:"flex",justifyContent:"space-between"}}><span style={{fontSize:9,color:C.dim}}>Median return</span><span style={{fontSize:10,color:rc,fontWeight:600}}>{ret!=null?`${ret>=0?"+":""}${ret.toFixed(1)}%`:"—"}</span></div><div style={{display:"flex",justifyContent:"space-between"}}><span style={{fontSize:9,color:C.dim}}>Sample</span><span style={{fontSize:9,color:C.text}}>n={n}</span></div></div>
}

export default PatternHitBadge
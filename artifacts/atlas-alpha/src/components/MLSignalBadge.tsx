import React from "react"
import { useMLSignal, MLSignalStrength, MLDirection } from "@/hooks/useMLSignal"

const C = { STRONG:"#22c55e",MODERATE:"#f59e0b",WEAK:"#64748b",NEUTRAL:"#475569",BULLISH:"#22c55e",BEARISH:"#ef4444",bg:"rgba(15,23,42,0.85)",border:"rgba(148,163,184,0.12)",text:"#94a3b8",dim:"#475569" }

function Pill({ s }: { s: MLSignalStrength }) {
  const color = C[s] ?? C.NEUTRAL
  const labels: Record<MLSignalStrength, string> = { STRONG:"Strong",MODERATE:"Moderate",WEAK:"Weak",NEUTRAL:"Neutral" }
  return <span style={{display:"inline-flex",alignItems:"center",gap:4,padding:"2px 8px",borderRadius:4,border:`1px solid ${color}40`,backgroundColor:`${color}14`,fontSize:11,fontWeight:600,color}}><span style={{width:6,height:6,borderRadius:"50%",backgroundColor:color,flexShrink:0}}/>{labels[s]}</span>
}

function Arrow({ d }: { d: MLDirection }) {
  const map: Record<MLDirection,{a:string;c:string;l:string}> = { BULLISH:{a:"↑",c:C.BULLISH,l:"Bullish"},BEARISH:{a:"↓",c:C.BEARISH,l:"Bearish"},NEUTRAL:{a:"→",c:C.NEUTRAL,l:"Neutral"} }
  const cfg = map[d]
  if (!cfg) return <span style={{color:C.NEUTRAL,fontSize:12,fontWeight:600}}>→ Neutral</span>
  return <span style={{color:cfg.c,fontSize:12,fontWeight:600}}>{cfg.a} {cfg.l}</span>
}

function PBar({ p }: { p: number | null | undefined }) {
  if (p == null) return null
  const pct = Math.round(p*100)
  const color = pct>=55?C.BULLISH:pct<=45?C.BEARISH:C.NEUTRAL
  return <div><div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}><span style={{fontSize:10,color:C.text}}>P(+5d)</span><span style={{fontSize:10,color,fontWeight:600}}>{pct}%</span></div><div style={{height:3,borderRadius:2,backgroundColor:"rgba(148,163,184,0.15)",overflow:"hidden"}}><div style={{height:"100%",width:`${pct}%`,borderRadius:2,backgroundColor:color,transition:"width 0.4s ease"}}/></div></div>
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><span style={{fontSize:10,color:C.dim}}>{label}</span><span style={{fontSize:11,color:C.text,fontWeight:500}}>{value}</span></div>
}

export function MLSignalBadge({ ticker, className = "" }: { ticker?: string; className?: string }) {
  const { signal, isLoading, available } = useMLSignal(ticker)
  if (!ticker) return null
  if (isLoading) return <div style={{padding:"10px 12px",borderRadius:6,border:`1px solid ${C.border}`,backgroundColor:C.bg,opacity:0.5}}><div style={{fontSize:9,color:C.dim,letterSpacing:"0.08em",fontWeight:600}}>ML SIGNAL</div><div style={{fontSize:10,color:C.dim,marginTop:4}}>Loading...</div></div>
  if (!available) return null
  const rank = signal.ml_rank_percentile!=null?`${Math.round(signal.ml_rank_percentile)}th pct`:"—"
  const ret = signal.ml_expected_return_5d!=null?`${((Math.exp(signal.ml_expected_return_5d)-1)*100)>=0?"+":""}${((Math.exp(signal.ml_expected_return_5d)-1)*100).toFixed(1)}%`:"—"
  const conf = signal.ml_confidence!=null?`${Math.round(signal.ml_confidence*100)}%`:"—"
  const ic = signal.wf_mean_ic
  const edgeLabel = ic==null?null:ic<0.02?"Early stage":ic<0.04?"Developing":ic<0.06?"Moderate edge":"Strong edge"
  const omniColor = signal.omni_green==null?C.dim:signal.omni_green?C.BULLISH:C.BEARISH
  const omniLabel = signal.omni_green==null?"—":signal.omni_green?"Green":"Red"
  const omniDist = signal.omni_distance_pct!=null?`${signal.omni_distance_pct>=0?"+":""}${signal.omni_distance_pct.toFixed(1)}%`:"—"
  return (
    <div className={className} style={{padding:"10px 12px",borderRadius:6,border:`1px solid ${C.border}`,backgroundColor:C.bg,display:"flex",flexDirection:"column",gap:8}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><span style={{fontSize:9,color:C.dim,letterSpacing:"0.08em",fontWeight:600,textTransform:"uppercase"}}>ML Signal</span><span style={{fontSize:9,color:C.dim}}>{signal.date}</span></div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><Pill s={signal.ml_signal_strength}/><Arrow d={signal.ml_direction}/></div>
      <PBar p={signal.ml_probability_positive}/>
      <div style={{display:"flex",flexDirection:"column",gap:4}}><Row label="Rank" value={rank}/><Row label="Exp 5d" value={ret}/><Row label="Confidence" value={conf}/></div>
      {signal.omni_green!=null&&<div style={{paddingTop:6,borderTop:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}><div style={{display:"flex",alignItems:"center",gap:5}}><span style={{width:7,height:7,borderRadius:"50%",backgroundColor:omniColor,flexShrink:0}}/><span style={{fontSize:9,color:C.dim}}>OMNI (82)</span></div><span style={{fontSize:10,color:omniColor,fontWeight:600}}>{omniLabel} {omniDist}</span></div>}
      {ic!=null&&edgeLabel&&<div style={{paddingTop:6,borderTop:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between"}}><span style={{fontSize:9,color:C.dim}}>Model edge (WF IC {ic.toFixed(3)})</span><span style={{fontSize:9,color:C.dim}}>{edgeLabel}</span></div>}
    </div>
  )
}
export default MLSignalBadge
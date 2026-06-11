import React from "react"
import { useMLSignals, MLSignal, MLSignalStrength, MLDirection } from "@/hooks/useMLSignal"

const C = { STRONG:"#22c55e",MODERATE:"#f59e0b",WEAK:"#64748b",NEUTRAL:"#475569",BULLISH:"#22c55e",BEARISH:"#ef4444",dim:"#475569",text:"#94a3b8" }

export function useScannerML(tickers: string[]) { return useMLSignals(tickers) }

function RankBadge({ rank, strength }: { rank: number|null; strength: MLSignalStrength }) {
  if (rank==null) return <span style={{fontSize:11,color:C.dim}}>—</span>
  const r = Math.round(rank)
  const color = r>=75?C.STRONG:r>=50?C.MODERATE:r>=25?C.WEAK:C.NEUTRAL
  return <span style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:32,height:20,borderRadius:3,backgroundColor:`${color}18`,border:`1px solid ${color}35`,fontSize:11,fontWeight:700,color}}>{r}</span>
}

function DirectionIcon({ direction }: { direction: MLDirection }) {
  const map: Record<MLDirection,{icon:string;color:string}> = { BULLISH:{icon:"↑",color:C.BULLISH},BEARISH:{icon:"↓",color:C.BEARISH},NEUTRAL:{icon:"→",color:C.NEUTRAL} }
  const cfg = map[direction]??map.NEUTRAL
  return <span style={{fontSize:12,color:cfg.color,fontWeight:600,lineHeight:"1"}}>{cfg.icon}</span>
}

export function ScannerMLCell({ signal, showProbability=false }: { signal: MLSignal; showProbability?: boolean }) {
  if (!signal.available) return <div style={{display:"flex",alignItems:"center",gap:6,opacity:0.3}}><span style={{fontSize:10,color:C.dim}}>—</span></div>
  const prob = signal.ml_probability_positive
  const probPct = prob!=null?Math.round(prob*100):null
  return (
    <div style={{display:"flex",alignItems:"center",gap:6}}>
      <RankBadge rank={signal.ml_rank_percentile} strength={signal.ml_signal_strength}/>
      <DirectionIcon direction={signal.ml_direction}/>
      {showProbability&&probPct!=null&&<span style={{fontSize:10,color:probPct>=55?C.BULLISH:probPct<=45?C.BEARISH:C.dim}}>{probPct}%</span>}
    </div>
  )
}

export function ScannerMLHeader() {
  return <div style={{display:"flex",flexDirection:"column",gap:1}}><span style={{fontSize:10,fontWeight:600,color:C.text}}>ML</span><span style={{fontSize:9,color:C.dim}}>Rank</span></div>
}

export function MLDirectionFilter({ value, onChange }: { value:"ALL"|"BULLISH"|"BEARISH"|"STRONG"; onChange:(v:"ALL"|"BULLISH"|"BEARISH"|"STRONG")=>void }) {
  const opts = [{key:"ALL",label:"All"},{key:"BULLISH",label:"↑ Bull"},{key:"BEARISH",label:"↓ Bear"},{key:"STRONG",label:"★ Strong"}] as const
  return (
    <div style={{display:"flex",gap:4,alignItems:"center"}}>
      <span style={{fontSize:10,color:C.dim,marginRight:4}}>ML:</span>
      {opts.map(o=><button key={o.key} onClick={()=>onChange(o.key)} style={{padding:"2px 8px",borderRadius:4,fontSize:10,fontWeight:500,cursor:"pointer",border:"1px solid",borderColor:value===o.key?C.MODERATE:"rgba(148,163,184,0.2)",backgroundColor:value===o.key?`${C.MODERATE}18`:"transparent",color:value===o.key?C.MODERATE:C.dim}}>{o.label}</button>)}
    </div>
  )
}

export function filterByMLDirection<T extends {ticker:string}>(results:T[],filter:"ALL"|"BULLISH"|"BEARISH"|"STRONG",getSignal:(t:string)=>MLSignal):T[] {
  if (filter==="ALL") return results
  return results.filter(r=>{ const s=getSignal(r.ticker); if(!s.available) return false; if(filter==="STRONG") return s.ml_signal_strength==="STRONG"; if(filter==="BULLISH") return s.ml_direction==="BULLISH"; if(filter==="BEARISH") return s.ml_direction==="BEARISH"; return true })
}

export default ScannerMLCell
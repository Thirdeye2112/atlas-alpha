import type { OHLCVBar } from "./marketData.js";

export interface VolumeEffortRead {
  signal: "no_demand" | "demand_confirmed" | "neutral";
  detail: string;
  recentUpVol: number;
  priorUpVol: number;
  madeNewHigh: boolean;
}

// Effort-vs-result read (the "big candle then tiny-volume drift that fails the
// prior high" tell): compare the latest up-thrust's volume + whether it made a new
// high vs the prior thrust. Returns a signal that confirms/denies a continuation.
export function readVolumeEffort(bars: OHLCVBar[], k = 6): VolumeEffortRead {
  const neutral: VolumeEffortRead = {
    signal: "neutral", detail: "insufficient data", recentUpVol: 0, priorUpVol: 0, madeNewHigh: false,
  };
  if (bars.length < 2 * k + 1) return neutral;
  const recent = bars.slice(-k);
  const prior  = bars.slice(-2 * k, -k);
  const upVol = (arr: OHLCVBar[]) => {
    const ups = arr.filter(b => b.close >= b.open);
    return ups.length ? ups.reduce((s, b) => s + (b.volume ?? 0), 0) / ups.length : 0;
  };
  const recentUpVol = upVol(recent), priorUpVol = upVol(prior);
  const recentHigh = Math.max(...recent.map(b => b.high));
  const priorHigh  = Math.max(...prior.map(b => b.high));
  const madeNewHigh = recentHigh > priorHigh * 1.001;
  const volFaded = priorUpVol > 0 && recentUpVol < priorUpVol * 0.8;

  if (!madeNewHigh && volFaded) {
    return { signal: "no_demand", recentUpVol, priorUpVol, madeNewHigh,
      detail: `Latest push failed the prior high on ${(recentUpVol / (priorUpVol || 1)).toFixed(2)}x the up-volume — no demand / distribution risk, favours a downside resolution.` };
  }
  if (madeNewHigh && recentUpVol >= priorUpVol) {
    return { signal: "demand_confirmed", recentUpVol, priorUpVol, madeNewHigh,
      detail: `New high made on rising up-volume — demand confirmed, continuation favoured.` };
  }
  return { signal: "neutral", recentUpVol, priorUpVol, madeNewHigh,
    detail: madeNewHigh ? "New high but on softer volume — watch for follow-through." : "No new high yet — consolidating." };
}

/** Tag a directional item as confirmed/contradicted by the volume-effort read. */
export function annotateWithVolume<T extends { direction?: string }>(p: T, vol: VolumeEffortRead): T & { volumeConfirms: boolean; volumeContradicts: boolean } {
  const bearish = p.direction === "short" || p.direction === "bearish" || p.direction === "bear";
  return {
    ...p,
    volumeConfirms:    (vol.signal === "no_demand" && bearish) || (vol.signal === "demand_confirmed" && !bearish),
    volumeContradicts: (vol.signal === "no_demand" && !bearish) || (vol.signal === "demand_confirmed" && bearish),
  };
}

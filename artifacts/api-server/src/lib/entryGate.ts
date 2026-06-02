import { type AnalysisResult } from "./analysisEngine.js";

export interface GateResult {
  enter: boolean;
  reasoning: string;
}

/**
 * Deterministic entry gate — uses our own candle structure, exhaustion engine,
 * IC calibration, and cycle signals. Zero latency, zero API cost.
 * Called both by the bot cycle (to block entries) and by snapshotEngine
 * (to record what the gate would have said at the time of each snapshot).
 */
export function smartEntryGate(a: AnalysisResult): GateResult {
  const rc = a.recentCandles;
  const ex = a.exhaustion;

  if (ex.distributionTop) {
    return { enter: false, reasoning: "Distribution top — stoch overbought + upper wick rejection + low RVOL at highs" };
  }

  if (ex.parabolicRise && rc && rc.consecutiveRedDays >= 2) {
    return {
      enter: false,
      reasoning: `Parabolic rise (+${rc.parabolicMovePct}% in ${rc.parabolicMoveDays}d) rolling over — ${rc.consecutiveRedDays} consecutive red days`,
    };
  }

  if (ex.exhaustionSignal && ex.exhaustionSignal !== "none" && rc && rc.priceExtensionPct > 15) {
    return {
      enter: false,
      reasoning: `Exhaustion signal + ${rc.priceExtensionPct}% above SMA20 — snap-back risk too high`,
    };
  }

  if (rc && rc.distributionCandles >= 2 && rc.downDayVolumeRatio > 1.2) {
    return {
      enter: false,
      reasoning: `${rc.distributionCandles} distribution candles (wick rejection) + down-vol ${rc.downDayVolumeRatio.toFixed(2)}× up-vol — sellers dominant`,
    };
  }

  if (rc && rc.priceExtensionPct > 25) {
    return {
      enter: false,
      reasoning: `${rc.priceExtensionPct}% extension above SMA20 — overextended, ATH-chasing risk`,
    };
  }

  if (rc && rc.climaxBars >= 1 && rc.consecutiveRedDays >= 2) {
    return {
      enter: false,
      reasoning: `Buying climax (${rc.climaxBars} high-vol green bars) followed by ${rc.consecutiveRedDays} red days — classic distribution`,
    };
  }

  const isContrarian = a.atlasScore.signalNarrative?.toLowerCase().includes("contrarian");
  if (isContrarian && a.atlasScore.overall >= 80) {
    return {
      enter: false,
      reasoning: `Contrarian IC signal: score ${a.atlasScore.overall} is historically followed by downside on this ticker`,
    };
  }

  return { enter: true, reasoning: "Candle structure clean — no distribution, exhaustion, or contrarian calibration blocks" };
}

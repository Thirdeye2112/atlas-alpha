/**
 * snapshotEngine — continuous signal learning system
 *
 * Three-stage loop that runs automatically after every scan job:
 *   1. saveSnapshotsBatch  — photographs every stock's full signal state today
 *   2. resolveOutcomes     — 7+ days later, fetches actual prices and scores predictions
 *   3. getLearnedPatterns  — SQL aggregation over resolved outcomes, surfaces which
 *                            signal combinations have historically worked
 *
 * The accumulated data feeds getConfidenceBoost(), which lets the analysis engine
 * cite historical hit-rates when flagging setups similar to past winners.
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import { db, signalSnapshotsTable } from "@workspace/db";
import { type AnalysisResult } from "./analysisEngine.js";
import { calibrationStore } from "./calibrationStore.js";
import { fetchOHLCV } from "./marketData.js";
import { smartEntryGate } from "./entryGate.js";
import { logger } from "./logger.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LearnedPattern {
  scoreBucket:     string;
  rsiZone:         string;
  isContrarian:    boolean | null;
  distributionTop: boolean | null;
  hasExhaustion:   boolean;
  cyclePhase:      string;
  smartGateEnter:  boolean | null;
  observations:    number;
  avgReturn10d:    number;
  stdReturn10d:    number;
  hitRate10d:      number;
  avgReturn20d:    number | null;
  hitRate20d:      number | null;
}

export interface LearningStats {
  totalSnapshots:      number;
  resolvedSnapshots:   number;
  unresolvedSnapshots: number;
  oldestSnapshotDate:  string | null;
  newestSnapshotDate:  string | null;
  avgHitRate10d:       number | null;
  avgReturn10d:        number | null;
}

export interface ConfidenceBoost {
  boostLabel:   string;
  hitRate10d:   number;
  avgReturn10d: number;
  observations: number;
  pattern:      string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function rsiZone(rsi: number): "oversold" | "neutral" | "overbought" {
  return rsi <= 30 ? "oversold" : rsi >= 70 ? "overbought" : "neutral";
}

function scoreBucket(score: number): "very_low" | "low" | "mid" | "high" {
  return score <= 30 ? "very_low" : score <= 50 ? "low" : score <= 70 ? "mid" : "high";
}

// ── 1. Save snapshots ──────────────────────────────────────────────────────────

export async function saveSnapshotsBatch(analyses: AnalysisResult[]): Promise<void> {
  if (!analyses.length) return;

  const today = new Date().toISOString().slice(0, 10);

  const rows = analyses.map(a => {
    const ticker  = String(a.quote.ticker ?? "");
    const cal     = calibrationStore.getFitted(ticker);
    const rc      = a.recentCandles;
    const ex      = a.exhaustion;
    const mc      = a.marketCycle;
    const gate    = smartEntryGate(a);
    const rsi     = a.momentum?.rsi ?? 50;

    return {
      ticker,
      snapshotDate:        today,
      price:               (a.quote.price as number | null) ?? null,
      score:               a.atlasScore.overall,
      direction:           a.atlasScore.direction,
      bullishProbability:  a.atlasScore.bullishProbability,
      trendScore:          a.atlasScore.trendScore,
      momentumScore:       a.atlasScore.momentumScore,
      volumeScore:         a.atlasScore.volumeScore,
      rsScore:             a.atlasScore.relativeStrengthScore ?? null,
      regimeScore:         a.atlasScore.marketRegimeScore ?? null,
      exhaustionScore:     a.atlasScore.exhaustionScore ?? null,
      rankIc:              cal?.rankIC ?? null,
      isContrarian:        cal?.rankIC != null ? cal.rankIC < 0 : null,
      calibratedProb:      a.atlasScore.bullishProbability,
      rsi,
      rsiZone:             rsiZone(rsi),
      rvol:                a.volume?.relativeVolume ?? null,
      atrPct:              a.volatility?.atrPercent ?? null,
      distributionCandles: rc?.distributionCandles ?? null,
      climaxBars:          rc?.climaxBars ?? null,
      downDayVolRatio:     rc?.downDayVolumeRatio ?? null,
      parabolicPct:        rc?.parabolicMovePct ?? null,
      consecutiveRedDays:  rc?.consecutiveRedDays ?? null,
      priceExtensionPct:   rc?.priceExtensionPct ?? null,
      exhaustionSignal:    ex?.exhaustionSignal ?? null,
      distributionTop:     ex?.distributionTop ?? null,
      parabolicRise:       ex?.parabolicRise ?? null,
      cyclePhase:          mc?.cyclePhase ?? null,
      cycleStrength:       mc?.cycleStrength ?? null,
      patterns:            (a.patterns?.patterns ?? []) as string[],
      weeklyPatterns:      (mc?.weeklyPatterns ?? []) as string[],
      pullbackClass:       a.pullbackSetup?.classification ?? null,
      smartGateEnter:      gate.enter,
      smartGateReason:     gate.reasoning,
    };
  });

  await db.insert(signalSnapshotsTable).values(rows).onConflictDoNothing();
  logger.info({ count: rows.length, date: today }, "Signal snapshots saved");
}

// ── 2. Resolve outcomes ────────────────────────────────────────────────────────

export async function resolveOutcomes(): Promise<number> {
  const unresolved = await db
    .select()
    .from(signalSnapshotsTable)
    .where(and(
      isNull(signalSnapshotsTable.outcomeResolvedAt),
      sql`snapshot_date <= CURRENT_DATE - INTERVAL '7 days'`,
    ))
    .limit(120);

  if (!unresolved.length) return 0;

  const byTicker = new Map<string, typeof unresolved>();
  for (const s of unresolved) {
    const arr = byTicker.get(s.ticker) ?? [];
    arr.push(s);
    byTicker.set(s.ticker, arr);
  }

  let resolved = 0;

  for (const [ticker, snapshots] of byTicker) {
    let bars: Awaited<ReturnType<typeof fetchOHLCV>>;
    try { bars = await fetchOHLCV(ticker, "1D", "3mo"); }
    catch { continue; }
    if (!bars.length) continue;

    for (const snap of snapshots) {
      const snapDate   = snap.snapshotDate as string;
      const idx        = bars.findIndex(b => b.time >= snapDate);
      if (idx < 0) continue;

      const entryPrice = snap.price ?? bars[idx]?.close;
      if (!entryPrice) continue;

      const ret = (n: number): number | null => {
        const bar = bars[idx + n];
        return bar ? ((bar.close - entryPrice) / entryPrice) * 100 : null;
      };

      const forwardReturn5d  = ret(5);
      const forwardReturn10d = ret(10);
      const forwardReturn20d = ret(20);

      if (forwardReturn5d === null && forwardReturn10d === null && forwardReturn20d === null) continue;

      await db
        .update(signalSnapshotsTable)
        .set({ forwardReturn5d, forwardReturn10d, forwardReturn20d, outcomeResolvedAt: new Date() })
        .where(eq(signalSnapshotsTable.id, snap.id));

      resolved++;
    }
  }

  if (resolved > 0) logger.info({ resolved }, "Signal snapshot outcomes resolved");
  return resolved;
}

// ── 3. Query learned patterns ──────────────────────────────────────────────────

export async function getLearnedPatterns(): Promise<LearnedPattern[]> {
  const result = await db.execute(sql`
    SELECT
      CASE WHEN score <= 30 THEN 'very_low'
           WHEN score <= 50 THEN 'low'
           WHEN score <= 70 THEN 'mid'
           ELSE 'high' END                                                    AS score_bucket,
      COALESCE(rsi_zone, 'neutral')                                           AS rsi_zone,
      is_contrarian,
      distribution_top,
      (exhaustion_signal IS NOT NULL AND exhaustion_signal != 'none')         AS has_exhaustion,
      COALESCE(cycle_phase, 'unknown')                                        AS cycle_phase,
      smart_gate_enter,
      COUNT(*)::int                                                            AS observations,
      ROUND(AVG(forward_return_10d)::numeric, 2)                             AS avg_return_10d,
      ROUND(COALESCE(STDDEV(forward_return_10d), 0)::numeric, 2)             AS std_return_10d,
      ROUND(AVG(CASE WHEN forward_return_10d > 0 THEN 1.0 ELSE 0.0 END)::numeric, 3) AS hit_rate_10d,
      ROUND(AVG(forward_return_20d)::numeric, 2)                             AS avg_return_20d,
      ROUND(AVG(CASE WHEN forward_return_20d > 0 THEN 1.0 ELSE 0.0 END)::numeric, 3) AS hit_rate_20d
    FROM signal_snapshots
    WHERE forward_return_10d IS NOT NULL
    GROUP BY 1, 2, 3, 4, 5, 6, 7
    HAVING COUNT(*) >= 3
    ORDER BY ABS(AVG(forward_return_10d)) DESC, COUNT(*) DESC
    LIMIT 40
  `);

  return (result.rows as Record<string, unknown>[]).map(r => ({
    scoreBucket:     String(r.score_bucket   ?? ""),
    rsiZone:         String(r.rsi_zone       ?? "neutral"),
    isContrarian:    r.is_contrarian  != null ? Boolean(r.is_contrarian)  : null,
    distributionTop: r.distribution_top != null ? Boolean(r.distribution_top) : null,
    hasExhaustion:   Boolean(r.has_exhaustion),
    cyclePhase:      String(r.cycle_phase    ?? "unknown"),
    smartGateEnter:  r.smart_gate_enter != null ? Boolean(r.smart_gate_enter) : null,
    observations:    Number(r.observations   ?? 0),
    avgReturn10d:    Number(r.avg_return_10d ?? 0),
    stdReturn10d:    Number(r.std_return_10d ?? 0),
    hitRate10d:      Number(r.hit_rate_10d   ?? 0),
    avgReturn20d:    r.avg_return_20d  != null ? Number(r.avg_return_20d)  : null,
    hitRate20d:      r.hit_rate_20d    != null ? Number(r.hit_rate_20d)    : null,
  }));
}

// ── 4. Learning stats ─────────────────────────────────────────────────────────

export async function getLearningStats(): Promise<LearningStats> {
  const result = await db.execute(sql`
    SELECT
      COUNT(*)::int                                                            AS total,
      COUNT(outcome_resolved_at)::int                                          AS resolved,
      MIN(snapshot_date)::text                                                 AS oldest,
      MAX(snapshot_date)::text                                                 AS newest,
      ROUND(AVG(CASE WHEN forward_return_10d > 0 THEN 1.0 ELSE 0.0 END)::numeric, 3) AS avg_hit_rate,
      ROUND(AVG(forward_return_10d)::numeric, 2)                              AS avg_return
    FROM signal_snapshots
  `);

  const r = (result.rows[0] ?? {}) as Record<string, unknown>;
  const total    = Number(r.total    ?? 0);
  const resolved = Number(r.resolved ?? 0);

  return {
    totalSnapshots:      total,
    resolvedSnapshots:   resolved,
    unresolvedSnapshots: total - resolved,
    oldestSnapshotDate:  r.oldest  != null ? String(r.oldest)  : null,
    newestSnapshotDate:  r.newest  != null ? String(r.newest)  : null,
    avgHitRate10d:       r.avg_hit_rate != null ? Number(r.avg_hit_rate) : null,
    avgReturn10d:        r.avg_return   != null ? Number(r.avg_return)   : null,
  };
}

// ── 5. Confidence boost from historical patterns ───────────────────────────────

export async function getConfidenceBoost(a: AnalysisResult): Promise<ConfidenceBoost | null> {
  const ticker   = String(a.quote.ticker ?? "");
  const cal      = calibrationStore.getFitted(ticker);
  const rsi      = a.momentum?.rsi ?? 50;
  const score    = a.atlasScore.overall;
  const zone     = rsiZone(rsi);
  const bucket   = scoreBucket(score);
  const isCont   = cal?.rankIC != null ? cal.rankIC < 0 : null;
  const hasExh   = (a.exhaustion?.exhaustionSignal ?? "none") !== "none";
  const phase    = a.marketCycle?.cyclePhase ?? "unknown";

  const result = await db.execute(sql`
    SELECT
      COUNT(*)::int                                                            AS observations,
      ROUND(AVG(forward_return_10d)::numeric, 2)                             AS avg_return_10d,
      ROUND(AVG(CASE WHEN forward_return_10d > 0 THEN 1.0 ELSE 0.0 END)::numeric, 3) AS hit_rate_10d
    FROM signal_snapshots
    WHERE forward_return_10d IS NOT NULL
      AND CASE WHEN score <= 30 THEN 'very_low'
               WHEN score <= 50 THEN 'low'
               WHEN score <= 70 THEN 'mid'
               ELSE 'high' END = ${bucket}
      AND COALESCE(rsi_zone, 'neutral') = ${zone}
      AND (${isCont}::boolean IS NULL OR is_contrarian = ${isCont}::boolean)
      AND (exhaustion_signal IS NOT NULL AND exhaustion_signal != 'none') = ${hasExh}
      AND COALESCE(cycle_phase, 'unknown') = ${phase}
  `);

  const r = (result.rows[0] ?? {}) as Record<string, unknown>;
  const obs     = Number(r.observations   ?? 0);
  const hitRate = Number(r.hit_rate_10d   ?? 0);
  const avgRet  = Number(r.avg_return_10d ?? 0);

  if (obs < 5) return null;

  const label = hitRate >= 0.65 ? "High Historical Accuracy"
    : hitRate >= 0.55            ? "Moderate Historical Accuracy"
    :                              "Below-Average Historical Accuracy";

  return {
    boostLabel:   label,
    hitRate10d:   hitRate,
    avgReturn10d: avgRet,
    observations: obs,
    pattern:      `${bucket} score | ${zone} RSI | ${isCont != null ? (isCont ? "contrarian" : "momentum") : "any"} IC | ${hasExh ? "with" : "no"} exhaustion | ${phase} cycle`,
  };
}

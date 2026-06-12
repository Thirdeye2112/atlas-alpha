import { db, paperTradesTable, botConfigTable, patternPerformanceTable, positionFlipsTable, type PaperTrade, type BotConfig } from "@workspace/db";
import { eq, desc, and, sql } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";
import { getOrStartScanJob } from "./scanJob.js";
import { smartEntryGate } from "./entryGate.js";
import { runFullAnalysis, type AnalysisResult } from "./analysisEngine.js";
import { analysisCache } from "./cache.js";
import { logger } from "./logger.js";
import { getMarketContext, getIntelligenceVerdict, runSelfLearning, type MarketContext } from "./botIntelligence.js";
import { calcReversalScore, computeReversalShortLevels } from "./reversalShort.js";
import { detectReversal, computeFlipTargets } from "./reversal-detector.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CustomCriterion {
  field: string;
  operator: "gt" | "lt" | "gte" | "lte" | "eq" | "neq" | "between" | "contains" | "notContains" | "includes";
  value: number | string;
  value2?: number;
}

export interface BotCycleResult {
  skipped?: boolean;
  reason?: string;
  exited: string[];
  newEntries: string[];
  openCount: number;
  runAt: string;
}

export interface ReversalRisk {
  score:    number;
  triggers: string[];
  urgency:  "forming" | "confirmed" | "extended";
}

export interface EnrichedTrade extends PaperTrade {
  currentPrice?: number;
  currentScore?: number;
  unrealizedPnlPct?: number;
  unrealizedPnlDollar?: number;
  holdDays?: number;
  currentCyclePhase?: string;
  currentWeeklyPatterns?: string[];
  reversalRisk?: ReversalRisk | null;
}

export interface BotStats {
  totalTrades: number;
  openTrades: number;
  closedTrades: number;
  winRate: number;
  avgPnlPct: number;
  totalPnlPct: number;
  bestTrade: number;
  worstTrade: number;
  avgHoldDays: number;
  byExitReason: Record<string, { count: number; avgPnl: number }>;
  virtualPortfolioValue: number;
}

export interface SignalGroup {
  label: string;
  trades: number;
  winRate: number;
  avgPnl: number;
  bestPnl: number;
  worstPnl: number;
}

export interface SignalPerformance {
  byScoreBucket: SignalGroup[];
  byRsiRange: SignalGroup[];
  byRvol: SignalGroup[];
  byPattern: SignalGroup[];
  totalClosed: number;
  bestSignal: string;
  worstSignal: string;
}

// ── Pattern lists ─────────────────────────────────────────────────────────────

const BULLISH_CANDLES = [
  "bullish_engulfing", "hammer", "morning_star", "morning_doji_star",
  "bullish_harami", "bullish_harami_cross", "dragonfly_doji",
  "piercing_line", "three_white_soldiers", "bullish_marubozu",
  "tweezer_bottom", "abandoned_baby_bullish",
];

const BEARISH_CANDLES = [
  "bearish_engulfing", "shooting_star", "evening_star", "evening_doji_star",
  "bearish_harami", "bearish_harami_cross", "gravestone_doji",
  "dark_cloud_cover", "three_black_crows", "bearish_marubozu",
  "tweezer_top", "abandoned_baby_bearish", "hanging_man",
];

const CONTINUATION_PATTERNS = [
  "bull_flag", "ascending_triangle", "symmetrical_triangle",
  "rectangle_base", "cup_and_handle", "inverse_head_and_shoulders",
];

const DISTRIBUTION_PATTERNS = [
  "bear_flag", "evening_star", "evening_doji_star", "three_black_crows",
  "head_and_shoulders", "bearish_engulfing", "shooting_star",
  "double_top", "hanging_man", "descending_triangle", "island_reversal",
];

// ── Category-specific risk:reward multipliers ─────────────────────────────────
// Mean-reversion trades target a natural anchor (SMA, BB mid) that is closer
// than a trend extension — 1.5:1 is more realistic and avoids over-targeting.
// Gap/squeeze plays are volatile with high slippage; 2:1 balances reward vs.
// the elevated probability of a partial fill or quick fade.
// Breakout / institutional accumulation / high-prob longs support the full 3:1.
const MEAN_REVERSION_CATS = ["mean_reversion", "key_sr"];
const GAP_SQUEEZE_CATS    = ["gap_up", "gap_down", "gap_setup", "gamma_squeeze", "short_squeeze"];

function getRRMultiplier(cats: string[]): number {
  const lower = cats.map(c => c.toLowerCase());
  if (lower.some(c => MEAN_REVERSION_CATS.some(mr => c.includes(mr)))) return 1.5;
  if (lower.some(c => GAP_SQUEEZE_CATS.some(g => c.includes(g)))) return 2.0;
  return 3.0;
}

// ── Entry level computation ────────────────────────────────────────────────────

interface EntryLevels {
  stopPrice:   number;
  targetPrice: number;
  atrPct:      number;
  trigger:     string;
  t1Price:     number;
  t2Price:     number;
  t3Price:     number;
}

/**
 * Compute ATR-based stop/target for a given analysis and check for candle
 * confirmation + support proximity. Returns null if no setup is confirmed
 * this cycle — the bot will wait for a better entry next cycle.
 *
 * Stop distance varies by entry quality (1–2× ATR); default target is 3×
 * stop distance (3:1 R:R). The call site applies category-specific R:R overrides
 * (mean-reversion → 1.5:1; gap/squeeze → 2:1) after scanner categories are known.
 */
function computeEntryLevels(a: AnalysisResult): EntryLevels | null {
  const price   = a.quote.price as number;
  const atrPct  = a.volatility.atrPercent;
  const atr     = price * atrPct / 100;
  const score   = a.atlasScore.overall;
  const rsi     = a.momentum.rsi;
  const isShort = a.atlasScore.direction === "bearish";

  const patterns         = (a.patterns?.patterns ?? []) as string[];
  const hasBullishCandle = patterns.some(p => BULLISH_CANDLES.some(b => p.toLowerCase().includes(b)));
  const hasBearishCandle = patterns.some(p => BEARISH_CANDLES.some(b => p.toLowerCase().includes(b)));

  const sma20        = a.trend.sma20;
  const lowerBB      = a.volatility.bollingerLower;
  const upperBB      = a.volatility.bollingerUpper ?? 0;
  const pctFromSma20 = ((price - sma20) / sma20) * 100;
  const nearSma20    = Math.abs(pctFromSma20) <= 3;
  const nearLowerBB  = lowerBB > 0 && ((price - lowerBB) / lowerBB) * 100 <= 2;
  const nearUpperBB  = upperBB > 0 && ((upperBB - price) / price) * 100 <= 2;
  const nearSupport    = nearSma20 || nearLowerBB;
  const nearResistance = nearSma20 || nearUpperBB;

  // Shared helper: attach T1/T2/T3 milestones (1.5×/3×/5× ATR from entry)
  const withMilestones = (base: { stopPrice: number; targetPrice: number; atrPct: number; trigger: string }): EntryLevels => {
    const sign = isShort ? -1 : 1;
    return {
      ...base,
      t1Price: price + sign * 1.5 * atr,
      t2Price: price + sign * 3.0 * atr,
      t3Price: price + sign * 5.0 * atr,
    };
  };

  if (isShort) {
    // ── Short entry tiers (stop ABOVE entry, target BELOW) ────────────────────

    // Short Tier 1 — Ideal: bearish candle at a resistance level → tight 1× ATR stop
    if (hasBearishCandle && nearResistance) {
      const d = 1.0 * atr;
      return withMilestones({ stopPrice: price + d, targetPrice: price - d * 3, atrPct, trigger: "bearish_candle_at_resistance" });
    }
    // Short Tier 2 — Good: bearish candle with RSI elevated (overbought momentum)
    if (hasBearishCandle && rsi > 60) {
      const d = 1.5 * atr;
      return withMilestones({ stopPrice: price + d, targetPrice: price - d * 3, atrPct, trigger: "bearish_candle_reversal" });
    }
    // Short Tier 3 — Good: price extended above SMA20 in confirmed downtrend
    if (pctFromSma20 > 3 && score >= 65 && a.atlasScore.trendScore >= 60) {
      const d = 1.5 * atr;
      return withMilestones({ stopPrice: price + d, targetPrice: price - d * 3, atrPct, trigger: "short_at_extension" });
    }
    // Short Tier 4 — Acceptable: any bearish candle with good score
    if (hasBearishCandle && score >= 65) {
      const d = 1.5 * atr;
      return withMilestones({ stopPrice: price + d, targetPrice: price - d * 3, atrPct, trigger: "bearish_candle_downtrend" });
    }
    // Short Tier 5 — Strong bearish momentum entry
    if (score >= 78 && a.atlasScore.trendScore >= 65 && a.atlasScore.momentumScore >= 60) {
      const d = 2.0 * atr;
      return withMilestones({ stopPrice: price + d, targetPrice: price - d * 3, atrPct, trigger: "strong_bearish_momentum" });
    }
    return null;
  }

  // ── Long entry tiers (stop BELOW entry, target ABOVE) ─────────────────────

  // Tier 1 — Ideal: bullish candle AT a support level → tight 1× ATR stop
  if (hasBullishCandle && nearSupport) {
    const d = 1.0 * atr;
    return withMilestones({ stopPrice: price - d, targetPrice: price + d * 3, atrPct, trigger: "candle_at_support" });
  }
  // Tier 2 — Good: bullish candle on an RSI pullback (not yet overbought)
  if (hasBullishCandle && rsi < 52) {
    const d = 1.5 * atr;
    return withMilestones({ stopPrice: price - d, targetPrice: price + d * 3, atrPct, trigger: "candle_pullback" });
  }
  // Tier 3 — Good: price has pulled back to SMA20 region in an uptrend
  if (nearSma20 && score >= 65 && a.atlasScore.trendScore >= 60) {
    const d = 1.5 * atr;
    return withMilestones({ stopPrice: price - d, targetPrice: price + d * 3, atrPct, trigger: "pullback_to_sma20" });
  }
  // Tier 4 — Acceptable: any bullish candle in an uptrend (not extended >8%)
  if (hasBullishCandle && score >= 65 && pctFromSma20 < 8) {
    const d = 1.5 * atr;
    return withMilestones({ stopPrice: price - d, targetPrice: price + d * 3, atrPct, trigger: "bullish_candle_uptrend" });
  }
  // Tier 5 — Acceptable: very strong score + strong trend, momentum entry
  if (score >= 78 && a.atlasScore.trendScore >= 65 && a.atlasScore.momentumScore >= 60) {
    const d = 2.0 * atr;
    return withMilestones({ stopPrice: price - d, targetPrice: price + d * 3, atrPct, trigger: "strong_momentum_immediate" });
  }

  return null;
}

function hasContinuationSignal(a: AnalysisResult): boolean {
  const patterns  = (a.patterns?.patterns ?? []) as string[];
  const hasCont   = patterns.some(p => CONTINUATION_PATTERNS.some(c => p.toLowerCase().includes(c)));
  const inStage2  = a.marketCycle?.cyclePhase === "markup";
  const strongTrend = a.atlasScore.trendScore >= 65 && a.trend.priceVsSma20 > 0;
  const risingMom = a.atlasScore.momentumScore >= 55;
  return hasCont || (inStage2 && strongTrend && risingMom);
}

function hasDistributionSignal(a: AnalysisResult): boolean {
  const patterns = (a.patterns?.patterns ?? []) as string[];
  return (
    a.exhaustion.distributionTop ||
    patterns.some(p => DISTRIBUTION_PATTERNS.some(d => p.toLowerCase().includes(d)))
  );
}

// ── Field accessor (mirrors scanner.ts for filter evaluation) ─────────────────

type FieldValue = number | string | string[];

function getFieldValue(a: AnalysisResult, field: string): FieldValue {
  switch (field) {
    case "score":               return a.atlasScore.overall;
    case "trendScore":          return a.atlasScore.trendScore;
    case "momentumScore":       return a.atlasScore.momentumScore;
    case "volumeScore":         return a.atlasScore.volumeScore;
    case "relStrengthScore":    return a.atlasScore.relativeStrengthScore;
    case "exhaustionScore":     return a.atlasScore.exhaustionScore;
    case "regimeScore":         return a.atlasScore.marketRegimeScore;
    case "bullishProbability":  return a.atlasScore.bullishProbability;
    case "confidenceScore":     return a.atlasScore.confidenceScore;
    case "rsi":                 return a.momentum.rsi;
    case "stochK":              return a.momentum.stochK;
    case "macd":                return a.momentum.macd;
    case "relativeVolume":      return a.volume.relativeVolume;
    case "atrPercent":          return a.volatility.atrPercent;
    case "bbWidthPct":          return a.volatility.bollingerMiddle > 0
                                  ? (a.volatility.bollingerWidth / a.volatility.bollingerMiddle) * 100 : 0;
    case "priceVsSma50":        return a.trend.priceVsSma50;
    case "priceVsSma200":       return a.trend.priceVsSma200;
    case "price":               return a.quote.price as number;
    case "changePercent":       return a.quote.changePercent as number;
    case "direction":           return a.atlasScore.direction;
    case "sector":              return ((a.quote.sector as string | undefined) ?? "").toLowerCase();
    case "exhaustion":          return a.exhaustion.exhaustionSignal;
    case "pullbackClass":       return a.pullbackSetup?.classification ?? "unknown";
    case "signalStrength": {
      const s = a.atlasScore.overall;
      return s >= 75 ? "strong" : s >= 55 ? "moderate" : "weak";
    }
    case "patterns":            return (a.patterns?.patterns ?? []) as string[];
    case "cyclePhase":          return a.marketCycle?.cyclePhase ?? "ranging";
    case "weeklyPatterns":      return (a.marketCycle?.weeklyPatterns ?? []) as string[];
    case "distFrom52wHigh":     return a.marketCycle?.distFrom52wHigh ?? 0;
    case "sma40Rising":         return a.marketCycle?.sma40Rising ? "yes" : "no";
    case "weeklyRsi":           return a.marketCycle?.weeklyRsi ?? a.momentum.rsi;
    case "priceVsSma40Weekly":  return a.marketCycle?.priceVsSma40Weekly ?? 0;
    case "pattern":             return (a.patterns?.patterns ?? []) as string[];
    // ── Candle structure fields ───────────────────────────────────────────
    case "distributionCandles":   return a.recentCandles?.distributionCandles ?? 0;
    case "climaxBars":            return a.recentCandles?.climaxBars ?? 0;
    case "downDayVolumeRatio":    return a.recentCandles?.downDayVolumeRatio ?? 1;
    case "parabolicMovePct":      return a.recentCandles?.parabolicMovePct ?? 0;
    case "consecutiveRedDays":    return a.recentCandles?.consecutiveRedDays ?? 0;
    case "priceExtensionPct":     return a.recentCandles?.priceExtensionPct ?? 0;
    default:                    return 0;
  }
}

function applyCustomCriterion(a: AnalysisResult, c: CustomCriterion): boolean {
  const raw = getFieldValue(a, c.field);
  // "includes" — exact-match membership test (used by the pattern picker UI)
  if (c.operator === "includes") {
    const arr = Array.isArray(raw) ? raw : [String(raw)];
    const needle = String(c.value);
    return arr.some(s => s === needle);
  }
  if (c.operator === "contains" || c.operator === "notContains") {
    const arr = Array.isArray(raw) ? raw : [String(raw)];
    const needle = String(c.value).toLowerCase();
    const found = arr.some(s => s.toLowerCase().includes(needle));
    return c.operator === "contains" ? found : !found;
  }
  if (typeof raw === "string") {
    const rv = String(c.value).toLowerCase();
    if (c.operator === "eq")  return raw.toLowerCase() === rv;
    if (c.operator === "neq") return raw.toLowerCase() !== rv;
    return false;
  }
  const num = typeof raw === "number" ? raw : parseFloat(String(raw));
  const cv  = typeof c.value === "number" ? c.value : parseFloat(String(c.value));
  switch (c.operator) {
    case "gt":      return num > cv;
    case "lt":      return num < cv;
    case "gte":     return num >= cv;
    case "lte":     return num <= cv;
    case "eq":      return num === cv;
    case "neq":     return num !== cv;
    case "between": return c.value2 !== undefined ? num >= cv && num <= c.value2 : num >= cv;
    default:        return true;
  }
}

// ── Config helpers ────────────────────────────────────────────────────────────

export async function getOrCreateConfig(): Promise<BotConfig> {
  const existing = await db.select().from(botConfigTable).limit(1);
  if (existing.length > 0) return existing[0];
  const [created] = await db.insert(botConfigTable).values({}).returning();
  return created;
}

export async function updateConfig(patch: Partial<Omit<BotConfig, "id">>): Promise<BotConfig> {
  const existing = await getOrCreateConfig();
  const [updated] = await db
    .update(botConfigTable)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(botConfigTable.id, existing.id))
    .returning();
  return updated;
}

// ── Position helpers ──────────────────────────────────────────────────────────


async function openPosition(
  a: AnalysisResult,
  config: BotConfig,
  levels: EntryLevels,
  aiNotes?: string | null,
  scannerCategories?: string[],
  positionMultiplier = 1.0,
  decisionLog?: Record<string, unknown> | null,
  directionOverride?: string,  // used for reversal flips when Atlas score hasn't caught up yet
): Promise<number> {
  const price    = a.quote.price as number;
  const basePosValue = (config.virtualPortfolio * config.positionSizePct) / 100;
  const posValue = basePosValue * positionMultiplier;
  const shares   = posValue / price;
  const ticker   = a.quote.ticker as string;
  const direction = directionOverride ?? a.atlasScore.direction;

  const [inserted] = await db.insert(paperTradesTable).values({
    ticker,
    name:               (a.quote.name as string) || ticker,
    entryPrice:         price,
    entryScore:         a.atlasScore.overall,
    entryDirection:     direction,
    entryBullishProb:   a.atlasScore.bullishProbability,
    entryRsi:           a.momentum.rsi,
    entryRvol:          a.volume.relativeVolume,
    entryMomentumScore: a.atlasScore.momentumScore,
    entryTrendScore:    a.atlasScore.trendScore,
    entryCriteria:      config.entryCriteria as unknown as Record<string, unknown>,
    entryPatterns:      (a.patterns?.patterns ?? []) as unknown as Record<string, unknown>,
    entryTrigger:       levels.trigger,
    atrPctAtEntry:      levels.atrPct,
    stopPrice:          levels.stopPrice,
    targetPrice:        levels.targetPrice,
    trailingStopPrice:  levels.stopPrice,
    peakPrice:          price,
    // T1/T2/T3 milestones — stored at entry, used for stop ratcheting
    t1Price:            levels.t1Price,
    t2Price:            levels.t2Price,
    t3Price:            levels.t3Price,
    t1Hit:              false,
    t2Hit:              false,
    scannerCategories:  (scannerCategories ?? []) as unknown as Record<string, unknown>[],
    positionValue:      posValue,
    shares,
    status:             "open",
    aiNotes:            aiNotes ?? null,
    decisionLog:        decisionLog ?? null,
  }).returning({ id: paperTradesTable.id });

  logger.info(
    { ticker, price, score: a.atlasScore.overall, trigger: levels.trigger,
      stop: levels.stopPrice.toFixed(2), target: levels.targetPrice.toFixed(2),
      direction,
      categories: (scannerCategories ?? []).join(",") || "none",
      sizeMult: positionMultiplier.toFixed(2) },
    "Bot opened position",
  );

  return inserted?.id ?? 0;
}

async function closePosition(
  trade: PaperTrade,
  exitPrice: number,
  exitScore: number,
  exitReason: string,
): Promise<void> {
  const isShort    = trade.entryDirection === "bearish";
  const pnlPercent = isShort
    ? ((trade.entryPrice - exitPrice) / trade.entryPrice) * 100
    : ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100;
  const pnlDollar  = isShort
    ? (trade.shares ?? 0) * (trade.entryPrice - exitPrice)
    : (trade.shares ?? 0) * (exitPrice - trade.entryPrice);

  await db
    .update(paperTradesTable)
    .set({
      exitPrice,
      exitScore,
      exitReason,
      exitAt:     new Date(),
      pnlPercent,
      pnlDollar,
      status:     "closed",
    })
    .where(eq(paperTradesTable.id, trade.id));

  logger.info({ ticker: trade.ticker, exitReason, pnlPercent: pnlPercent.toFixed(2) }, "Bot closed position");

  // Fire-and-forget: update per-pattern hit rates for the self-learning loop
  const entryPatterns = (trade.entryPatterns ?? []) as string[];
  if (entryPatterns.length > 0) {
    const win = pnlPercent > 0;
    Promise.all(
      entryPatterns.map(pattern =>
        db.insert(patternPerformanceTable)
          .values({ pattern, direction: trade.entryDirection, horizon: 5, totalTrades: 1, wins: win ? 1 : 0, losses: win ? 0 : 1 })
          .onConflictDoUpdate({
            target: [patternPerformanceTable.pattern, patternPerformanceTable.direction, patternPerformanceTable.horizon],
            set: {
              totalTrades: sql`${patternPerformanceTable.totalTrades} + 1`,
              wins:        sql`${patternPerformanceTable.wins} + ${win ? 1 : 0}`,
              losses:      sql`${patternPerformanceTable.losses} + ${win ? 0 : 1}`,
              updatedAt:   new Date(),
            },
          })
      )
    ).catch(err => logger.warn({ err, ticker: trade.ticker }, "Failed to update pattern performance"));
  }

  // Fire-and-forget: re-run self-learning immediately so the score threshold
  // adapts as soon as this result is on record — no need to wait for EOD.
  runSelfLearning().catch(err => logger.warn({ err, ticker: trade.ticker }, "Self-learning post-close failed"));
}

// ── Manual flip ──────────────────────────────────────────────────────────────
// Trader-initiated flip: close existing position and open the opposite direction.
// The bot warns but never auto-flips; this gives the human the final say.

export async function manualFlipPosition(tradeId: number): Promise<{ closedId: number; newTradeId: number }> {
  const [trade] = await db.select().from(paperTradesTable).where(eq(paperTradesTable.id, tradeId));
  if (!trade)               throw new Error(`Trade ${tradeId} not found`);
  if (trade.status !== "open") throw new Error(`Trade ${tradeId} is not open`);

  const analysis = await runFullAnalysis(trade.ticker);
  const price    = analysis.quote.price as number;
  const score    = analysis.atlasScore.overall;
  const isShort  = trade.entryDirection === "bearish";
  const newDir   = isShort ? "bullish" : "bearish";

  const closePnlPct = isShort
    ? ((trade.entryPrice - price) / trade.entryPrice) * 100
    : ((price - trade.entryPrice) / trade.entryPrice) * 100;

  await closePosition(trade, price, score, "manual_flip");

  const flipTargets = await computeFlipTargets(trade.ticker, price, newDir);
  if (!flipTargets) throw new Error(`Could not compute flip targets for ${trade.ticker}`);

  const config = await getOrCreateConfig();
  const flipLog = {
    manualFlip:      true,
    fromDirection:   trade.entryDirection,
    toDirection:     newDir,
    closePnlPct,
    reversalWarning: true,
  };
  const newTradeId = await openPosition(
    analysis, config, flipTargets,
    `Manual flip from ${trade.entryDirection} to ${newDir}`,
    ["manual_flip"],
    1.0,
    flipLog,
    newDir,
  );

  await db.insert(positionFlipsTable).values({
    ticker:        trade.ticker,
    fromDirection: trade.entryDirection,
    toDirection:   newDir,
    closePrice:    price,
    closePnlPct,
    openPrice:     price,
    confidence:    (trade.decisionLog as { reversalConfidence?: number } | null)?.reversalConfidence ?? 0,
    signalsFired:  ((trade.decisionLog as { reversalSignals?: string[] } | null)?.reversalSignals ?? []).map(s => ({ name: s })) as unknown as Record<string, unknown>[],
    reason:        "manual_flip",
    fromTradeId:   trade.id,
    toTradeId:     newTradeId,
  });

  logger.info(
    { ticker: trade.ticker, from: trade.entryDirection, to: newDir, closePnlPct: closePnlPct.toFixed(2) },
    "Manual flip executed by trader",
  );

  return { closedId: trade.id, newTradeId };
}

// ── Main cycle ────────────────────────────────────────────────────────────────

let lastRunAt: Date | null = null;
let cycleRunning = false;

export function getBotRunState() {
  return { lastRunAt, cycleRunning };
}

// ── 5-minute lightweight position checker ────────────────────────────────────
// Only updates T1/T2 milestone stops and trailing stop for open positions.
// Runs on a 5-min interval separate from the full 30-min cycle.

let positionCheckRunning = false;

export async function checkOpenPositions(): Promise<void> {
  if (positionCheckRunning) return;
  const config = await getOrCreateConfig();
  if (!config.enabled) return;

  positionCheckRunning = true;
  try {
    const openTrades = await db.select().from(paperTradesTable).where(eq(paperTradesTable.status, "open"));
    if (openTrades.length === 0) return;

    for (const trade of openTrades) {
      let analysis: AnalysisResult | undefined;
      try { analysis = await runFullAnalysis(trade.ticker); } catch { continue; }

      const price   = analysis.quote.price as number;
      const isShort = trade.entryDirection === "bearish";

      const newPeak = isShort
        ? Math.min(trade.peakPrice ?? trade.entryPrice, price)
        : Math.max(trade.peakPrice ?? trade.entryPrice, price);

      const entryAtrPct = trade.atrPctAtEntry ?? analysis.volatility.atrPercent;
      const entryAtr    = trade.entryPrice * entryAtrPct / 100;

      let newTrailingStop = trade.trailingStopPrice ?? trade.stopPrice ??
        (isShort
          ? trade.entryPrice * (1 + (config.stopLossPct || 4) / 100)
          : trade.entryPrice * (1 - (config.stopLossPct || 4) / 100));

      // Standard trailing stop (33% toward target)
      if (trade.targetPrice && trade.stopPrice) {
        const targetDist = isShort
          ? trade.entryPrice - trade.targetPrice
          : trade.targetPrice - trade.entryPrice;
        const threshold = isShort
          ? trade.entryPrice - targetDist * 0.33
          : trade.entryPrice + targetDist * 0.33;
        const activated = isShort ? price <= threshold : price >= threshold;
        if (activated) {
          const trailLevel = isShort ? newPeak + 1.5 * entryAtr : newPeak - 1.5 * entryAtr;
          newTrailingStop  = isShort
            ? Math.min(newTrailingStop, trailLevel, trade.entryPrice * 1.002)
            : Math.max(newTrailingStop, trailLevel, trade.entryPrice * 0.998);
        }
      }

      // T1/T2 milestone ratcheting
      let newT1Hit = trade.t1Hit ?? false;
      let newT2Hit = trade.t2Hit ?? false;
      const t1 = trade.t1Price;
      const t2 = trade.t2Price;

      if (t1 != null && !newT1Hit) {
        const t1Hit = isShort ? price <= t1 : price >= t1;
        if (t1Hit) {
          newT1Hit = true;
          newTrailingStop = isShort
            ? Math.min(newTrailingStop, trade.entryPrice)
            : Math.max(newTrailingStop, trade.entryPrice);
          logger.info({ ticker: trade.ticker, price, t1, entryPrice: trade.entryPrice }, "T1 hit — stop ratcheted to breakeven");
        }
      }
      if (t2 != null && !newT2Hit) {
        const t2Hit = isShort ? price <= t2 : price >= t2;
        if (t2Hit) {
          newT2Hit = true;
          if (t1 != null) {
            newTrailingStop = isShort ? Math.min(newTrailingStop, t1) : Math.max(newTrailingStop, t1);
          }
          logger.info({ ticker: trade.ticker, price, t2, t1 }, "T2 hit — stop ratcheted to T1");
        }
      }

      // ── Reversal warning check (5-min) — detect but do NOT auto-flip ──────────
      // Backtest shows Hold Jarvis outperforms flipping 10:1 on Sharpe (1.33 vs 0.17).
      // High-confidence reversals tighten stop to breakeven and flag for manual review.
      try {
        const rev = await detectReversal(trade, analysis);
        if (rev.shouldFlip && rev.confidence >= 60) {
          const protectiveStop = isShort
            ? Math.min(newTrailingStop, trade.entryPrice)
            : Math.max(newTrailingStop, trade.entryPrice);
          newTrailingStop = protectiveStop;

          const warningLog = {
            ...(typeof trade.decisionLog === "object" && trade.decisionLog !== null ? trade.decisionLog as object : {}),
            reversalWarning:    true,
            reversalConfidence: rev.confidence,
            reversalSignals:    rev.signals.map(s => s.name),
            reversalAt:         new Date().toISOString(),
          };
          await db.update(paperTradesTable)
            .set({ decisionLog: warningLog })
            .where(eq(paperTradesTable.id, trade.id));

          logger.warn(
            { ticker: trade.ticker, confidence: rev.confidence, signals: rev.signals.map(s => s.name), protectiveStop },
            `REVERSAL WARNING: ${trade.ticker} confidence=${rev.confidence}% — stop tightened to breakeven, manual flip available`,
          );
        }
      } catch (err) {
        logger.error({ err, ticker: trade.ticker }, "5-min reversal detection failed");
      }

      // Stop hit → close position immediately
      const stopHit = isShort ? price >= newTrailingStop : price <= newTrailingStop;
      if (stopHit) {
        const score = analysis.atlasScore.overall;
        await closePosition(trade, price, score, "trailing_stop");
        logger.info({ ticker: trade.ticker, price, stop: newTrailingStop }, "5-min checker: stop hit, closed position");
        continue;
      }

      const peakChanged      = newPeak !== (trade.peakPrice ?? 0);
      const trailChanged     = Math.abs(newTrailingStop - (trade.trailingStopPrice ?? 0)) > 0.001;
      const milestoneChanged = newT1Hit !== (trade.t1Hit ?? false) || newT2Hit !== (trade.t2Hit ?? false);
      if (peakChanged || trailChanged || milestoneChanged) {
        await db.update(paperTradesTable)
          .set({ peakPrice: newPeak, trailingStopPrice: newTrailingStop, t1Hit: newT1Hit, t2Hit: newT2Hit })
          .where(eq(paperTradesTable.id, trade.id));
      }
    }
  } finally {
    positionCheckRunning = false;
  }
}

export async function runBotCycle(): Promise<BotCycleResult> {
  if (cycleRunning) {
    return { skipped: true, reason: "cycle already running", exited: [], newEntries: [], openCount: 0, runAt: new Date().toISOString() };
  }

  const config = await getOrCreateConfig();
  if (!config.enabled) {
    return { skipped: true, reason: "bot is disabled", exited: [], newEntries: [], openCount: 0, runAt: new Date().toISOString() };
  }

  cycleRunning = true;
  lastRunAt    = new Date();
  const exited:     string[] = [];
  const newEntries: string[] = [];

  try {
    const job       = getOrStartScanJob();
    const analyses  = job.analyses;

    // ── Step 1: Check open positions for exit conditions ──────────────────────
    const openTrades = await db.select().from(paperTradesTable).where(eq(paperTradesTable.status, "open"));

    for (const trade of openTrades) {
      let analysis = analyses.find(a => (a.quote.ticker as string) === trade.ticker);
      if (!analysis) {
        try { analysis = await runFullAnalysis(trade.ticker); }
        catch { continue; }
      }

      const score     = analysis.atlasScore.overall;
      const direction = analysis.atlasScore.direction;
      const price     = analysis.quote.price as number;
      const holdDays  = Math.floor((Date.now() - new Date(trade.entryAt).getTime()) / 86400000);
      const isShort   = trade.entryDirection === "bearish";

      // P&L is inverted for shorts: profit when price falls
      const unrealizedPct = isShort
        ? ((trade.entryPrice - price) / trade.entryPrice) * 100
        : ((price - trade.entryPrice) / trade.entryPrice) * 100;

      // ── Update peak/nadir and trailing stop ─────────────────────────────────
      // Longs track the highest price seen (peak); shorts track the lowest (nadir)
      const newPeak = isShort
        ? Math.min(trade.peakPrice ?? trade.entryPrice, price)
        : Math.max(trade.peakPrice ?? trade.entryPrice, price);

      const entryAtrPct = trade.atrPctAtEntry ?? analysis.volatility.atrPercent;
      const entryAtr    = trade.entryPrice * entryAtrPct / 100;

      // Activate trailing stop once 33%+ of the way toward target
      let newTrailingStop = trade.trailingStopPrice ?? trade.stopPrice ??
        (isShort
          ? trade.entryPrice * (1 + (config.stopLossPct || 4) / 100)
          : trade.entryPrice * (1 - (config.stopLossPct || 4) / 100));

      if (trade.targetPrice && trade.stopPrice) {
        const targetDist = isShort
          ? trade.entryPrice - trade.targetPrice   // positive: target is below entry
          : trade.targetPrice - trade.entryPrice;  // positive: target is above entry
        const activationThreshold = isShort
          ? trade.entryPrice - targetDist * 0.33
          : trade.entryPrice + targetDist * 0.33;
        const activated = isShort ? price <= activationThreshold : price >= activationThreshold;
        if (activated) {
          const trailLevel = isShort
            ? newPeak + 1.5 * entryAtr   // trail above nadir for shorts
            : newPeak - 1.5 * entryAtr;  // trail below peak for longs
          newTrailingStop = isShort
            ? Math.min(newTrailingStop, trailLevel, trade.entryPrice * 1.002)
            : Math.max(newTrailingStop, trailLevel, trade.entryPrice * 0.998);
        }
      }

      // ── T1/T2 milestone ratcheting ───────────────────────────────────────────
      // T1 hit → ratchet stop to breakeven (entry price)
      // T2 hit → ratchet stop to T1 (lock in T1 profit)
      let newT1Hit = trade.t1Hit ?? false;
      let newT2Hit = trade.t2Hit ?? false;
      const t1 = trade.t1Price;
      const t2 = trade.t2Price;

      if (t1 != null && !newT1Hit) {
        const t1Hit = isShort ? price <= t1 : price >= t1;
        if (t1Hit) {
          newT1Hit = true;
          newTrailingStop = isShort
            ? Math.min(newTrailingStop, trade.entryPrice)
            : Math.max(newTrailingStop, trade.entryPrice);
          logger.info({ ticker: trade.ticker, price, t1, entryPrice: trade.entryPrice }, "T1 hit — stop ratcheted to breakeven");
        }
      }
      if (t2 != null && !newT2Hit) {
        const t2Hit = isShort ? price <= t2 : price >= t2;
        if (t2Hit) {
          newT2Hit = true;
          if (t1 != null) {
            newTrailingStop = isShort
              ? Math.min(newTrailingStop, t1)
              : Math.max(newTrailingStop, t1);
          }
          logger.info({ ticker: trade.ticker, price, t2, t1, }, "T2 hit — stop ratcheted to T1");
        }
      }

      const peakChanged     = newPeak !== (trade.peakPrice ?? 0);
      const trailChanged    = Math.abs(newTrailingStop - (trade.trailingStopPrice ?? 0)) > 0.001;
      const milestoneChanged = newT1Hit !== (trade.t1Hit ?? false) || newT2Hit !== (trade.t2Hit ?? false);

      if (peakChanged || trailChanged || milestoneChanged) {
        await db.update(paperTradesTable)
          .set({
            peakPrice:         newPeak,
            trailingStopPrice: newTrailingStop,
            t1Hit:             newT1Hit,
            t2Hit:             newT2Hit,
          })
          .where(eq(paperTradesTable.id, trade.id));
      }

      // ── Reversal warning (main cycle) — detect but do NOT auto-flip ────────────
      // Backtest shows Hold Jarvis outperforms flipping 10:1 on Sharpe (1.33 vs 0.17).
      // High-confidence reversals tighten stop to breakeven and flag for manual review.
      try {
        const rev = await detectReversal(trade, analysis);
        if (rev.shouldFlip && rev.confidence >= 60) {
          const protectiveStop = isShort
            ? Math.min(newTrailingStop, trade.entryPrice)
            : Math.max(newTrailingStop, trade.entryPrice);
          newTrailingStop = protectiveStop;

          const warningLog = {
            ...(typeof trade.decisionLog === "object" && trade.decisionLog !== null ? trade.decisionLog as object : {}),
            reversalWarning:    true,
            reversalConfidence: rev.confidence,
            reversalSignals:    rev.signals.map(s => s.name),
            reversalAt:         new Date().toISOString(),
          };
          await db.update(paperTradesTable)
            .set({ trailingStopPrice: protectiveStop, decisionLog: warningLog })
            .where(eq(paperTradesTable.id, trade.id));

          logger.warn(
            { ticker: trade.ticker, confidence: rev.confidence, signals: rev.signals.map(s => s.name) },
            `REVERSAL WARNING: ${trade.ticker} confidence=${rev.confidence}% — stop at breakeven, manual flip available`,
          );
        }
      } catch (err) {
        logger.error({ err, ticker: trade.ticker }, "Reversal detection failed");
      }

      // ── Exit decision ────────────────────────────────────────────────────────
      let exitReason: string | null = null;

      // 1. Trailing stop hit (once trailing is active)
      if (trade.stopPrice && trade.targetPrice) {
        const targetDist = isShort
          ? trade.entryPrice - trade.targetPrice
          : trade.targetPrice - trade.entryPrice;
        const trailingActive = isShort
          ? newPeak <= trade.entryPrice - targetDist * 0.33
          : newPeak >= trade.entryPrice + targetDist * 0.33;
        const trailingHit = isShort ? price >= newTrailingStop : price <= newTrailingStop;
        if (trailingActive && trailingHit) exitReason = "trailing_stop";
      }

      // 2. Initial ATR stop hit (before trailing is active)
      if (!exitReason && trade.stopPrice) {
        const stopHit = isShort ? price >= trade.stopPrice : price <= trade.stopPrice;
        if (stopHit) exitReason = "stop_loss";
      }

      // 3. Fallback: fixed % stop for legacy trades without stopPrice
      if (!exitReason && !trade.stopPrice && config.stopLossPct > 0 && unrealizedPct <= -config.stopLossPct) {
        exitReason = "stop_loss";
      }

      // 4. Distribution signal on long → only exit if the signal is NEW since entry.
      // Patterns already present at entry time are not a new risk event; they were
      // knowingly accepted. Only a pattern that appears after entry warrants an exit.
      if (!exitReason && !isShort) {
        const tradedEntryPatterns = (trade.entryPatterns ?? []) as string[];
        const currentDistroPatterns = ((analysis.patterns?.patterns ?? []) as string[])
          .filter((p: string) => DISTRIBUTION_PATTERNS.some(d => p.toLowerCase().includes(d)));
        const hasNewDistroPattern = currentDistroPatterns.some((p: string) => !tradedEntryPatterns.includes(p));
        // distributionTop is a computed exhaustion flag — treat it as new only if no
        // distribution pattern was present at all when the position was opened.
        const hadAnyDistroAtEntry = tradedEntryPatterns.some((p: string) =>
          DISTRIBUTION_PATTERNS.some(d => p.toLowerCase().includes(d)));
        const hasNewDistroTop = analysis.exhaustion.distributionTop && !hadAnyDistroAtEntry;
        if (hasNewDistroPattern || hasNewDistroTop) exitReason = "distribution_signal";
      }

      // 5. Target reached → let winner run if continuation signal present
      if (!exitReason && trade.targetPrice) {
        const targetHit = isShort ? price <= trade.targetPrice : price >= trade.targetPrice;
        if (targetHit) {
          if (hasContinuationSignal(analysis)) {
            const tightTrail = isShort ? newPeak + 1.0 * entryAtr : newPeak - 1.0 * entryAtr;
            const isTighter  = isShort ? tightTrail < newTrailingStop : tightTrail > newTrailingStop;
            if (isTighter) {
              await db.update(paperTradesTable)
                .set({ trailingStopPrice: tightTrail })
                .where(eq(paperTradesTable.id, trade.id));
            }
          } else {
            exitReason = "take_profit";
          }
        }
      }

      // 6. Fallback: fixed % take profit for legacy trades
      if (!exitReason && !trade.targetPrice && config.takeProfitPct > 0 && unrealizedPct >= config.takeProfitPct) {
        exitReason = "take_profit";
      }

      // 7. Score / direction exits
      if (!exitReason && score < config.exitScoreThreshold) {
        exitReason = "score_drop";
      }
      // Direction flip: longs exit when direction turns bearish, shorts when bullish
      if (!exitReason && config.exitOnDirectionFlip) {
        if (!isShort && direction === "bearish") exitReason = "direction_flip";
        if (isShort  && direction === "bullish") exitReason = "direction_flip";
      }

      // 8. Time exit — ONLY for losing or flat positions; winners keep running
      if (!exitReason && holdDays >= config.maxHoldDays && unrealizedPct < 1.0) {
        exitReason = "max_hold";
      }

      if (exitReason) {
        await closePosition(trade, price, score, exitReason);
        exited.push(trade.ticker);
      }
    }

    // ── Step 2: Find new entries ──────────────────────────────────────────────
    const remainingOpen  = openTrades.filter(t => !exited.includes(t.ticker));
    const slotsAvailable = config.maxPositions - remainingOpen.length;

    if (slotsAvailable > 0) {
      // ── Intelligence layer: market context gate (once per cycle) ────────────
      const marketCtx: MarketContext = getMarketContext();
      if (!marketCtx.allowNewEntries) {
        logger.info({ reason: marketCtx.reason }, "Bot intelligence: market gate blocking all new entries this cycle");
      } else {
        const criteria = (config.entryCriteria ?? []) as CustomCriterion[];
        const heldSet  = new Set(remainingOpen.map(t => t.ticker));

        const whitelist = config.tickerWhitelist
          ? config.tickerWhitelist.split(",").map(t => t.trim().toUpperCase()).filter(Boolean)
          : [];

        let pool = analyses
          .filter(a => !heldSet.has(a.quote.ticker as string))
          .filter(a => whitelist.length === 0 || whitelist.includes((a.quote.ticker as string).toUpperCase()));

        if (whitelist.length > 0) {
          const cachedTickers = new Set(pool.map(a => (a.quote.ticker as string).toUpperCase()));
          const missing = whitelist.filter(t => !cachedTickers.has(t) && !heldSet.has(t));
          if (missing.length > 0) {
            const freshResults = await Promise.allSettled(missing.map(t => runFullAnalysis(t)));
            for (const r of freshResults) {
              if (r.status === "fulfilled") pool.push(r.value);
            }
          }
        }

        let candidates = pool.filter(a => criteria.length === 0 || criteria.every(c => applyCustomCriterion(a, c)));

        // Apply market-context minimum score override (weak breadth → raise bar)
        if (marketCtx.minScoreOverride !== null) {
          const before = candidates.length;
          candidates = candidates.filter(a => a.atlasScore.overall >= marketCtx.minScoreOverride!);
          if (candidates.length < before) {
            logger.info(
              { filtered: before - candidates.length, minScore: marketCtx.minScoreOverride },
              "Bot intelligence: breadth filter raised minimum score",
            );
          }
        }

        candidates.sort((a, b) => b.atlasScore.overall - a.atlasScore.overall);

        let filled = 0;
        for (const a of candidates) {
          if (filled >= slotsAvailable) break;

          // Require candle confirmation + support-level check before entering
          const levels = computeEntryLevels(a);
          if (!levels) {
            logger.info({ ticker: a.quote.ticker }, "Bot: no candle/support confirmation — waiting for better setup");
            continue;
          }

          // ── Per-ticker intelligence gates (sim + calibration + scanner categories) ──
          const verdict = await getIntelligenceVerdict(a, marketCtx);
          if (!verdict.overallAllow) {
            logger.info(
              { ticker: a.quote.ticker, blockedBy: verdict.blockedBy,
                simReason: verdict.simGate.reason, calibReason: verdict.calibGate.reason },
              "Bot intelligence: entry blocked",
            );
            continue;
          }

          let aiNotes: string | null = null;
          if (config.aiGateEnabled) {
            const gate = smartEntryGate(a);
            if (!gate.enter) {
              logger.info({ ticker: a.quote.ticker, reasoning: gate.reasoning }, "Smart gate blocked entry");
              continue;
            }
            aiNotes = gate.reasoning;
          }

          // Apply scanner-category-based stop widening and position sizing
          const { categories, positionMultiplier, stopMultiplier } = verdict.scannerInfo;
          const rrMult        = getRRMultiplier(categories);
          const isShortEntry  = a.atlasScore.direction === "bearish";

          // Skip longs where a distribution signal is already present — they would
          // immediately trigger the distribution_signal exit on the next cycle.
          if (!isShortEntry && hasDistributionSignal(a)) {
            logger.info({ ticker: a.quote.ticker }, "Bot: distribution signal at entry — skipping long");
            continue;
          }

          // ── Feature-group alignment gate ──────────────────────────────────────
          // When sub-scores diverge significantly, the overall composite score
          // overstates conviction (e.g. trend=85 / momentum=18 inflates the mean).
          // Block entries with high divergence; require a stronger score when
          // divergence is moderate. Uses the pre-computed alignmentScore (0–100).
          const alignment = a.atlasScore.alignmentScore;
          if (alignment < 40) {
            logger.info({ ticker: a.quote.ticker, alignment }, "Bot: sub-score divergence too high — skipping");
            continue;
          }
          if (alignment < 55 && a.atlasScore.overall < 75) {
            logger.info({ ticker: a.quote.ticker, alignment, score: a.atlasScore.overall },
              "Bot: moderate divergence — requires score ≥75 to enter");
            continue;
          }

          // ── Regime strategy-routing gate ──────────────────────────────────────
          // Block setup categories inappropriate for the current market structure.
          // CHOP (ADX < 20): breakout/gap setups fail in ranging markets.
          // HIGH_VOL (VIX > 22): speculative plays are too dangerous.
          if (marketCtx.blockedCategories.length > 0 && categories.length > 0) {
            const hasAllowedCategory = categories.some(c => !marketCtx.blockedCategories.includes(c));
            if (!hasAllowedCategory) {
              logger.info(
                { ticker: a.quote.ticker, categories, blocked: marketCtx.blockedCategories, botRegime: marketCtx.botRegime },
                "Bot: all setup categories blocked by regime — skipping",
              );
              continue;
            }
          }

          // ── Build decision log — persisted with the trade for explainability ──
          const dLog: Record<string, unknown> = {
            regime:        marketCtx.regime,
            botRegime:     marketCtx.botRegime,
            regimeReason:  marketCtx.reason,
            adx:           marketCtx.adx,
            vix:           marketCtx.vix,
            breadth:       marketCtx.breadthPct50,
            subScores: {
              trend:    a.atlasScore.trendScore,
              momentum: a.atlasScore.momentumScore,
              volume:   a.atlasScore.volumeScore,
              rs:       a.atlasScore.relativeStrengthScore,
              regime:   a.atlasScore.marketRegimeScore,
              options:  a.atlasScore.optionsScore,
            },
            alignmentScore:  alignment,
            confidenceScore: a.atlasScore.confidenceScore,
            calibProb:       verdict.calibGate.probPositive,
            calibSignalMode: verdict.calibGate.signalMode,
            calibRankIC:     verdict.calibGate.rankIC,
            simHitRate:      verdict.simGate.hitRate5d,
            simN:            verdict.simGate.n,
            gateResults: {
              marketRegime: marketCtx.reason,
              simGate:      verdict.simGate.reason,
              calibGate:    verdict.calibGate.reason,
            },
            entryTrigger: levels.trigger,
            categories,
            topFactors: (Object.entries({
              trend:    a.atlasScore.trendScore,
              momentum: a.atlasScore.momentumScore,
              volume:   a.atlasScore.volumeScore,
              rs:       a.atlasScore.relativeStrengthScore,
              regime:   a.atlasScore.marketRegimeScore,
            }) as [string, number][])
              .sort(([, va], [, vb]) => vb - va)
              .slice(0, 3)
              .map(([k, v]) => `${k}:${v}`),
          };

          if (stopMultiplier !== 1.0 && levels.stopPrice) {
            const quotePrice = a.quote.price as number;
            // riskDist is always positive: distance from entry to stop
            const riskDist    = isShortEntry ? levels.stopPrice - quotePrice : quotePrice - levels.stopPrice;
            const newRiskDist = riskDist * stopMultiplier;
            levels.stopPrice   = isShortEntry ? quotePrice + newRiskDist : quotePrice - newRiskDist;
            if (levels.targetPrice) {
              levels.targetPrice = isShortEntry ? quotePrice - newRiskDist * rrMult : quotePrice + newRiskDist * rrMult;
            }
          } else if (rrMult !== 3.0 && levels.stopPrice && levels.targetPrice) {
            const quotePrice = a.quote.price as number;
            const riskDist   = isShortEntry ? levels.stopPrice - quotePrice : quotePrice - levels.stopPrice;
            levels.targetPrice = isShortEntry ? quotePrice - riskDist * rrMult : quotePrice + riskDist * rrMult;
          }

          await openPosition(a, config, levels, aiNotes, categories, positionMultiplier, dLog);
          newEntries.push(a.quote.ticker as string);
          filled++;
        }

        // ── Reversal short pass ──────────────────────────────────────────────────
        // Enters shorts based on technical reversal signals (double top, distribution
        // top, H&S, parabolic rise) BEFORE the overall direction flips bearish.
        // Optimal entry: at the second peak / resistance level with a tight stop
        // above it — NOT waiting for the breakdown (which is the trend-following path).
        const reversalPool = pool.filter(a =>
          !heldSet.has(a.quote.ticker as string) && !newEntries.includes(a.quote.ticker as string)
        );
        for (const ra of reversalPool) {
          if (filled >= slotsAvailable) break;

          const revSignal = calcReversalScore(ra);
          if (revSignal.score < 60) continue;

          // Don't fight a clean strong uptrend — require higher conviction
          if (ra.atlasScore.overall > 80 && ra.atlasScore.trendScore > 75 && revSignal.score < 76) continue;

          // Alignment gate still applies
          if ((ra.atlasScore.alignmentScore ?? 100) < 40) continue;

          const revLevels = computeReversalShortLevels(ra, revSignal);
          if (!revLevels) continue;

          const dRevLog: Record<string, unknown> = {
            regime:           marketCtx.regime,
            botRegime:        marketCtx.botRegime,
            adx:              marketCtx.adx,
            vix:              marketCtx.vix,
            subScores: {
              trend:    ra.atlasScore.trendScore,
              momentum: ra.atlasScore.momentumScore,
              volume:   ra.atlasScore.volumeScore,
              rs:       ra.atlasScore.relativeStrengthScore,
              regime:   ra.atlasScore.marketRegimeScore,
              options:  ra.atlasScore.optionsScore,
            },
            alignmentScore:    ra.atlasScore.alignmentScore,
            reversalScore:     revSignal.score,
            reversalTriggers:  revSignal.triggers,
            reversalUrgency:   revSignal.urgency,
            resistanceLevel:   revSignal.resistanceLevel,
            entryTrigger:      revLevels.trigger,
            categories:        ["reversal_short"],
          };

          await openPosition(ra, config, revLevels, null, ["reversal_short"], 1.0, dRevLog);
          newEntries.push(ra.quote.ticker as string);
          filled++;
          logger.info(
            { ticker: ra.quote.ticker, reversalScore: revSignal.score,
              triggers: revSignal.triggers, stop: revLevels.stopPrice.toFixed(2),
              urgency: revSignal.urgency },
            "Bot: reversal short entry",
          );
        }
      }
    }

  } finally {
    cycleRunning = false;
  }

  // After each cycle if there are new closed trades, check AI trigger
  const closedCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(paperTradesTable)
    .where(and(eq(paperTradesTable.status, "closed"), sql`ai_notes IS NULL`));

  if ((closedCount[0]?.count ?? 0) >= 3) {
    generateAiAnalysis().catch(err =>
      logger.error({ err }, "Background AI analysis failed")
    );
  }

  return {
    exited,
    newEntries,
    openCount:   (await db.select({ count: sql<number>`count(*)::int` }).from(paperTradesTable).where(eq(paperTradesTable.status, "open")))[0]?.count ?? 0,
    runAt:       lastRunAt!.toISOString(),
  };
}

// ── Enrich trades with live prices ────────────────────────────────────────────

export async function getEnrichedTrades(status: "open" | "closed" | "all" = "all"): Promise<EnrichedTrade[]> {
  let rows: PaperTrade[];
  if (status === "open") {
    rows = await db.select().from(paperTradesTable).where(eq(paperTradesTable.status, "open")).orderBy(desc(paperTradesTable.entryAt));
  } else if (status === "closed") {
    rows = await db.select().from(paperTradesTable).where(eq(paperTradesTable.status, "closed")).orderBy(desc(paperTradesTable.exitAt));
  } else {
    rows = await db.select().from(paperTradesTable).orderBy(desc(paperTradesTable.createdAt));
  }

  const job = getOrStartScanJob();

  return rows.map(trade => {
    const holdDays = Math.floor((Date.now() - new Date(trade.entryAt).getTime()) / 86400000);

    if (trade.status !== "open") return { ...trade, holdDays };

    // Prefer the full-mode cache (has marketCycle) over the lightMode scan-job result
    const fullCached   = analysisCache.get<AnalysisResult>(`analysis:${trade.ticker}`);
    const scanAnalysis = job.analyses.find(a => (a.quote.ticker as string) === trade.ticker);
    const analysis     = fullCached ?? scanAnalysis;
    if (!analysis) return { ...trade, holdDays };

    const currentPrice        = analysis.quote.price as number;
    const currentScore        = analysis.atlasScore.overall;
    const tradeIsShort        = trade.entryDirection === "bearish";
    const unrealizedPnlPct    = tradeIsShort
      ? ((trade.entryPrice - currentPrice) / trade.entryPrice) * 100
      : ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100;
    const unrealizedPnlDollar = tradeIsShort
      ? (trade.shares ?? 0) * (trade.entryPrice - currentPrice)
      : (trade.shares ?? 0) * (currentPrice - trade.entryPrice);
    const currentCyclePhase     = analysis.marketCycle?.cyclePhase;
    const currentWeeklyPatterns = analysis.marketCycle?.weeklyPatterns;

    // Reversal risk: flag open LONG positions where technical signals suggest
    // a developing top — gives the user early warning before direction flips.
    let reversalRisk: ReversalRisk | null = null;
    if (!tradeIsShort) {
      const rev = calcReversalScore(analysis);
      if (rev.score >= 45) {
        reversalRisk = { score: rev.score, triggers: rev.triggers, urgency: rev.urgency };
      }
    }

    return { ...trade, currentPrice, currentScore, unrealizedPnlPct, unrealizedPnlDollar, holdDays, currentCyclePhase, currentWeeklyPatterns, reversalRisk };
  });
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export async function getBotStats(): Promise<BotStats> {
  const config = await getOrCreateConfig();
  const [open, closed] = await Promise.all([
    db.select().from(paperTradesTable).where(eq(paperTradesTable.status, "open")),
    db.select().from(paperTradesTable).where(eq(paperTradesTable.status, "closed")),
  ]);

  const winners = closed.filter(t => (t.pnlPercent ?? 0) > 0);
  const pnls    = closed.map(t => t.pnlPercent ?? 0);
  const holds   = closed.map(t => {
    if (!t.exitAt) return 0;
    return Math.floor((new Date(t.exitAt).getTime() - new Date(t.entryAt).getTime()) / 86400000);
  });

  const byExitReason: Record<string, { count: number; avgPnl: number }> = {};
  for (const t of closed) {
    const r = t.exitReason ?? "unknown";
    if (!byExitReason[r]) byExitReason[r] = { count: 0, avgPnl: 0 };
    byExitReason[r].count++;
    byExitReason[r].avgPnl += (t.pnlPercent ?? 0);
  }
  for (const k of Object.keys(byExitReason)) {
    byExitReason[k].avgPnl /= byExitReason[k].count;
  }

  // Estimate current portfolio value
  const job = getOrStartScanJob();
  let unrealizedPnl = 0;
  for (const t of open) {
    const analysis = job.analyses.find(a => (a.quote.ticker as string) === t.ticker);
    if (analysis) {
      const cp = analysis.quote.price as number;
      const sh = t.shares ?? 0;
      unrealizedPnl += t.entryDirection === "bearish"
        ? sh * (t.entryPrice - cp)
        : sh * (cp - t.entryPrice);
    }
  }
  const realizedPnl = closed.reduce((s, t) => s + (t.pnlDollar ?? 0), 0);
  const virtualPortfolioValue = config.virtualPortfolio + realizedPnl + unrealizedPnl;

  return {
    totalTrades:          open.length + closed.length,
    openTrades:           open.length,
    closedTrades:         closed.length,
    winRate:              closed.length > 0 ? (winners.length / closed.length) * 100 : 0,
    avgPnlPct:            pnls.length > 0 ? pnls.reduce((a, b) => a + b, 0) / pnls.length : 0,
    totalPnlPct:          pnls.reduce((a, b) => a + b, 0),
    bestTrade:            pnls.length > 0 ? Math.max(...pnls) : 0,
    worstTrade:           pnls.length > 0 ? Math.min(...pnls) : 0,
    avgHoldDays:          holds.length > 0 ? holds.reduce((a, b) => a + b, 0) / holds.length : 0,
    byExitReason,
    virtualPortfolioValue,
  };
}

// ── AI Analysis ───────────────────────────────────────────────────────────────

export async function generateAiAnalysis(): Promise<string> {
  const closed = await db
    .select()
    .from(paperTradesTable)
    .where(eq(paperTradesTable.status, "closed"))
    .orderBy(desc(paperTradesTable.exitAt))
    .limit(30);

  const config = await getOrCreateConfig();

  if (closed.length === 0) {
    return "No closed trades yet. Run the bot through a few cycles to generate analysis.";
  }

  const tradeRows = closed.map(t => ({
    ticker:        t.ticker,
    entryScore:    t.entryScore,
    exitScore:     t.exitScore,
    entryRsi:      t.entryRsi?.toFixed(1),
    entryRvol:     t.entryRvol?.toFixed(2),
    entryDir:      t.entryDirection,
    exitReason:    t.exitReason,
    pnlPct:        t.pnlPercent?.toFixed(2) + "%",
    holdDays:      t.exitAt ? Math.floor((new Date(t.exitAt).getTime() - new Date(t.entryAt).getTime()) / 86400000) : 0,
  }));

  const stats = await getBotStats();

  const prompt = `You are analyzing a paper trading bot's performance on the Atlas Alpha quant platform.

BOT CONFIG:
- Entry criteria: ${JSON.stringify(config.entryCriteria)}
- Exit score threshold: ${config.exitScoreThreshold}
- Exit on direction flip: ${config.exitOnDirectionFlip}
- Max hold days: ${config.maxHoldDays}
- Max positions: ${config.maxPositions}

PERFORMANCE SUMMARY:
- Win rate: ${stats.winRate.toFixed(1)}%
- Average P&L: ${stats.avgPnlPct.toFixed(2)}%
- Total closed trades: ${stats.closedTrades}
- Avg hold days: ${stats.avgHoldDays.toFixed(1)}
- By exit reason: ${JSON.stringify(stats.byExitReason)}

RECENT TRADES (newest first):
${tradeRows.map(t => `${t.ticker}: entry score ${t.entryScore} → exit score ${t.exitScore}, RSI ${t.entryRsi}, RVOL ${t.entryRvol}, dir ${t.entryDir}, exit via ${t.exitReason}, P&L ${t.pnlPct}, held ${t.holdDays}d`).join("\n")}

Provide a concise, institutional-quality analysis covering:
1. What entry conditions are producing the best outcomes (patterns in winning vs losing trades)
2. Whether the exit thresholds are triggering too early or too late
3. Which exit reason (score_drop vs direction_flip vs max_hold) is most reliable
4. 2-3 specific, actionable recommendations to improve the bot's parameters
5. A confidence assessment of the current strategy

Be direct and data-driven. No hedging. Format with clear sections.`;

  const client = new Anthropic({
    apiKey:  process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
    baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
  });

  const message = await client.messages.create({
    model:      "claude-sonnet-4-6",
    max_tokens: 1024,
    messages:   [{ role: "user", content: prompt }],
  });

  const analysis = message.content
    .filter(b => b.type === "text")
    .map(b => (b as { type: "text"; text: string }).text)
    .join("\n");

  // Stamp latest closed trades with the analysis reference
  const ids = closed.slice(0, 10).map(t => t.id);
  for (const id of ids) {
    await db
      .update(paperTradesTable)
      .set({ aiNotes: "Analyzed — see AI Brain tab" })
      .where(and(eq(paperTradesTable.id, id), sql`ai_notes IS NULL`));
  }

  logger.info({ closedTrades: closed.length }, "AI analysis generated");
  return analysis;
}

// ── Signal Performance Learning ───────────────────────────────────────────────

function tradeGroupStats(trades: PaperTrade[], label: string): SignalGroup {
  const withPnl = trades.filter(t => t.pnlPercent !== null);
  const pnls    = withPnl.map(t => t.pnlPercent!);
  const winners = pnls.filter(p => p > 0);
  return {
    label,
    trades:   withPnl.length,
    winRate:  withPnl.length > 0 ? (winners.length / withPnl.length) * 100 : 0,
    avgPnl:   pnls.length > 0 ? pnls.reduce((a, b) => a + b, 0) / pnls.length : 0,
    bestPnl:  pnls.length > 0 ? Math.max(...pnls) : 0,
    worstPnl: pnls.length > 0 ? Math.min(...pnls) : 0,
  };
}

export async function computeSignalPerformance(): Promise<SignalPerformance> {
  const closed = await db.select().from(paperTradesTable).where(eq(paperTradesTable.status, "closed"));

  if (closed.length === 0) {
    return { byScoreBucket: [], byRsiRange: [], byRvol: [], byPattern: [], totalClosed: 0, bestSignal: "", worstSignal: "" };
  }

  // ── Score buckets ────────────────────────────────────────────────────────
  const scoreBuckets = new Map<string, PaperTrade[]>();
  for (const t of closed) {
    const s = t.entryScore;
    const b = s >= 90 ? "Score 90+" : s >= 80 ? "Score 80-90" : s >= 70 ? "Score 70-80" : s >= 60 ? "Score 60-70" : "Score < 60";
    if (!scoreBuckets.has(b)) scoreBuckets.set(b, []);
    scoreBuckets.get(b)!.push(t);
  }
  const byScoreBucket = ["Score < 60", "Score 60-70", "Score 70-80", "Score 80-90", "Score 90+"]
    .filter(b => scoreBuckets.has(b))
    .map(b => tradeGroupStats(scoreBuckets.get(b)!, b));

  // ── RSI ranges ───────────────────────────────────────────────────────────
  const rsiBuckets = new Map<string, PaperTrade[]>();
  for (const t of closed) {
    const r = t.entryRsi ?? 50;
    const b = r >= 70 ? "RSI ≥70" : r >= 60 ? "RSI 60-70" : r >= 50 ? "RSI 50-60" : r >= 40 ? "RSI 40-50" : "RSI <40";
    if (!rsiBuckets.has(b)) rsiBuckets.set(b, []);
    rsiBuckets.get(b)!.push(t);
  }
  const byRsiRange = ["RSI <40", "RSI 40-50", "RSI 50-60", "RSI 60-70", "RSI ≥70"]
    .filter(b => rsiBuckets.has(b))
    .map(b => tradeGroupStats(rsiBuckets.get(b)!, b));

  // ── RVOL ranges ──────────────────────────────────────────────────────────
  const rvolBuckets = new Map<string, PaperTrade[]>();
  for (const t of closed) {
    const r = t.entryRvol ?? 1;
    const b = r >= 2 ? "RVOL ≥2×" : r >= 1.5 ? "RVOL 1.5-2×" : r >= 1 ? "RVOL 1-1.5×" : "RVOL <1×";
    if (!rvolBuckets.has(b)) rvolBuckets.set(b, []);
    rvolBuckets.get(b)!.push(t);
  }
  const byRvol = ["RVOL <1×", "RVOL 1-1.5×", "RVOL 1.5-2×", "RVOL ≥2×"]
    .filter(b => rvolBuckets.has(b))
    .map(b => tradeGroupStats(rvolBuckets.get(b)!, b));

  // ── Pattern performance (accumulated from new trades) ────────────────────
  const patternBuckets = new Map<string, PaperTrade[]>();
  for (const t of closed) {
    const patterns = (t.entryPatterns ?? []) as string[];
    if (patterns.length === 0) {
      const k = "No Pattern";
      if (!patternBuckets.has(k)) patternBuckets.set(k, []);
      patternBuckets.get(k)!.push(t);
    } else {
      for (const p of patterns) {
        if (!patternBuckets.has(p)) patternBuckets.set(p, []);
        patternBuckets.get(p)!.push(t);
      }
    }
  }
  const byPattern = Array.from(patternBuckets.entries())
    .map(([p, trades]) => tradeGroupStats(trades, p))
    .filter(g => g.trades >= 2)
    .sort((a, b) => b.avgPnl - a.avgPnl);

  // ── Best / worst signal (by avg P&L, min 2 trades) ──────────────────────
  const allGroups = [...byScoreBucket, ...byRsiRange, ...byRvol].filter(g => g.trades >= 2);
  const sorted    = [...allGroups].sort((a, b) => b.avgPnl - a.avgPnl);
  const bestSignal  = sorted[0]?.label ?? "";
  const worstSignal = sorted[sorted.length - 1]?.label ?? "";

  return { byScoreBucket, byRsiRange, byRvol, byPattern, totalClosed: closed.length, bestSignal, worstSignal };
}

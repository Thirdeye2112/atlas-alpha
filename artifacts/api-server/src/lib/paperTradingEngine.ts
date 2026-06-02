import { db, paperTradesTable, botConfigTable, type PaperTrade, type BotConfig } from "@workspace/db";
import { eq, desc, and, sql } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";
import { getOrStartScanJob } from "./scanJob.js";
import { runFullAnalysis, type AnalysisResult } from "./analysisEngine.js";
import { analysisCache } from "./cache.js";
import { logger } from "./logger.js";

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

export interface EnrichedTrade extends PaperTrade {
  currentPrice?: number;
  currentScore?: number;
  unrealizedPnlPct?: number;
  unrealizedPnlDollar?: number;
  holdDays?: number;
  currentCyclePhase?: string;
  currentWeeklyPatterns?: string[];
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
    case "patterns":            return (a.patterns?.patterns ?? []) as string[];
    case "cyclePhase":          return a.marketCycle?.cyclePhase ?? "ranging";
    case "weeklyPatterns":      return (a.marketCycle?.weeklyPatterns ?? []) as string[];
    case "distFrom52wHigh":     return a.marketCycle?.distFrom52wHigh ?? 0;
    case "sma40Rising":         return a.marketCycle?.sma40Rising ? "yes" : "no";
    case "weeklyRsi":           return a.marketCycle?.weeklyRsi ?? a.momentum.rsi;
    case "priceVsSma40Weekly":  return a.marketCycle?.priceVsSma40Weekly ?? 0;
    case "pattern":             return (a.patterns?.patterns ?? []) as string[];
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

async function openPosition(a: AnalysisResult, config: BotConfig): Promise<void> {
  const price      = a.quote.price as number;
  const posValue   = (config.virtualPortfolio * config.positionSizePct) / 100;
  const shares     = posValue / price;
  const ticker     = a.quote.ticker as string;

  await db.insert(paperTradesTable).values({
    ticker,
    name:               (a.quote.name as string) || ticker,
    entryPrice:         price,
    entryScore:         a.atlasScore.overall,
    entryDirection:     a.atlasScore.direction,
    entryBullishProb:   a.atlasScore.bullishProbability,
    entryRsi:           a.momentum.rsi,
    entryRvol:          a.volume.relativeVolume,
    entryMomentumScore: a.atlasScore.momentumScore,
    entryTrendScore:    a.atlasScore.trendScore,
    entryCriteria:      config.entryCriteria as unknown as Record<string, unknown>,
    entryPatterns:      (a.patterns?.patterns ?? []) as unknown as Record<string, unknown>,
    positionValue:      posValue,
    shares,
    status:             "open",
  });

  logger.info({ ticker, price, score: a.atlasScore.overall }, "Bot opened position");
}

async function closePosition(
  trade: PaperTrade,
  exitPrice: number,
  exitScore: number,
  exitReason: string,
): Promise<void> {
  const pnlPercent = ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100;
  const pnlDollar  = (trade.shares ?? 0) * (exitPrice - trade.entryPrice);

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
}

// ── Main cycle ────────────────────────────────────────────────────────────────

let lastRunAt: Date | null = null;
let cycleRunning = false;

export function getBotRunState() {
  return { lastRunAt, cycleRunning };
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

      // Fallback: re-run if not in cache
      if (!analysis) {
        try { analysis = await runFullAnalysis(trade.ticker); }
        catch { continue; }
      }

      const score          = analysis.atlasScore.overall;
      const direction      = analysis.atlasScore.direction;
      const price          = analysis.quote.price as number;
      const holdDays       = Math.floor((Date.now() - new Date(trade.entryAt).getTime()) / 86400000);
      const unrealizedPct  = ((price - trade.entryPrice) / trade.entryPrice) * 100;

      let exitReason: string | null = null;
      // Price-based exits take priority over score-based exits
      if (config.takeProfitPct > 0 && unrealizedPct >= config.takeProfitPct) {
        exitReason = "take_profit";
      } else if (config.stopLossPct > 0 && unrealizedPct <= -config.stopLossPct) {
        exitReason = "stop_loss";
      } else if (score < config.exitScoreThreshold) {
        exitReason = "score_drop";
      } else if (config.exitOnDirectionFlip && trade.entryDirection === "bullish" && direction !== "bullish") {
        exitReason = "direction_flip";
      } else if (holdDays >= config.maxHoldDays) {
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
      const criteria  = (config.entryCriteria ?? []) as CustomCriterion[];
      const heldSet   = new Set(remainingOpen.map(t => t.ticker));

      const whitelist = config.tickerWhitelist
        ? config.tickerWhitelist.split(",").map(t => t.trim().toUpperCase()).filter(Boolean)
        : [];

      // Build candidate pool: scan-job analyses (filtered by whitelist if set)
      let pool = analyses
        .filter(a => !heldSet.has(a.quote.ticker as string))
        .filter(a => whitelist.length === 0 || whitelist.includes((a.quote.ticker as string).toUpperCase()));

      // For whitelisted tickers NOT yet in the scan job cache, run fresh analysis
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

      const candidates = pool.filter(a => criteria.length === 0 || criteria.every(c => applyCustomCriterion(a, c)));
      candidates.sort((a, b) => b.atlasScore.overall - a.atlasScore.overall);

      for (const a of candidates.slice(0, slotsAvailable)) {
        await openPosition(a, config);
        newEntries.push(a.quote.ticker as string);
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
    const unrealizedPnlPct    = ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100;
    const unrealizedPnlDollar = (trade.shares ?? 0) * (currentPrice - trade.entryPrice);
    const currentCyclePhase     = analysis.marketCycle?.cyclePhase;
    const currentWeeklyPatterns = analysis.marketCycle?.weeklyPatterns;

    return { ...trade, currentPrice, currentScore, unrealizedPnlPct, unrealizedPnlDollar, holdDays, currentCyclePhase, currentWeeklyPatterns };
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
      unrealizedPnl += (t.shares ?? 0) * ((analysis.quote.price as number) - t.entryPrice);
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

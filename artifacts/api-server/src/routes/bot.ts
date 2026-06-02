import { Router } from "express";
import { db, paperTradesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  getOrCreateConfig,
  updateConfig,
  runBotCycle,
  getEnrichedTrades,
  getBotStats,
  generateAiAnalysis,
  getBotRunState,
  computeSignalPerformance,
} from "../lib/paperTradingEngine.js";
import { logger } from "../lib/logger.js";

/**
 * Canonical list of detectable pattern names — matches the strings emitted
 * by calcPatterns() in indicators.ts. Kept as a static array so the
 * frontend picker is always in sync without parsing the engine at runtime.
 */
export const DETECTABLE_PATTERNS: string[] = [
  // Structural / MA-based (daily)
  "Golden Cross", "Death Cross", "Volatility Squeeze",
  "BB Breakout", "BB Breakdown",
  "Bull Flag", "Bear Flag",
  "Bullish Pennant", "Bearish Pennant",
  "Ascending Triangle", "Descending Triangle", "Symmetrical Triangle",
  "Rising Wedge", "Falling Wedge",
  "Cup and Handle",
  "Double Bottom", "Double Top",
  "Rectangle Base",
  "Head and Shoulders", "Inv Head and Shoulders",
  "Bearish Island Reversal", "Bullish Island Reversal",
  "Inside Day", "NR7 Compression",
  // Single-bar candlestick
  "Doji", "Dragonfly Doji", "Gravestone Doji",
  "Hammer", "Inverted Hammer", "Hanging Man", "Shooting Star",
  "Bullish Marubozu", "Bearish Marubozu",
  "Bullish Inv Hammer", "Bearish Inv Hammer",
  "Bullish Spinning Top", "Bearish Spinning Top",
  // Two-bar
  "Bullish Engulfing", "Bearish Engulfing",
  "Bullish Harami", "Bearish Harami",
  "Bullish Harami Cross", "Bearish Harami Cross",
  "Piercing Line", "Dark Cloud Cover",
  "Tweezer Top", "Tweezer Bottom",
  "Downside Tasuki Gap",
  // Three-bar
  "Three White Soldiers", "Three Black Crows",
  "Morning Star", "Evening Star",
  "Morning Doji Star", "Evening Doji Star",
  "Abandoned Baby",
];

// ── Weekly timeframe patterns produced by calcMarketCycle() ──────────────────
const WEEKLY_PATTERNS: string[] = [
  "Weekly Golden Cross", "Weekly Death Cross",
  "Weekly BB Breakout", "Weekly BB Breakdown", "Weekly Volatility Squeeze",
  "Weekly Bull Flag", "Weekly Bear Flag",
  "Weekly Ascending Triangle", "Weekly Descending Triangle",
  "Weekly Cup and Handle",
  "Weekly Double Bottom", "Weekly Double Top",
  "Weekly Head and Shoulders", "Weekly Inv Head and Shoulders",
];

const router = Router();

// ── Config ────────────────────────────────────────────────────────────────────

router.get("/bot/config", async (req, res): Promise<void> => {
  try {
    res.json(await getOrCreateConfig());
  } catch (err) {
    req.log.error({ err }, "GET /bot/config failed");
    res.status(500).json({ error: "Failed to load config" });
  }
});

router.put("/bot/config", async (req, res): Promise<void> => {
  try {
    const patch = req.body as Record<string, unknown>;
    res.json(await updateConfig(patch));
  } catch (err) {
    req.log.error({ err }, "PUT /bot/config failed");
    res.status(500).json({ error: "Failed to update config" });
  }
});

// ── Cycle ─────────────────────────────────────────────────────────────────────

router.post("/bot/run", async (req, res): Promise<void> => {
  try {
    const result = await runBotCycle();
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "POST /bot/run failed");
    res.status(500).json({ error: "Bot cycle failed" });
  }
});

router.get("/bot/status", async (req, res): Promise<void> => {
  try {
    const { lastRunAt, cycleRunning } = getBotRunState();
    const config = await getOrCreateConfig();
    const stats  = await getBotStats();
    res.json({
      enabled:      config.enabled,
      cycleRunning,
      lastRunAt:    lastRunAt?.toISOString() ?? null,
      openCount:    stats.openTrades,
      closedCount:  stats.closedTrades,
      winRate:      stats.winRate,
      virtualPortfolioValue: stats.virtualPortfolioValue,
    });
  } catch (err) {
    req.log.error({ err }, "GET /bot/status failed");
    res.status(500).json({ error: "Failed to get status" });
  }
});

// ── Trades ────────────────────────────────────────────────────────────────────

router.get("/bot/trades", async (req, res): Promise<void> => {
  try {
    const status = (req.query.status as string) || "all";
    const valid  = ["open", "closed", "all"] as const;
    const s      = valid.includes(status as "open") ? (status as "open" | "closed" | "all") : "all";
    res.json(await getEnrichedTrades(s));
  } catch (err) {
    req.log.error({ err }, "GET /bot/trades failed");
    res.status(500).json({ error: "Failed to load trades" });
  }
});

router.get("/bot/stats", async (req, res): Promise<void> => {
  try {
    res.json(await getBotStats());
  } catch (err) {
    req.log.error({ err }, "GET /bot/stats failed");
    res.status(500).json({ error: "Failed to compute stats" });
  }
});

router.post("/bot/trades/:id/close", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid trade ID" }); return; }

  try {
    const [trade] = await db.select().from(paperTradesTable).where(eq(paperTradesTable.id, id));
    if (!trade)              { res.status(404).json({ error: "Trade not found" }); return; }
    if (trade.status !== "open") { res.status(400).json({ error: "Trade already closed" }); return; }

    const { exitPrice } = req.body as { exitPrice?: number };
    const price = exitPrice ?? trade.entryPrice;
    const pnlPercent = ((price - trade.entryPrice) / trade.entryPrice) * 100;
    const pnlDollar  = (trade.shares ?? 0) * (price - trade.entryPrice);

    const [updated] = await db
      .update(paperTradesTable)
      .set({ exitPrice: price, exitScore: null, exitReason: "manual", exitAt: new Date(), pnlPercent, pnlDollar, status: "closed" })
      .where(eq(paperTradesTable.id, id))
      .returning();

    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "POST /bot/trades/:id/close failed");
    res.status(500).json({ error: "Failed to close trade" });
  }
});

// ── Patterns ──────────────────────────────────────────────────────────────────

router.get("/bot/patterns", (_req, res): void => {
  res.json({ patterns: DETECTABLE_PATTERNS });
});

router.get("/bot/weekly-patterns", (_req, res): void => {
  res.json({ patterns: WEEKLY_PATTERNS });
});

// ── Signal performance learning ───────────────────────────────────────────────

router.get("/bot/signal-performance", async (req, res): Promise<void> => {
  try {
    res.json(await computeSignalPerformance());
  } catch (err) {
    req.log.error({ err }, "GET /bot/signal-performance failed");
    res.status(500).json({ error: "Failed to compute signal performance" });
  }
});

// ── AI ────────────────────────────────────────────────────────────────────────

router.post("/bot/analyze", async (req, res): Promise<void> => {
  try {
    const analysis = await generateAiAnalysis();
    res.json({ analysis });
  } catch (err) {
    req.log.error({ err }, "POST /bot/analyze failed");
    res.status(500).json({ error: "AI analysis failed" });
  }
});

export default router;

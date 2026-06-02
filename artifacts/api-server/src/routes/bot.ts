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
} from "../lib/paperTradingEngine.js";
import { logger } from "../lib/logger.js";

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

import { Router, type IRouter } from "express";
import { db, alertsTable } from "@workspace/db";
import { eq, and, isNull, isNotNull } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

router.get("/alerts", async (req, res): Promise<void> => {
  try {
    const alerts = await db
      .select()
      .from(alertsTable)
      .orderBy(alertsTable.createdAt);
    res.json(alerts);
  } catch (err) {
    req.log.error({ err }, "Failed to list alerts");
    res.status(500).json({ error: "Failed to list alerts" });
  }
});

router.get("/alerts/triggered", async (req, res): Promise<void> => {
  try {
    const triggered = await db
      .select()
      .from(alertsTable)
      .where(and(isNotNull(alertsTable.lastTriggeredAt), isNull(alertsTable.acknowledgedAt)));
    res.json(triggered);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch triggered alerts");
    res.status(500).json({ error: "Failed to fetch triggered alerts" });
  }
});

router.post("/alerts", async (req, res): Promise<void> => {
  const { ticker, conditionType, threshold } = req.body as {
    ticker?: unknown; conditionType?: unknown; threshold?: unknown;
  };

  if (!ticker || typeof ticker !== "string") {
    res.status(400).json({ error: "ticker (string) required" }); return;
  }
  if (!conditionType || typeof conditionType !== "string" ||
      !["score_above", "score_below", "direction_change"].includes(conditionType)) {
    res.status(400).json({ error: "conditionType must be 'score_above' | 'score_below' | 'direction_change'" }); return;
  }
  if ((conditionType === "score_above" || conditionType === "score_below") && threshold === undefined) {
    res.status(400).json({ error: "threshold required for score_above / score_below" }); return;
  }

  try {
    const [created] = await db.insert(alertsTable).values({
      ticker: ticker.toUpperCase(),
      conditionType,
      threshold: threshold !== undefined ? Number(threshold) : null,
    }).returning();
    res.status(201).json(created);
  } catch (err) {
    req.log.error({ err }, "Failed to create alert");
    res.status(500).json({ error: "Failed to create alert" });
  }
});

router.delete("/alerts/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    await db.delete(alertsTable).where(eq(alertsTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete alert");
    res.status(500).json({ error: "Failed to delete alert" });
  }
});

router.post("/alerts/:id/acknowledge", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    await db.update(alertsTable).set({ acknowledgedAt: new Date() }).where(eq(alertsTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to acknowledge alert");
    res.status(500).json({ error: "Failed to acknowledge alert" });
  }
});

export default router;

// ── Fire-and-forget alert check (called from stock analysis route) ─────────

export async function checkAlertsForTicker(
  ticker: string,
  score: number,
  direction: string,
): Promise<void> {
  try {
    const active = await db
      .select()
      .from(alertsTable)
      .where(and(eq(alertsTable.ticker, ticker.toUpperCase()), eq(alertsTable.isActive, true)));

    if (!active.length) return;

    const now = new Date();
    for (const alert of active) {
      let fire = false;

      if (alert.conditionType === "score_above" && alert.threshold !== null) {
        fire = score >= alert.threshold && alert.lastTriggeredAt === null;
      } else if (alert.conditionType === "score_below" && alert.threshold !== null) {
        fire = score <= alert.threshold && alert.lastTriggeredAt === null;
      } else if (alert.conditionType === "direction_change") {
        fire = alert.lastKnownDir !== null && alert.lastKnownDir !== direction;
      }

      if (fire) {
        await db
          .update(alertsTable)
          .set({ lastTriggeredAt: now, acknowledgedAt: null })
          .where(eq(alertsTable.id, alert.id));
      }

      if (alert.conditionType === "direction_change" && alert.lastKnownDir !== direction) {
        await db
          .update(alertsTable)
          .set({ lastKnownDir: direction })
          .where(eq(alertsTable.id, alert.id));
      }
    }
  } catch (err) {
    logger.warn({ err, ticker }, "Alert check failed");
  }
}

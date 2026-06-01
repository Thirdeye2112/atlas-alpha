import { Router, type IRouter } from "express";
import { db, watchlistTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { AddToWatchlistBody, RemoveFromWatchlistParams, UpdateWatchlistPositionBody } from "@workspace/api-zod";
import { fetchQuote } from "../lib/marketData.js";
import { analysisCache } from "../lib/cache.js";

const router: IRouter = Router();

router.get("/watchlist", async (req, res): Promise<void> => {
  const entries = await db.select().from(watchlistTable).orderBy(watchlistTable.addedAt);

  const items = await Promise.all(
    entries.map(async (entry) => {
      let price: number | null = null;
      let change: number | null = null;
      let changePercent: number | null = null;
      let atlasScore: number | null = null;
      let atlasLabel: string | null = null;
      let direction: string | null = null;
      let bullishProbability: number | null = null;
      let confidenceScore: number | null = null;

      try {
        const q = await fetchQuote(entry.ticker);
        price = q.price;
        change = q.change;
        changePercent = q.changePercent;

        const cached = analysisCache.get<{ atlasScore: { overall: number; label: string; direction: string; bullishProbability: number; confidenceScore: number } }>(`analysis:${entry.ticker}`);
        if (cached?.atlasScore) {
          atlasScore = cached.atlasScore.overall;
          atlasLabel = cached.atlasScore.label;
          direction = cached.atlasScore.direction;
          bullishProbability = cached.atlasScore.bullishProbability;
          confidenceScore = cached.atlasScore.confidenceScore;
        }
      } catch {
        // quote optional
      }

      return {
        id: entry.id,
        ticker: entry.ticker,
        addedAt: entry.addedAt.toISOString(),
        notes: entry.notes ?? null,
        price,
        change,
        changePercent,
        atlasScore,
        atlasLabel,
        direction,
        bullishProbability,
        confidenceScore,
        quantity: entry.quantity ?? null,
        costBasisTotal: entry.costBasisTotal ?? null,
        avgCostBasis: entry.avgCostBasis ?? null,
        accountName: entry.accountName ?? null,
      };
    })
  );

  res.json(items);
});

router.post("/watchlist", async (req, res): Promise<void> => {
  const parsed = AddToWatchlistBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const ticker = parsed.data.ticker.toUpperCase();

  const existing = await db.select().from(watchlistTable).where(eq(watchlistTable.ticker, ticker));
  if (existing.length > 0) {
    res.status(409).json({ error: `${ticker} is already in your watchlist` });
    return;
  }

  const [entry] = await db.insert(watchlistTable).values({
    ticker,
    notes: parsed.data.notes ?? null,
  }).returning();

  res.status(201).json({
    id: entry.id,
    ticker: entry.ticker,
    addedAt: entry.addedAt.toISOString(),
    notes: entry.notes ?? null,
  });
});

router.patch("/watchlist/:ticker", async (req, res): Promise<void> => {
  const paramTicker = req.params.ticker?.toUpperCase();
  if (!paramTicker) {
    res.status(400).json({ error: "ticker param required" });
    return;
  }

  const parsed = UpdateWatchlistPositionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { quantity, costBasisTotal, avgCostBasis, accountName } = parsed.data;

  const existing = await db.select().from(watchlistTable).where(eq(watchlistTable.ticker, paramTicker));

  let entry;
  if (existing.length === 0) {
    // Upsert: create if not present
    const [created] = await db.insert(watchlistTable).values({
      ticker: paramTicker,
      quantity: quantity ?? null,
      costBasisTotal: costBasisTotal ?? null,
      avgCostBasis: avgCostBasis ?? null,
      accountName: accountName ?? null,
    }).returning();
    entry = created;
  } else {
    // Update position fields
    const [updated] = await db
      .update(watchlistTable)
      .set({
        quantity: quantity ?? null,
        costBasisTotal: costBasisTotal ?? null,
        avgCostBasis: avgCostBasis ?? null,
        accountName: accountName ?? null,
      })
      .where(eq(watchlistTable.ticker, paramTicker))
      .returning();
    entry = updated;
  }

  res.json({
    id: entry.id,
    ticker: entry.ticker,
    addedAt: entry.addedAt.toISOString(),
    notes: entry.notes ?? null,
  });
});

router.delete("/watchlist/:ticker", async (req, res): Promise<void> => {
  const params = RemoveFromWatchlistParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [deleted] = await db
    .delete(watchlistTable)
    .where(eq(watchlistTable.ticker, params.data.ticker.toUpperCase()))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: `${params.data.ticker} not in watchlist` });
    return;
  }

  res.sendStatus(204);
});

export default router;

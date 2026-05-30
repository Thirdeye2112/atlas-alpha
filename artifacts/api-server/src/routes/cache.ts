import { Router, type IRouter } from "express";
import { getWarmupState, getCacheStats } from "../lib/warmup.js";
import { SCANNER_UNIVERSE } from "../lib/scannerUniverse.js";

const router: IRouter = Router();

router.get("/cache/status", (_req, res): void => {
  const warmup = getWarmupState();
  const stats  = getCacheStats();

  res.json({
    warmup: {
      status:            warmup.status,
      progress:          `${warmup.cachedTickers} / ${warmup.total}`,
      loaded:            warmup.loaded,
      failed:            warmup.failed,
      total:             warmup.total,
      pctComplete:       Math.round(warmup.cachedTickers / warmup.total * 100),
      startedAt:         warmup.startedAt,
      completedAt:       warmup.completedAt,
      durationMs:        warmup.durationMs,
      nextRefreshLabel:  warmup.nextRefreshLabel,
    },
    cache: stats,
    universe: SCANNER_UNIVERSE.length,
  });
});

export default router;

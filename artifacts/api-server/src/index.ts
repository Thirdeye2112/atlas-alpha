import app from "./app";
import { logger } from "./lib/logger";
import { startLearningScheduler, startResolutionScheduler, startScheduler } from "./lib/warmup";
import { startBotScheduler } from "./lib/botScheduler";
import { hydrateFromDb } from "./lib/dbCache";
import { initCalibrationFromDB } from "./lib/calibrationStore";
import { initPredictions } from "./lib/predictionStore";
import { loadDynamicUniverse } from "./lib/dynamicUniverse";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Hydrate in-memory caches from Postgres first, then run Yahoo Finance warmup
  // for any tickers not yet in the DB cache (or whose entries are stale).
  // Also load persisted calibration coefficients from DB so P(+) is available
  // immediately without waiting for the first backtest run.
  setImmediate(() => {
    // Load dynamic universe from Nasdaq screener first, then kick off warmup scan.
    // Falls back to static universe silently if Nasdaq API is unavailable.
    loadDynamicUniverse()
      .catch(err => logger.warn({ err }, "Dynamic universe load failed"))
      .finally(() => startScheduler());

    Promise.all([
      hydrateFromDb(),
      initCalibrationFromDB(),
      initPredictions(),
    ]).catch(err => logger.error({ err }, "Startup DB hydration failed"));
  });

  // Learning scheduler: triggers a full scan every 30 min on weekdays so the
  // snapshot engine keeps accumulating signal state and resolving outcomes
  // even when no one has the app open.
  startLearningScheduler();

  // Market-close resolution scheduler: fires resolveOutcomes() at 16:05 ET
  // Mon–Fri so every day's predictions are scored with locked closing prices.
  startResolutionScheduler();

  // Autonomous bot cycle scheduler: fires runBotCycle() every 30 min between
  // 09:30–16:00 ET on trading days when bot is enabled. Also starts the
  // background enhancement loop (calibration building, sim refresh, self-learning).
  startBotScheduler();
});

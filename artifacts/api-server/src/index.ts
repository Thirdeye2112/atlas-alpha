import app from "./app";
import { logger } from "./lib/logger";
import { runWarmup, startScheduler, startLearningScheduler } from "./lib/warmup";
import { hydrateFromDb } from "./lib/dbCache";
import { initCalibrationFromDB } from "./lib/calibrationStore";

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
    Promise.all([
      hydrateFromDb(),
      initCalibrationFromDB(),
    ])
      .then(() => runWarmup("startup"))
      .catch(err => logger.error({ err }, "Startup warmup failed"));
  });

  // Schedule twice-daily cache refreshes: market open (09:30 ET) and close (16:30 ET)
  startScheduler();

  // Learning scheduler: triggers a full scan every 30 min on weekdays so the
  // snapshot engine keeps accumulating signal state and resolving outcomes
  // even when no one has the app open.
  startLearningScheduler();
});

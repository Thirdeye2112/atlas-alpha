import app from "./app";
import { logger } from "./lib/logger";
import { runWarmup, startScheduler } from "./lib/warmup";

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

  // Pre-warm all 373 tickers in the background — non-blocking.
  // Subsequent requests are served instantly from cache instead of hitting Yahoo Finance cold.
  setImmediate(() => {
    runWarmup("startup").catch(err =>
      logger.error({ err }, "Startup warmup failed")
    );
  });

  // Schedule twice-daily refreshes: market open (09:30 ET) and market close (16:30 ET)
  startScheduler();
});

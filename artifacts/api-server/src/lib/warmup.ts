import { getUniverse } from "./scannerUniverse.js";
import { runFullAnalysis, type AnalysisResult } from "./analysisEngine.js";
import { fetchYahooRaw } from "./marketData.js";
import { runOhlcvBackfill, getBackfillState } from "./ohlcvStore.js";
import { analysisCache, ohlcvCache, quoteCache } from "./cache.js";
import { getOrStartScanJob } from "./scanJob.js";
import { initSimState } from "./historicalSimEngine.js";
import { resolveOutcomes } from "./snapshotEngine.js";
import { runEodPipeline } from "./eodPipeline.js";
import { logger } from "./logger.js";

// ── Warmup state ──────────────────────────────────────────────────────────────

export interface WarmupState {
  status: "idle" | "running" | "complete" | "error";
  loaded: number;
  failed: number;
  total: number;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  nextRefreshLabel: string | null;
  cachedTickers: number;
}

const state: WarmupState = {
  status: "idle",
  loaded: 0,
  failed: 0,
  total: getUniverse().length,
  startedAt: null,
  completedAt: null,
  durationMs: null,
  nextRefreshLabel: null,
  cachedTickers: 0,
};

export function getWarmupState(): WarmupState {
  // Count how many tickers currently have an analysis cached
  state.cachedTickers = getUniverse().filter(t =>
    analysisCache.has(`analysis:${t}`) || analysisCache.has(`scan:${t}`)
  ).length;
  return { ...state };
}

// ── Core warmup logic ─────────────────────────────────────────────────────────

const BATCH_SIZE  = 5;    // tickers fetched in parallel per batch
const BATCH_DELAY = 1500; // ms between batches — gives Yahoo Finance breathing room

export async function runWarmup(label = "startup"): Promise<void> {
  if (state.status === "running") {
    logger.warn({ label }, "Warmup already in progress, skipping");
    return;
  }

  // Restore sim state from DB so results survive server restarts
  void initSimState();

  const startedAt = Date.now();
  state.status     = "running";
  state.loaded     = 0;
  state.failed     = 0;
  state.startedAt  = new Date(startedAt).toISOString();
  state.completedAt = null;
  state.durationMs  = null;

  const universe = getUniverse();
  logger.info({ tickers: universe.length, label }, "Cache warmup starting");

  const collectedAnalyses: AnalysisResult[] = [];

  for (let i = 0; i < universe.length; i += BATCH_SIZE) {
    const batch = universe.slice(i, i + BATCH_SIZE);

    const batchResults = await Promise.allSettled(
      batch.map(ticker =>
        // lightMode: skips display-only signals (chart pins, structural patterns)
        // — 30% faster warmup; dashboard requests still get full analysis on demand.
        runFullAnalysis(ticker, true)
      )
    );

    for (const r of batchResults) {
      if (r.status === "fulfilled") {
        state.loaded++;
        collectedAnalyses.push(r.value);
      } else {
        state.failed++;
        logger.warn({ err: r.reason }, "Warmup: ticker failed");
      }
    }

    // Brief pause between batches to avoid Yahoo Finance rate limits
    if (i + BATCH_SIZE < universe.length) {
      await new Promise(r => setTimeout(r, BATCH_DELAY));
    }
  }

  const durationMs = Date.now() - startedAt;
  state.status      = "complete";
  state.completedAt = new Date().toISOString();
  state.durationMs  = durationMs;

  logger.info(
    { loaded: state.loaded, failed: state.failed, durationMs, label },
    "Cache warmup complete"
  );

  // After market-close warmup: run the EOD pipeline with locked final-bar analyses.
  // Fire-and-forget — warmup is already marked complete above.
  if (label === "market-close" && collectedAnalyses.length > 0) {
    runEodPipeline(collectedAnalyses).catch(err =>
      logger.error({ err }, "EOD pipeline failed")
    );
  }

  // Fire-and-forget: ensure all tickers (now ~580 after S&P 500 + NASDAQ 100 expansion)
  // have 2Y of daily bars in ohlcv_history. runOhlcvBackfill internally diffs each ticker
  // against the DB: tickers with 400+ fresh bars are skipped; newly added tickers get a
  // full 2Y seed; existing tickers only fetch the missing tail (last bar → today).
  // Rate-limited to 5 tickers/batch with 1.5s delay to avoid Yahoo Finance throttling.
  if (!getBackfillState().running) {
    runOhlcvBackfill(getUniverse(), fetchYahooRaw).catch(err =>
      logger.error({ err, label }, "OHLCV backfill failed")
    );
  }
}

// ── Scheduler ─────────────────────────────────────────────────────────────────
// Fires a full warmup twice on trading days:
//   • 09:30 ET — market open (fresh daily bars now available)
//   • 16:30 ET — market close (capture final closing prices)
//
// Uses a simple 1-minute polling interval and checks whether we're inside
// one of the two 10-minute trigger windows.  A 4-hour cooldown prevents
// double-firing within the same window.

const FOUR_HOURS = 4 * 60 * 60 * 1000;
let lastScheduledRun = 0;

function etHourMinute(): { day: number; h: number; m: number } {
  const now = new Date();
  // Approximate ET offset: UTC-4 (EDT, Mar–Nov) / UTC-5 (EST, Nov–Mar)
  const isDST = (() => {
    const jan = new Date(now.getFullYear(), 0, 1).getTimezoneOffset();
    const jul = new Date(now.getFullYear(), 6, 1).getTimezoneOffset();
    return now.getTimezoneOffset() < Math.max(jan, jul);
  })();
  const offsetH = isDST ? 4 : 5;
  const et = new Date(now.getTime() - offsetH * 3600 * 1000);
  return { day: et.getUTCDay(), h: et.getUTCHours(), m: et.getUTCMinutes() };
}

function scheduleLabel(h: number): string {
  return h < 12 ? "market-open" : "market-close";
}

export function startScheduler(): void {
  // Determine next refresh label for initial state
  state.nextRefreshLabel = "market-open (next trading day 09:30 ET)";

  setInterval(() => {
    const { day, h, m } = etHourMinute();

    // Skip weekends
    if (day === 0 || day === 6) return;

    const totalMin = h * 60 + m;
    const isOpenWindow  = totalMin >= 9 * 60 + 30 && totalMin < 9 * 60 + 40;   // 09:30–09:40 ET
    const isCloseWindow = totalMin >= 16 * 60 + 30 && totalMin < 16 * 60 + 40; // 16:30–16:40 ET

    if ((isOpenWindow || isCloseWindow) && Date.now() - lastScheduledRun > FOUR_HOURS) {
      lastScheduledRun = Date.now();
      const label = scheduleLabel(h);
      state.nextRefreshLabel = label === "market-open"
        ? "market-close (16:30 ET today)"
        : "market-open (next trading day 09:30 ET)";

      runWarmup(label).catch(err =>
        logger.error({ err, label }, "Scheduled warmup failed")
      );
    }
  }, 60_000); // poll every minute

  logger.info("Warmup scheduler started (fires at 09:30 and 16:30 ET on trading days)");
}

// ── Learning scheduler ────────────────────────────────────────────────────────
// Triggers the scan job (which auto-saves signal snapshots + resolves outcomes)
// every 30 minutes on weekdays — completely independent of any user activity.
// The scan job has its own 30-min TTL deduplication, so overlapping calls are safe.

const LEARNING_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

export function startLearningScheduler(): void {
  // Initial scan: 30 seconds after startup (lets warmup settle first)
  setTimeout(() => {
    getOrStartScanJob();
    logger.info("Learning scheduler: startup scan triggered");
  }, 30_000);

  // Recurring scan every 30 min, weekdays only
  setInterval(() => {
    const { day } = etHourMinute();
    if (day === 0 || day === 6) return; // skip Saturday (6) and Sunday (0)
    getOrStartScanJob();
    logger.info("Learning scheduler: periodic scan triggered");
  }, LEARNING_INTERVAL_MS);

  logger.info("Learning scheduler started (scans every 30 min, Mon–Fri)");
}

// ── Market-close resolution scheduler ─────────────────────────────────────────
// Fires a dedicated resolveOutcomes() pass at 16:05 ET every weekday.
// Running 5 minutes after market close gives Yahoo Finance time to post final
// closing prices, so the forward returns we compute are correct.
//
// This is separate from the 30-min scan-job resolution pass — the scan job
// catches mid-day updates, but this nightly pass is the authoritative run
// that scores the day's predictions with locked closing prices.

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
let lastResolutionRun = 0;

export function startResolutionScheduler(): void {
  setInterval(() => {
    const { day, h, m } = etHourMinute();
    if (day === 0 || day === 6) return;

    const totalMin = h * 60 + m;
    // 16:05–16:15 ET window (5 min after regular close, 15 min safety margin)
    const isWindow = totalMin >= 16 * 60 + 5 && totalMin < 16 * 60 + 15;

    if (isWindow && Date.now() - lastResolutionRun > FOUR_HOURS_MS) {
      lastResolutionRun = Date.now();
      resolveOutcomes()
        .then(n => logger.info({ updated: n }, "Market-close resolution complete"))
        .catch(err => logger.error({ err }, "Market-close resolution failed"));
    }
  }, 60_000); // poll every minute

  logger.info("Resolution scheduler started (fires at 16:05 ET Mon–Fri)");
}

// ── Cache stats helper ────────────────────────────────────────────────────────

export function getCacheStats() {
  return {
    analysis: { keys: analysisCache.keys().length, ttl: 300 },
    ohlcv:    { keys: ohlcvCache.keys().length,    ttl: 900 },
    quote:    { keys: quoteCache.keys().length,     ttl: 60  },
  };
}

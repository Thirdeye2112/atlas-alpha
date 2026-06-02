/**
 * Bot Cycle Scheduler
 *
 * Autonomously fires runBotCycle() every 30 minutes between 9:30–16:00 ET
 * on weekdays when config.enabled = true.
 *
 * Also drives the background enhancement loop (calibration building,
 * sim cache refresh, self-learning) via startBackgroundEnhancement().
 */

import { runBotCycle, getOrCreateConfig } from "./paperTradingEngine.js";
import { startBackgroundEnhancement }     from "./botIntelligence.js";
import { logger }                          from "./logger.js";

// ── State ─────────────────────────────────────────────────────────────────────

interface SchedulerState {
  started:        boolean;
  isRunning:      boolean;
  lastRunAt:      string | null;
  nextRunAt:      string | null;
  msUntilNext:    number | null;
  cycleCount:     number;
  lastExited:     string[];
  lastEntered:    string[];
}

const state: SchedulerState = {
  started:     false,
  isRunning:   false,
  lastRunAt:   null,
  nextRunAt:   null,
  msUntilNext: null,
  cycleCount:  0,
  lastExited:  [],
  lastEntered: [],
};

export function getSchedulerState(): SchedulerState {
  state.msUntilNext = state.nextRunAt
    ? Math.max(0, new Date(state.nextRunAt).getTime() - Date.now())
    : null;
  return { ...state };
}

// ── ET time helper (shared with warmup.ts) ────────────────────────────────────

function etNow(): { day: number; h: number; m: number } {
  const now    = new Date();
  const isDST  = (() => {
    const jan = new Date(now.getFullYear(), 0, 1).getTimezoneOffset();
    const jul = new Date(now.getFullYear(), 6, 1).getTimezoneOffset();
    return now.getTimezoneOffset() < Math.max(jan, jul);
  })();
  const offsetH = isDST ? 4 : 5;
  const et      = new Date(now.getTime() - offsetH * 3600 * 1000);
  return { day: et.getUTCDay(), h: et.getUTCHours(), m: et.getUTCMinutes() };
}

function isMarketHours(): boolean {
  const { day, h, m } = etNow();
  if (day === 0 || day === 6) return false;
  const totalMin = h * 60 + m;
  return totalMin >= 9 * 60 + 30 && totalMin < 16 * 60;
}

// ── Cycle runner ──────────────────────────────────────────────────────────────

const CYCLE_INTERVAL_MS  = 30 * 60 * 1000; // 30 minutes
const FIRST_CYCLE_DELAY  =  2 * 60 * 1000; // 2 min after startup

async function scheduledCycle(): Promise<void> {
  if (state.isRunning) {
    logger.info("Bot scheduler: cycle already running — skipping");
    scheduleNext();
    return;
  }

  let config;
  try {
    config = await getOrCreateConfig();
  } catch {
    scheduleNext();
    return;
  }

  if (!config.enabled) {
    logger.debug("Bot scheduler: bot disabled — skipping cycle");
    scheduleNext();
    return;
  }

  if (!isMarketHours()) {
    logger.debug("Bot scheduler: outside market hours — skipping cycle");
    scheduleNext();
    return;
  }

  state.isRunning = true;
  state.lastRunAt = new Date().toISOString();
  state.cycleCount++;

  try {
    const result = await runBotCycle();
    if (!result.skipped) {
      state.lastExited  = result.exited;
      state.lastEntered = result.newEntries;
      logger.info(
        { exited: result.exited.length, entered: result.newEntries.length, cycle: state.cycleCount },
        "Bot scheduler: autonomous cycle complete",
      );
    }
  } catch (err) {
    logger.error({ err, cycle: state.cycleCount }, "Bot scheduler: cycle failed");
  } finally {
    state.isRunning = false;
    scheduleNext();
  }
}

function scheduleNext(): void {
  state.nextRunAt = new Date(Date.now() + CYCLE_INTERVAL_MS).toISOString();
  setTimeout(() => { void scheduledCycle(); }, CYCLE_INTERVAL_MS);
}

// ── Public start ──────────────────────────────────────────────────────────────

export function startBotScheduler(): void {
  if (state.started) return;
  state.started    = true;
  state.nextRunAt  = new Date(Date.now() + FIRST_CYCLE_DELAY).toISOString();

  // First cycle: 2 min after startup (lets warmup + scan job settle)
  setTimeout(() => { void scheduledCycle(); }, FIRST_CYCLE_DELAY);

  // Background enhancement: calibration building, sim refresh, self-learning
  startBackgroundEnhancement();

  logger.info(
    "Bot scheduler started — autonomous cycles every 30 min (market hours, Mon–Fri 09:30–16:00 ET)",
  );
}

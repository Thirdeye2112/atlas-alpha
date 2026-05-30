/**
 * Shared scan job — one background pass over all 373 tickers, shared across all 10 scanner tabs.
 * Each batch completion updates the analyses array so any scanner endpoint can apply its own
 * filter/sort to whatever is available right now, enabling progressive (streaming) results.
 */
import { SCANNER_UNIVERSE } from "./scannerUniverse.js";
import { runFullAnalysis, type AnalysisResult } from "./analysisEngine.js";
import { logger } from "./logger.js";

const JOB_TTL_MS = 30 * 60 * 1000; // keep a completed job for 30 min before re-scanning
const BATCH_SIZE  = 10;

export interface ScanJob {
  analyses: AnalysisResult[];
  done: number;
  total: number;
  complete: boolean;
  startedAt: number;
}

let currentJob: ScanJob | null = null;

/**
 * Returns the current running/recently-completed scan job.
 * If no valid job exists, starts a new one in the background and returns it immediately.
 */
export function getOrStartScanJob(): ScanJob {
  const now = Date.now();

  if (currentJob) {
    const age = now - currentJob.startedAt;
    const isValid = !currentJob.complete || age < JOB_TTL_MS;
    if (isValid) return currentJob;
  }

  // Start a fresh job
  const job: ScanJob = {
    analyses:  [],
    done:      0,
    total:     SCANNER_UNIVERSE.length,
    complete:  false,
    startedAt: now,
  };
  currentJob = job;

  // Run in background — intentionally not awaited
  runJobBackground(job).catch(err =>
    logger.error({ err }, "Scan job background run failed")
  );

  return job;
}

async function runJobBackground(job: ScanJob): Promise<void> {
  for (let i = 0; i < SCANNER_UNIVERSE.length; i += BATCH_SIZE) {
    // Abort if a newer job has been started
    if (job !== currentJob) return;

    const batch = SCANNER_UNIVERSE.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(ticker => runFullAnalysis(ticker))
    );

    for (const r of results) {
      if (r.status === "fulfilled") job.analyses.push(r.value as AnalysisResult);
    }
    job.done = Math.min(i + BATCH_SIZE, SCANNER_UNIVERSE.length);
  }

  job.done     = job.total;
  job.complete = true;
  logger.info({ total: job.analyses.length }, "Scan job complete");
}

/**
 * Shared scan job — one background pass over all 373 tickers, shared across all 10 scanner tabs.
 * Each batch completion updates the analyses array so any scanner endpoint can apply its own
 * filter/sort to whatever is available right now, enabling progressive (streaming) results.
 */
import { SCANNER_UNIVERSE } from "./scannerUniverse.js";
import { runFullAnalysis, type AnalysisResult } from "./analysisEngine.js";
import { SCORE_VERSION } from "./scoring.js";
import { logger } from "./logger.js";
import { db, signalLogTable } from "@workspace/db";
import { saveSnapshotsBatch, resolveOutcomes } from "./snapshotEngine.js";

const JOB_TTL_MS = 30 * 60 * 1000; // keep a completed job for 30 min before re-scanning
const BATCH_SIZE  = 10;

export interface ScanJob {
  analyses: AnalysisResult[];
  done: number;
  total: number;
  complete: boolean;
  startedAt: number;
  completedAt?: number;
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
  const logRows: Array<typeof signalLogTable.$inferInsert> = [];

  for (let i = 0; i < SCANNER_UNIVERSE.length; i += BATCH_SIZE) {
    // Abort if a newer job has been started
    if (job !== currentJob) return;

    const batch = SCANNER_UNIVERSE.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      // lightMode=true: skips calcChartSignals + calcPatterns (display-only,
      // unused by any scanner filter) — ~30% less CPU per 373-ticker pass.
      // Results stored under scan:${sym} so user-facing dashboard results remain full.
      batch.map(ticker => runFullAnalysis(ticker, true))
    );

    for (const r of results) {
      if (r.status === "fulfilled") {
        const a = r.value as AnalysisResult;
        job.analyses.push(a);

        // Accumulate signal log rows for DB write at end of job
        logRows.push({
          ticker:          String(a.quote.ticker ?? ""),
          score:           a.atlasScore.overall,
          trendScore:      a.atlasScore.trendScore,
          momentumScore:   a.atlasScore.momentumScore,
          volumeScore:     a.atlasScore.volumeScore,
          rsScore:         a.atlasScore.relativeStrengthScore,
          regimeScore:     a.atlasScore.marketRegimeScore,
          exhaustionScore: a.atlasScore.exhaustionScore,
          direction:       a.atlasScore.direction as string,
          marketRegime:    null,
          scannerCategory: null,
          scoreVersion:    SCORE_VERSION,
        });
      }
    }
    job.done = Math.min(i + BATCH_SIZE, SCANNER_UNIVERSE.length);
  }

  job.done        = job.total;
  job.complete    = true;
  job.completedAt = Date.now();
  logger.info({ total: job.analyses.length }, "Scan job complete");

  // Batch-insert signal log (fire-and-forget, never blocks scanner)
  if (logRows.length > 0) {
    db.insert(signalLogTable).values(logRows).then(() => {
      logger.info({ count: logRows.length }, "Signal log written to DB");
    }).catch(err => {
      logger.warn({ err }, "Signal log DB write failed");
    });
  }

  // Learning system: snapshot today's full signal state for every ticker,
  // then incrementally resolve forward returns for eligible snapshots (1+ day old).
  // Both fire-and-forget.
  saveSnapshotsBatch(job.analyses).catch(err =>
    logger.warn({ err }, "Snapshot save failed")
  );
  resolveOutcomes().catch(err =>
    logger.warn({ err }, "Outcome resolution failed")
  );
}

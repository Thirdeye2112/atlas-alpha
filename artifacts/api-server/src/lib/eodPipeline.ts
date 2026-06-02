/**
 * eodPipeline — end-of-day close routine
 *
 * Fires automatically after the 16:30 ET market-close warmup completes.
 * Receives the freshly-computed AnalysisResult[] for all tickers so every
 * step runs on locked final-bar data:
 *
 *   1. saveSnapshotsBatch  — persist today's signal state to signal_snapshots
 *   2. resolveOutcomes     — score any predictions whose forward bars just arrived
 *   3. runSelfLearning     — update bot intelligence with today's new data
 *   4. runBotCycle         — review open positions + build tomorrow's watchlist
 */

import { type AnalysisResult }      from "./analysisEngine.js";
import { saveSnapshotsBatch,
         resolveOutcomes }           from "./snapshotEngine.js";
import { runSelfLearning }           from "./botIntelligence.js";
import { runBotCycle }               from "./paperTradingEngine.js";
import { logger }                    from "./logger.js";

// ── Pipeline ──────────────────────────────────────────────────────────────────

export async function runEodPipeline(analyses: AnalysisResult[]): Promise<void> {
  const start = Date.now();
  logger.info({ tickers: analyses.length }, "EOD pipeline starting");

  // 1 ─ Persist today's final signal state for every ticker
  try {
    await saveSnapshotsBatch(analyses);
    logger.info("EOD pipeline: signal snapshots saved");
  } catch (err) {
    logger.error({ err }, "EOD pipeline: snapshot save failed");
  }

  // 2 ─ Score predictions whose forward bars are now available (locked prices)
  try {
    const updated = await resolveOutcomes();
    logger.info({ updated }, "EOD pipeline: outcome resolution complete");
  } catch (err) {
    logger.error({ err }, "EOD pipeline: outcome resolution failed");
  }

  // 3 ─ Self-learning — update bot intelligence config from new evidence
  try {
    const result = await runSelfLearning();
    if (result?.adapted) {
      logger.info(result, "EOD pipeline: self-learning adapted bot config");
    } else {
      logger.info("EOD pipeline: self-learning ran — no adaptation needed");
    }
  } catch (err) {
    logger.error({ err }, "EOD pipeline: self-learning failed");
  }

  // 4 ─ Bot EOD planning cycle — exit any positions that hit targets/stops
  //     overnight, then build tomorrow's candidate watchlist.
  //     runBotCycle() respects config.enabled internally; if the bot is off
  //     it returns skipped=true immediately.
  try {
    const result = await runBotCycle();
    if (result.skipped) {
      logger.info("EOD pipeline: bot cycle skipped (bot disabled)");
    } else {
      logger.info(
        { exited: result.exited.length, entered: result.newEntries.length },
        "EOD pipeline: bot EOD cycle complete",
      );
    }
  } catch (err) {
    logger.error({ err }, "EOD pipeline: bot EOD cycle failed");
  }

  const ms = Date.now() - start;
  logger.info({ ms }, "EOD pipeline complete");
}

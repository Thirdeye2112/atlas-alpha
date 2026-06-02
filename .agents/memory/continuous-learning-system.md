---
name: Continuous learning system
description: signal_snapshots table, snapshotEngine.ts architecture, entryGate extraction, and key gotchas
---

## Architecture

Three-stage loop that fires automatically after every scan job completion (fire-and-forget):

1. **`saveSnapshotsBatch(analyses)`** — bulk `INSERT ... ON CONFLICT DO NOTHING` into `signal_snapshots` (one row per ticker per day; if same date already exists, skip). Captures score, sub-scores, RSI, candle structure, exhaustion, calibration IC, cycle phase, smart gate verdict.

2. **`resolveOutcomes()`** — queries rows where `snapshot_date <= CURRENT_DATE - 7` AND `outcome_resolved_at IS NULL`; fetches 3mo OHLCV per ticker once; finds snapshot date in bars array; looks up bars[idx+5/10/20] to compute forward returns; updates rows.

3. **`getLearnedPatterns()`** — raw SQL aggregation over resolved rows grouped by (score_bucket, rsi_zone, is_contrarian, distribution_top, has_exhaustion, cycle_phase, smart_gate_enter) HAVING COUNT(*) >= 3, sorted by |avg_return_10d|.

4. **`getConfidenceBoost(a)`** — queries similar historical situations (same bucket+zone+IC+exhaustion+cycle) with >= 5 obs; returns hit_rate_10d + avg_return_10d.

## Key files

- `lib/db/src/schema/signalSnapshots.ts` — Drizzle schema; `uniqueIndex("uq_signal_snapshot").on(ticker, snapshotDate)`
- `artifacts/api-server/src/lib/entryGate.ts` — extracted `smartEntryGate(a)` (was in paperTradingEngine.ts); imported by both paperTradingEngine + snapshotEngine
- `artifacts/api-server/src/lib/snapshotEngine.ts` — all 5 functions
- `artifacts/api-server/src/lib/scanJob.ts` — hooks at job completion
- `artifacts/api-server/src/routes/bot.ts` — GET /bot/learning-stats, GET /bot/learned-patterns
- `artifacts/atlas-alpha/src/pages/BotLab.tsx` — `LearningTab` component + ◈ LEARNING tab trigger/content

## API endpoints

- `GET /api/bot/learning-stats` → `{ totalSnapshots, resolvedSnapshots, unresolvedSnapshots, oldestSnapshotDate, newestSnapshotDate, avgHitRate10d, avgReturn10d }`
- `GET /api/bot/learned-patterns` → `{ patterns: LearnedPattern[] }`

## Critical gotcha

**`CalibrationEntry` has NO `isContrarian` field.** Derive it as `rankIC < 0`. The CalibrationEntry interface fields are: ticker, slope, intercept, calibratedProbability (function), observations, horizon, rankIC, icRating, fittedAt, fitSource, optimalWeights.

**Why:** The calibration store only stores the raw IC; the contrarian label is computed at usage sites.

**How to apply:** Wherever you need to know if a ticker is contrarian, use `cal?.rankIC != null ? cal.rankIC < 0 : null` — never access `cal.isContrarian`.

## Resolved outcome timing

- 7 calendar days = minimum window before resolution attempt (covers 5 trading days)
- `resolveOutcomes()` processes up to 120 unresolved rows per call (batched by ticker for OHLCV efficiency)
- Outcome resolver runs fire-and-forget after every 30-min scan job

## Pattern mining SQL notes

- `db.execute(sql\`...\`)` returns `{ rows: Record<string, unknown>[] }` — must cast result rows manually
- Pattern table displays empty state while building; shows "Building knowledge base" card until resolvedSnapshots >= 3
- First real pattern clusters expected 7-14 days after deployment

# Advanced Research Integration Report

**Date:** 2026-06-16
**Scope:** Verify the new atlas-alpha advanced-research endpoints and UI components
read real `atlas_research` data correctly, fix schema/column mismatches, and confirm
the UI renders and degrades gracefully.

**Environment**
- API server: `http://localhost:8080` (`artifacts/api-server`, `node dist/index.mjs`)
- Frontend dev: `http://localhost:20959` (Vite, proxies `/api` → 8080)
- `DATABASE_URL_RESEARCH` = `postgresql://postgres:***@localhost:5432/atlas_research` — **set and reachable** ✅
- Latest predictions date in DB: **2026-06-14** (12,708 rows for `return_regressor`; 6,079 on latest date)

---

## 1. Endpoint smoke tests (after fixes)

All 7 endpoints return **HTTP 200** and read live `atlas_research` tables.

| Endpoint | Status | available | Source table(s) | Rows / result |
|---|---|---|---|---|
| `GET /api/research/pipeline/health` | 200 | true | `information_schema`, `predictions`, `research_runs`, `intraday_behavior_events`, `intraday_candle_memory` | `status: healthy`, 0 missing tables, pred_count 12,708 |
| `GET /api/research/batch/enrichment?tickers=AAPL,MSFT,NVDA` | 200 | true | `predictions` + `intraday_behavior_events` ⨝ `market_behavior_concepts` | 3 tickers, behaviors now populated |
| `GET /api/research/template/eligible/AAPL` | 200 | true | `predictions`, `signal_combination_scores` | `eligible: true`, 5 active (PROMOTED) patterns |
| `GET /api/research/meta/AAPL` | 200 | true | `predictions` | `meta_filter_pass: true` |
| `GET /api/research/confluence/AAPL` | 200 | true | `intraday_similarity_latest` | 1 setup, `confluence_score 0.62`, `BULL` |
| `GET /api/research/intraday/similarity/AAPL` | 200 | true | `intraday_similarity_latest` + behavior layer (pre-existing `research-ml.ts`) | full payload, 50 neighbors |
| `GET /api/research/intraday/behavior/AAPL` | 200 | true | `intraday_behavior_events` ⨝ `market_behavior_concepts` ⨝ `intraday_behavior_importance` | 1 behavior (GAP_UP_SMALL) |

**Discrimination check:** `MSFT` (rank 0.292) → `eligible: false`; `AAPL`/`NVDA` (rank 0.731) → `eligible: true`. The eligibility gate now discriminates.

**Graceful degradation (unknown ticker `ZZZZ`):**
- `confluence`, `meta`, `template/eligible`, `intraday/behavior` → 200 with `available:true` and empty/null payloads (or `reason: no_prediction`).
- `intraday/similarity/ZZZZ` → **404** (pre-existing `research-ml.ts` route; returns 404 rather than `{available:false}` when a ticker has no similarity rows). Not consumed by the advanced UI hooks. See blockers.

---

## 2. Schema / column mismatches fixed

All fixes in `artifacts/api-server/src/routes/research-advanced.ts` and
`artifacts/atlas-alpha/src/components/BotTemplateSignals.tsx`.

### API (`research-advanced.ts`)

1. **`rank_percentile` scale (0–1, not 0–100).** Eligibility/meta gates compared `rank_percentile >= 60`; the column is stored 0–1 (min 0.003, max 0.997). Every ticker failed the gate. → changed to `>= 0.6` in `/meta/:ticker` and `/template/eligible/:ticker`.

2. **`signal_combination_scores.status` value.** `/template/eligible` queried `WHERE status = 'ACTIVE'` — that value does not exist. Real statuses: `CANDIDATE` (43), `INSUFFICIENT` (1524), `PROMOTED` (34), `REJECTED` (103). → changed to `status = 'PROMOTED'`. `active_patterns` now populates.

3. **Inactive `confidence`/`probability_positive` columns no longer hard-gate eligibility.** Both columns are near-constant in live data (`confidence` ≈ 0.0496, `probability_positive` ≈ 0.5247), so `confidence >= 0.5` permanently disabled the feature. Eligibility/meta now gate on `rank_percentile` + combo status; confidence is still reported for context. Combo status accepts `null | 'ACTIVE' | 'PROMOTED'`.

4. **Batch behavior window too narrow.** `/batch/enrichment` filtered `event_date >= CURRENT_DATE - INTERVAL '1 day'`, but behavior events lag (latest 2026-06-12), so `behaviors` was always empty. → window anchored to `MAX(event_date) - INTERVAL '5 days'`. Behaviors now return.

5. **`pipeline/health` critical-table list used non-existent names.** `daily_bars`, `intraday_candles`, `pipeline_run_log` do not exist → endpoint falsely reported `degraded`. Real names: daily bars live in `raw_bars`, intraday in `intraday_bars`, run log is `research_runs`. → list corrected; endpoint now reports `healthy` with 0 missing tables. (The `pipeline_run_log` → `research_runs` fallback for `latest_pipeline_run` was already present and works.)

### UI (`BotTemplateSignals.tsx`)

6. **Babel parse error blocked the entire UI.** `SignalRowProps.item` used a conditional type `ReturnType<typeof useBatchEnrichment>['data'] extends { tickers: infer T[] } ? T : never`. esbuild (prod build) accepted it, but the dev server's `@vitejs/plugin-react` (babel) threw `Unexpected token, expected ";"`, crashing the app on load. → replaced with the exported `EnrichmentItem` type.

7. **Behavior direction never matched.** Filters checked `b.direction === 'BULLISH'/'BEARISH'`, but `market_behavior_concepts.direction` is `long`/`short`/`neutral`. The ↑/↓ summary was always `0↑ 0↓`. → added `isBull()`/`isBear()` helpers matching `long`/`short` (and legacy values); applied to summary, icon, and expanded-row colors.

8. **Rank displayed un-scaled.** Column showed `fmtNum(rank_percentile)%ile` → `0.7%ile`. → multiply by 100 → `73.1%ile`.

9. **Alignment indicator gated on inactive confidence.** `alignedWithEntry` required `confidence >= 0.5` (never true), so the ✓/! marker never showed. → gate on `rank_percentile >= 0.6`.

---

## 3. UI verification

Verified in-browser at `http://localhost:20959` (Preview tool):

- **Research health strip renders** ✅ — header shows green `● HEALTHY · preds: 2026-06-14` (Research → inner RESEARCH sub-tab, `BackendHealthPanel compact`).
- **BotLab ⚡ SIGNALS tab renders** ✅ — header `⚡ SIGNALS  read-only · paper trade enrichment` + `● healthy 2026-06-14`; one enrichment row per open paper position with columns TICKER / EXP RET / PROB+ / CONF / RANK / BEHAVIOR.
- **Paper-trade-only language visible** ✅ — `read-only · paper trade enrichment` (header) and `Paper trade only — no live orders.` (footer). No live-trading controls.
- **No runtime console errors** ✅ — console error filter returned nothing after the parse-error fix.
- **Missing data degrades gracefully** ✅ — tickers without predictions render a `no prediction available` row with `—` placeholders; tickers without behavior data show `none`; unknown tickers return `available` JSON rather than throwing.

---

## 4. Remaining blockers (upstream data/pipeline — not atlas-alpha API)

These are `atlas_research` data-quality issues. The API reads and displays the values
correctly; the signals themselves are degenerate until the pipeline is fixed.

1. **`rank_percentile` is quantized to ~7 values.** On 2026-06-14, 6,079 predictions resolve to only 7 distinct ranks; 3,204 tickers (~53%) share exactly `0.7313`. This is why every open position shows the same `73.1%ile`. Rank is the only working discriminator, but it is coarse — the regressor is emitting tied/bucketed scores. Needs investigation in the scoring/ranking step.

2. **`confidence` near-constant (~0.0496)** and **`probability_positive` near-constant (~0.5247)** across the universe; `raw_confidence` / `calibrated_confidence` are NULL. Calibration is not active (consistent with prior probability-calibration notes). Until fixed, the CONF and PROB+ columns are informational only.

3. **`combo_key` / `combo_status` are 100% NULL in `predictions`.** The Meta-Filter combo enrichment (combo PF/expectancy per ticker) has no per-ticker data to surface; `signal_combination_scores` (PROMOTED patterns) is used as the universe-level fallback.

4. **Latest nightly pipeline run = `failed`** (`research_runs`, 2026-06-14): `ingest_failures: ['BRK.B','DAWN','GSX','IAS','MGRM']`. Predictions/behaviors still produced for the rest of the universe, but the run is not clean.

5. **Behavior events lag** — latest `event_date` is 2026-06-12 (4 days behind predictions). Batch window widened to compensate, but freshness depends on the behavior-detection step running.

6. **`intraday/similarity/:ticker` returns 404 for tickers with no rows** (pre-existing `research-ml.ts`), rather than `{available:false}`. Low priority — only ~10 tickers have similarity rows and the advanced UI does not call this route — but it is inconsistent with the graceful-degradation pattern of the other endpoints.

---

## Summary

All 7 advanced endpoints work against live `atlas_research` and the UI (health strip,
⚡ SIGNALS tab) renders, shows paper-trade-only language, and degrades gracefully with
no console errors. Five API mismatches and four UI bugs (including a dev-server-only
parse error that blocked the whole app) were fixed. The remaining items are upstream
data-quality blockers in the ML pipeline, not in the atlas-alpha integration layer.

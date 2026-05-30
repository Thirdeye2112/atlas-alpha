---
name: Scanner streaming architecture
description: How the shared scan job and DB cache enable progressive scanner results and fast restarts
---

## Rule
The scanner uses a shared singleton `ScanJob` (`scanJob.ts`) — all 10 tabs trigger/share ONE background pass over 373 tickers. Each batch completion updates `job.analyses`; routes apply their filter/sort to whatever is available. Response shape: `{ results, progress: { done, total }, complete }`. Frontend polls every 2s via React Query `refetchInterval` until `complete: true`.

**Why:** Previously each of 10 tabs ran its own full scan independently — 10x the Yahoo Finance load, and users had to wait 30-45s with no feedback. Now the first results appear within seconds and the table updates live as more tickers are analyzed.

**How to apply:**
- `getOrStartScanJob()` in `scanJob.ts` returns the running/recently-completed job (TTL: 30 min)
- Scanner routes call `scanResponse(filter, sort, limit)` — a thin wrapper around the shared job
- OpenAPI schema: `ScannerResponse` wraps `results: ScannerResult[]` + `progress` + `complete`
- Frontend: `refetchInterval: (q) => (!q.state.data || !q.state.data.complete) ? 2000 : false`

## DB cache persistence
- `quote_cache` and `ohlcv_cache` tables in Postgres (schema in `lib/db/src/schema/stockCache.ts`)
- `dbCache.ts` — `hydrateFromDb()` called at startup, `persistQuote/persistOhlcv` fire-and-forget after every Yahoo fetch
- Server restart sequence: hydrateFromDb → runWarmup (warmup skips tickers already in memory from DB hydration)
- First run: DB empty, warmup runs normally; subsequent restarts: most tickers served from DB cache instantly

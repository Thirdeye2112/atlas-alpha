---
name: OHLCV cache architecture and coverage bug
description: How weekly/monthly OHLCV fetching works and the 2Y coverage bug that caused 5Y/ALL to show only 2 years
---

## Rule
Weekly and monthly OHLCV intervals must go directly to Yahoo Finance — never through the daily DB store (`getOrFetchDailyBars`). The DB store only holds daily bars; routing 1wk/1mo through it returns daily bars with the wrong interval.

**Why:** `getOrFetchDailyBars` always fetches/stores `interval=1d` internally. If a 5Y/1wk request was routed through it, the caller would receive ~1260 daily bars instead of ~262 weekly bars — wrong candle granularity entirely.

## The blob-cache coverage bug (fixed)
The OHLCV blob cache (`ohlcvCache`, 15-min TTL, persisted to `ohlcv_cache` table in DB and hydrated at startup) was storing 2Y of weekly bars under keys like `F:5y:1wk`. On restart, these stale blobs were hydrated and served immediately, returning only 2Y for a 5Y request.

**Fix:** Before trusting a cached blob, validate coverage: if `cached[0].time` is more than 45 days later than the computed `start` date, evict the cache entry and re-fetch.

## Fetch routing (current, correct)
```
interval is intraday (1m/5m/60m etc.) → fetchYahooRaw directly
interval === "1d"                      → getOrFetchDailyBars (DB-first, gap-fill)
interval === "1wk" or "1mo"           → fetchYahooRaw directly with native interval
```

## How to apply
- If you change `fetchOHLCV`, preserve this routing split. Do NOT extend `getOrFetchDailyBars` to handle weekly/monthly.
- The 45-day coverage tolerance handles weekends/holidays and lets 1M timeframes have some slop without constant re-fetches.
- `seedShorterPeriods` only runs for `interval === "1d"` now (not all non-intraday).

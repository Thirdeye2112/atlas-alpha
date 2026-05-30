---
name: Yahoo Finance concurrency
description: Semaphore pattern to prevent rate-limit 502s when warmup and scanner run concurrently
---

## Rule
All Yahoo Finance calls (quote, quoteSummary, chart) must go through a global 8-slot `Semaphore` defined in `marketData.ts`. Use the `yahooCall()` wrapper instead of `withRetry()` directly.

**Why:** Startup warmup (batches of 5) + scanner (batches of 10) + individual analysis requests all hit Yahoo Finance simultaneously. Without a cap, 20–30 concurrent calls trigger Yahoo's rate limiter, and the proxy times out with 502s. Scanner shows "NO RESULTS FOUND" as a result.

**How to apply:** Any new Yahoo Finance call in `marketData.ts` must use `yahooCall(() => yahooFinance.someMethod(...))`. Scanner batch size capped at 10. Warmup batch size stays at 5.

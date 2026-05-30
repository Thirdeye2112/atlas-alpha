---
name: Scanner E2E Playwright timeout
description: Cold scanner scan exceeds Playwright notebook budget; use curl for verification instead
---

## Rule
The Scanner page's first (cold cache) load takes 30–45 seconds while it analyzes 373 tickers. Playwright's notebook environment times out waiting for the table to appear. Verify the scanner works by hitting the API directly with curl instead of relying on a browser E2E test for the initial load.

**Why:** Playwright has a finite step budget; waiting 45s for a spinner blocks all subsequent test steps. The scanner is otherwise fully functional — E2E tests that only check cached results (after a warmup) would work fine.

**How to apply:** `curl -s --max-time 55 "http://localhost:80/api/scanner/top-longs?limit=5"` confirms scanner results. If you need a browser E2E test, load the scanner page first via API to warm the cache, then run the UI test against the cached result.

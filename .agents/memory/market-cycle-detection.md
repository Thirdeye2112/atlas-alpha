---
name: Market Cycle Detection
description: Weinstein Stage Analysis implementation — how calcMarketCycle works, cache gotcha, and bot filter wiring
---

## The rule
`calcMarketCycle(weeklyBars)` lives in `indicators.ts` (end of file). It is called in `buildResult()` in `analysisEngine.ts` only when `!lightMode`. Result stored in `AnalysisResult.marketCycle: MarketCycleResult | null`.

## Weinstein Stage Logic
- **Stage 2 — markup**: price above rising SMA-40 (weekly 200d proxy), higher-highs + higher-lows
- **Stage 4 — markdown**: price below declining SMA-40, lower-highs + lower-lows
- **Stage 3 — distribution**: near 52-week highs (within 15%), RSI > 68 or SMA flattening
- **Stage 1 — accumulation**: below SMA-40, within 35% of 52-week low, RSI < 52
- **Ranging**: doesn't meet any of the above thresholds

Weekly patterns detected: Golden/Death Cross, BB Breakout/Breakdown/Squeeze, Bull/Bear Flag, Ascending/Descending Triangle, Cup and Handle, Double Bottom/Top, H&S / Inv H&S.

## Cache gotcha — critical
The **scan job always runs in lightMode** → `marketCycle` is null in `scan:${ticker}` entries. `getEnrichedTrades()` in `paperTradingEngine.ts` was patched to check the full cache (`analysis:${ticker}`) first before falling back to the scan job. The full cache is populated when: (a) the Dashboard loads a ticker, or (b) the bot cycle runs `runFullAnalysis()` for an entry candidate. Full cache TTL = 5 minutes.

**Why:** scan job processes 647 tickers in lightMode for speed — fetching 2Y weekly bars for each in the scan would make it 2-3× slower.

## Bot filter fields exposed (getFieldValue in paperTradingEngine.ts)
- `cyclePhase` → string enum: "accumulation" | "markup" | "distribution" | "markdown" | "ranging"
- `weeklyPatterns` → string[] (patterns detected on weekly timeframe)
- `distFrom52wHigh` → number (% below 52-week high, negative = below)
- `sma40Rising` → "yes" | "no"
- `weeklyRsi` → number (RSI computed on weekly closes)
- `priceVsSma40Weekly` → number (% relative to weekly SMA-40)

## CS_FIELDS added to BotLab.tsx
New fields in the criteria builder: Cycle Phase (enum), Pattern (Weekly) (array→weeklyPatterns), Weekly Trend 200d (enum), Weekly RSI (number), vs 52W High % (number), vs Weekly SMA200 % (number).

## CycleBadge component
Color-coded badge in the PositionsTab CYCLE column:
- markup → green (MARKUP ↑)
- accumulation → blue (ACCUM.)
- distribution → yellow (DIST. ↓)
- markdown → red (MARKDOWN)
- ranging → muted (RANGING)

Also shows first weekly pattern below the badge (abbreviated as "W: Bull Flag" etc.).

## API endpoints
- `GET /api/bot/weekly-patterns` → WEEKLY_PATTERNS array (14 patterns)
- `GET /api/bot/patterns` → ALL_PATTERNS array (55 daily patterns, unchanged)

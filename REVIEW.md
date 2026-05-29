# Atlas Alpha — AI Review Guide

Institutional-grade quant trading signal platform. Bloomberg/Goldman-style dark dashboard built on Yahoo Finance (free, no API key). This document is written for AI reviewers who want to understand the system, test it live, and identify improvement opportunities.

---

## Quick Start

Two services must be running (both are started automatically via Replit workflows):

| Service | Port | Path |
|---------|------|------|
| Express API | 8080 | `/api` |
| Vite React frontend | 20959 | `/` |

All traffic routes through a shared reverse proxy on `localhost:80`.

---

## Live API — Test Endpoints

All requests go through `localhost:80`. No auth required.

### Health
```
GET /api/healthz
```

### Full stock analysis (the core endpoint)
```
GET /api/stock/AAPL/analysis
GET /api/stock/NVDA/analysis
GET /api/stock/SPY/analysis
```
Returns `StockAnalysis` — quote, 6 indicator blocks, Atlas Alpha Score 0–100, chart signals, signal narrative. First call hits Yahoo Finance (500–800ms), subsequent calls within 5 min are served from cache (<5ms).

### OHLCV bars (chart data)
```
GET /api/stock/AAPL/ohlcv
GET /api/stock/AAPL/ohlcv?period=3mo&interval=1d
GET /api/stock/AAPL/ohlcv?period=1d&interval=1m
GET /api/stock/AAPL/ohlcv?period=1y&interval=1d
```
Valid periods: `1d 5d 1mo 3mo 6mo 1y 2y 5y max`
Valid intervals: `1m 5m 15m 30m 1h 1d 1wk 1mo`

### Point-in-time historical replay
```
GET /api/stock/AAPL/historical-analysis?asOf=2026-01-15
GET /api/stock/NVDA/historical-analysis?asOf=2025-11-01
```
Reconstructs what the Atlas Alpha Score would have been on that date, using only data available at that time. Used for back-of-envelope validation.

### Scanner (8 categories, ~80-ticker universe)
```
GET /api/scanner/top-longs
GET /api/scanner/top-shorts
GET /api/scanner/breakouts
GET /api/scanner/breakdowns
GET /api/scanner/gamma-squeeze
GET /api/scanner/short-squeeze
GET /api/scanner/institutional-accumulation
GET /api/scanner/mean-reversion
```
First call takes 15–20s (parallelized batches of 10). Cached 10 min.

### Watchlist (PostgreSQL persistent)
```
GET    /api/watchlist
POST   /api/watchlist          body: {"ticker":"TSLA"}
DELETE /api/watchlist/TSLA
```

### Market overview
```
GET /api/market/overview
```
Returns SPY/QQQ/IWM/VIX quotes + market regime classification (RISK ON / RISK OFF / NEUTRAL).

---

## Architecture

```
pnpm monorepo
├── lib/
│   ├── api-spec/openapi.yaml        ← Source of truth for all endpoints
│   ├── api-client-react/            ← Orval-generated React Query hooks + Zod schemas
│   └── db/                          ← Drizzle ORM schema (watchlist table)
├── artifacts/
│   ├── api-server/src/
│   │   ├── lib/
│   │   │   ├── marketData.ts        ← Yahoo Finance wrapper (quotes, OHLCV, options)
│   │   │   ├── indicators.ts        ← All TA: RSI, MACD, BB, ATR, Stoch, OBV, VWAP, ADX, etc.
│   │   │   ├── scoring.ts           ← Atlas Alpha Score compositor + signal narrative
│   │   │   ├── analysisEngine.ts    ← Orchestrates: data → indicators → score → result
│   │   │   ├── scannerUniverse.ts   ← ~80 hardcoded tickers across sectors
│   │   │   └── cache.ts             ← node-cache (analysis: 5min, OHLCV: 15min, scanner: 10min)
│   │   └── routes/
│   │       ├── stock.ts             ← /stock/:ticker/analysis, /ohlcv, /historical-analysis
│   │       ├── scanner.ts           ← /scanner/* (parallel batch analysis)
│   │       ├── watchlist.ts         ← /watchlist CRUD
│   │       └── market.ts            ← /market/overview
│   └── atlas-alpha/src/
│       ├── pages/
│       │   ├── Dashboard.tsx        ← 3-panel: watchlist sidebar, chart, score panel
│       │   ├── Scanner.tsx          ← 8-category scanner with sortable table
│       │   └── Watchlist.tsx        ← Persistent watchlist management
│       └── components/
│           ├── charts/LightweightChart.tsx  ← lightweight-charts v5 candlestick + MA lines + signals
│           ├── charts/ScoreGauge.tsx        ← Arc gauge for 0–100 score
│           └── charts/RsiMiniChart.tsx      ← Inline RSI sparkline
```

---

## Atlas Alpha Score — Composite Construction

```
Score = Trend(25%) + Momentum(20%) + Volume(15%) + Options(20%) + RelStrength(10%) + Regime(10%)
```

**Sub-scores:**
- **Trend (0–100):** SMA stack alignment, golden/death cross, EMA ribbon, price vs SMA distances
- **Momentum (0–100):** RSI 14, MACD, Stochastic 14/3, CCI, ROC
- **Volume (0–100):** OBV trend, Chaikin Money Flow, relative volume vs 20-day avg, volume spikes
- **Options (0–100):** Proxy — volatility squeeze (BB inside Keltner), IV rank, put/call ratio when available
- **Relative Strength (0–100):** 20-day price return vs SPY, QQQ, IWM, sector ETF
- **Market Regime (0–100):** SPY trend + VIX level classification → fed in from market overview

**Derived outputs:**
- `bullishProbability` = `clamp(overall)` — not a statistical probability, just the score reframed as %
- `confidenceScore` = `max(bullishCount, bearishCount) / 20 * 100` — agreement ratio across 20 signals
- `direction` = bullish if score ≥ 60, bearish if ≤ 40, else neutral
- `timeHorizon` = 1–3d if confidence > 80% + strong signal, 1–3m if weak confidence
- `riskScore` = `100 - confidence + (expectedMove > 5% ? 20 : 0)`

**Signal indicators (20 total, used for confidence):**
Many are correlated (e.g., `rs.vsSpy > 0` and `rs.vsSpy > 2` are both counted separately), which inflates confidence scores.

---

## Chart Overlays

**Moving average lines** (computed in frontend from OHLCV data):
- SMA50 — orange solid
- SMA87 — purple solid
- SMA200 — red solid (only visible on charts with 200+ bars: 1Y+)

**Short right-side stubs** (from API analysis, last 2 bars only):
- BB+ / BB− — gray dotted (Bollinger 20,2)
- VWAP — purple dashed (volume-weighted moving avg of closes)
- SUP / RES — green/red dashed (swing high/low from patterns)

**Signal markers** (daily/weekly/monthly bars only):
- RSI↑ (strong green ↑) — RSI bounces back above 30
- OB (red ↓) — RSI enters overbought >70
- RSI↓ (red ↓) — RSI rolls back below 70
- OS (strong red ↓) — RSI enters oversold <30
- BB↑ / BB↓ — price breaks outside Bollinger Band
- BB↪ / BB↩ — price returns inside band (mean reversion confirmation)
- VOL (green/red) — volume spike >2.5× 20-day avg

---

## Data Source Notes

- **All market data:** Yahoo Finance via `yahoo-finance2` v3 (free, no API key)
- **Rate limits:** Yahoo Finance is unofficial; heavy scanning can trigger throttling
- **Options data:** `yahoo-finance2` returns options chain data (strikes, OI, IV) but it is incomplete for many tickers — the system falls back to a volatility-based proxy when options chain is unavailable
- **Historical data:** Yahoo Finance provides adjusted OHLCV going back decades; quality degrades for very old data
- **Validation errors:** `yahoo-finance2` emits schema validation warnings for some tickers — logged but not fatal

---

## Known Limitations for Reviewers

1. **VWAP is not true VWAP** — The displayed VWAP is a volume-weighted moving average of daily closes (like VWMA), not the intraday VWAP that resets each session. True VWAP requires tick/intraday data.

2. **Options score is largely proxy** — Real put/call ratio, max pain, and gamma levels are unavailable for most tickers via Yahoo Finance free tier. The options score falls back to a volatility-squeeze proxy.

3. **bullishProbability is not a calibrated probability** — It equals the composite score (0–100 reframed as a percent). A 77 score → 77% bullish probability is a marketing framing, not a statistical model output.

4. **Confidence score double-counts** — `rs.vsSpy > 0` and `rs.vsSpy > 2` are both separate indicator slots, inflating agreement counts. 20 indicators are not truly independent.

5. **Scanner universe is fixed** — ~80 tickers hardcoded in `scannerUniverse.ts`. No custom universe support.

6. **Signal narrative references SMA20** — `scoring.ts:buildNarrative()` still outputs "SMA20" in trend descriptions even though SMA20 was removed from the chart.

7. **No volume bars on chart** — Volume is analyzed but not rendered as a chart subplot.

8. **Historical replay is best-effort** — It downloads the last 2 years of data ending at `asOf` and recalculates indicators. Results may differ from what would have been seen live due to adjusted prices and survivorship.

---

## OpenAPI Spec

Full contract at `lib/api-spec/openapi.yaml`. All types are generated from it — do not edit generated files directly.

To regenerate types after spec changes:
```
pnpm --filter @workspace/api-spec run codegen
```

---

## Stack Versions (gotchas)

- `lightweight-charts` **v5**: `chart.addSeries(CandlestickSeries, opts)` — NOT `addCandlestickSeries()`. Markers use `createSeriesMarkers(series, markers)` — NOT `series.setMarkers()`.
- `yahoo-finance2` **v3**: Must instantiate as `new YahooFinance({ suppressNotices: ['yahooSurvey'] })` — NOT the old `setGlobalConfig()` approach.
- `zod` **v4**: Uses `zod/v4` import path.
- Express **v5**: Async route errors propagate automatically (no try/catch needed in most routes).

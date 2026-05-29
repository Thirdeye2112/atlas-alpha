# Atlas Alpha — AI Review Guide

Institutional-grade quant trading signal platform. Bloomberg/Goldman-style dark dashboard built on Yahoo Finance (free, no API key). This document is written for AI reviewers who want to understand the system, identify improvement opportunities, and reason about the code without live access.

---

## Quick Start

Two services must be running (both started automatically via Replit workflows):

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

### Full stock analysis (core endpoint)
```
GET /api/stock/AAPL/analysis
GET /api/stock/NVDA/analysis
GET /api/stock/SPY/analysis
```
Returns `StockAnalysis` — quote, 6 indicator blocks, Atlas Alpha Score 0–100, chart signals, signal narrative. First call hits Yahoo Finance (~500–800ms), subsequent calls within 5 min are served from cache (<5ms).

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

### Scanner (8 categories, ~300-ticker universe)
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
First call takes 30–60s (parallelized batches of 20 across ~300 tickers). Cached 30 min.

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
│   │   │   ├── scannerUniverse.ts   ← ~300 tickers across all S&P 500 sectors + ETFs
│   │   │   └── cache.ts             ← node-cache (quotes: 1min, analysis: 5min, OHLCV: 5min, scanner: 30min)
│   │   └── routes/
│   │       ├── stock.ts             ← /stock/:ticker/analysis, /ohlcv, /historical-analysis
│   │       ├── scanner.ts           ← /scanner/* (parallel batch analysis, batchSize=20)
│   │       ├── watchlist.ts         ← /watchlist CRUD
│   │       └── market.ts            ← /market/overview
│   └── atlas-alpha/src/
│       ├── pages/
│       │   ├── Dashboard.tsx        ← 3-panel: watchlist sidebar, chart, score panel
│       │   ├── Scanner.tsx          ← 8-category scanner with sortable table
│       │   └── Watchlist.tsx        ← Persistent watchlist management
│       └── components/
│           ├── charts/LightweightChart.tsx  ← lightweight-charts v5: candlestick + MA lines + volume histogram + signal markers
│           ├── charts/ScoreGauge.tsx        ← Arc gauge for 0–100 score
│           └── charts/RsiMiniChart.tsx      ← Inline RSI sparkline
```

---

## Atlas Alpha Score — Composite Construction

```
Score = Trend(30%) + Momentum(20%) + Volume(15%) + Options(10%) + RelStrength(15%) + Regime(10%)
```

**Sub-scores:**
- **Trend (0–100):** SMA stack alignment (SMA20/50/100/200 + EMA8/21/34), golden/death cross, price vs SMA distances
- **Momentum (0–100):** RSI 14, MACD histogram/crossover, Stochastic 14/3, CCI, ROC, RSI divergence
- **Volume (0–100):** OBV trend, Chaikin Money Flow, relative volume vs 20-day avg, volume spikes
- **Options (0–100):** Proxy — volatility squeeze (BB inside Keltner), IV rank, put/call ratio when available
- **Relative Strength (0–100):** Mansfield-style multi-timeframe composite — 40% (1mo/21d) + 35% (3mo/63d) + 25% (6mo/126d) return vs SPY. Benchmarks fetched at 6mo to cover all windows.
- **Market Regime (0–100):** SPY SMA alignment score, fed in from SPY's own trend calculation

**Derived outputs:**
- `bullishProbability` = logistic function `1/(1+exp(-0.08*(score-50))) * 100` — calibrated: score 50→50%, 70→84%, 80→93%, 30→16%
- `bearishProbability` = `100 - bullishProbability`
- `confidenceScore` = `max(bullishCount, bearishCount) / 18 * 100` — agreement ratio across 18 independent signals
- `direction` = bullish if score ≥ 60, bearish if ≤ 40, else neutral
- `timeHorizon` = 1–3d if confidence > 80% + strong signal, 1–3m if weak confidence
- `riskScore` = `100 - confidence + (expectedMove > 5% ? 20 : 0)`

**Signal indicators (18 total, used for confidence):**
Bullish: strong/up trend direction, golden cross, RSI 50–70, MACD above signal, MACD bullish crossover, Stoch bullish, CCI > 0, ROC > 0, OBV rising, CMF > 0, volume spike with bullish score, options score > 60, unusual activity with bullish score, RS vs SPY > 0, price above SMA50, price above SMA200, RSI bullish divergence, RSI oversold signal.
The mirror set defines bearish signals. `rs.vsSpy > 2` double-count was removed; all 18 are independent.

---

## Chart Overlays

**Moving average lines** (computed in frontend from OHLCV data):
- SMA50 — orange solid
- SMA87 — purple solid (non-standard, user-requested)
- SMA200 — red solid (only visible on 1Y+ charts with 200+ bars)

**Price line stubs** (right-side labels from API analysis):
- BB+ / BB− — gray dotted (Bollinger 20,2 upper/lower)
- SUP / RES — green/red dashed (20-bar swing high/low)

**Volume histogram** (bottom 22% of chart):
- Green bars (close ≥ open) / Red bars (close < open)
- Uses a separate `volume` price scale with `scaleMargins: { top: 0.78, bottom: 0 }`

**Signal markers** (daily/weekly/monthly bars only, capped at 20):
- RSI↑ (strong bull) — RSI bounces back above 30 from oversold
- OB (moderate bull) — RSI enters overbought > 70
- RSI↓ (moderate bear) — RSI rolls back below 70
- OS (strong bear) — RSI enters oversold < 30
- BB↑ / BB↓ — price breaks outside Bollinger Band (last 20 bars only)
- BB↪ / BB↩ — price returns inside band — mean reversion confirmation (last 20 bars only)
- VOL (bull/bear) — volume spike > 2.5× 20-day avg

---

## Data Source Notes

- **All market data:** Yahoo Finance via `yahoo-finance2` v3 (free, no API key)
- **Rate limits:** Yahoo Finance is unofficial; heavy scanning can trigger throttling
- **Options data:** `yahoo-finance2` returns options chain data (strikes, OI, IV) but it is incomplete for many tickers — the system falls back to a volatility-based proxy when options chain is unavailable
- **Historical data:** Yahoo Finance provides adjusted OHLCV going back decades; quality degrades for very old data
- **Validation errors:** `yahoo-finance2` emits schema validation warnings for some tickers — logged but not fatal

---

## Known Limitations for Reviewers

1. **VWAP is not true VWAP** — `volume.vwap` in the API response is a volume-weighted moving average of daily closes (VWMA), not the intraday VWAP that resets each session. True VWAP requires tick/intraday data. VWAP is no longer rendered as a chart line (removed to avoid misleading display).

2. **Options score is largely proxy** — Real put/call ratio, max pain, and gamma levels are unavailable for most tickers via Yahoo Finance free tier. The options score falls back to a volatility-squeeze proxy. This is why the Options weight was reduced from 20% to 10% in scoring.

3. **Scanner first-load is slow** — Analyzing ~300 tickers in batches of 20 takes 30–60s on first load. All results are cached 30 min so subsequent requests within that window are instant. This is expected and acceptable behavior.

4. **Historical replay is best-effort** — Downloads last 2 years of data ending at `asOf` and recalculates indicators. Results may differ from live signals seen at that date due to adjusted prices and survivorship bias.

5. **No intraday signals** — Chart signal markers (RSI, BB, VOL) only appear on `1d`, `1wk`, and `1mo` intervals. Intraday charts (1m, 5m, 15m, 30m, 1h) display candles without markers.

6. **Market Regime score is SPY-centric** — The regime input is SPY's own `trendAlignmentScore`, which is a 0–100 alignment of price vs 7 moving averages. It does not incorporate VIX or breadth data, despite those being available in the market overview endpoint.

7. **Scanner universe is static** — ~300 tickers hardcoded in `scannerUniverse.ts`. No custom universe or dynamic S&P 500 membership support.

---

## OpenAPI Spec

Full contract at `lib/api-spec/openapi.yaml`. All types are generated from it — do not edit generated files directly.

To regenerate types after spec changes:
```
pnpm --filter @workspace/api-spec run codegen
```

---

## Stack Versions (gotchas)

- `lightweight-charts` **v5**: `chart.addSeries(CandlestickSeries, opts)` — NOT `addCandlestickSeries()`. Markers via `createSeriesMarkers(series, markers)` — NOT `series.setMarkers()`. Volume histogram uses `HistogramSeries` with `priceScaleId: 'volume'`.
- `yahoo-finance2` **v3**: Must instantiate as `new YahooFinance({ suppressNotices: ['yahooSurvey'] })` — NOT the old `setGlobalConfig()` approach.
- `zod` **v4**: Uses `zod/v4` import path.
- Express **v5**: Async route errors propagate automatically (no try/catch needed in most routes).

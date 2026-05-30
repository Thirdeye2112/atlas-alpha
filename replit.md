# Atlas Alpha

Institutional-grade quant trading signal platform — Bloomberg/Goldman-style dark dashboard for technical analysis, scanner signals, backtest research, and watchlist management. Uses Yahoo Finance (free, no API key) as the primary data source.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080 → proxied at `/api`)
- `pnpm --filter @workspace/atlas-alpha run dev` — run the frontend (port 20959 → proxied at `/`)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM (watchlist persistence)
- Validation: Zod (`zod/v4`), `drizzle-zod`
- Market data: `yahoo-finance2` v3 (requires `new YahooFinance({ suppressNotices: ['yahooSurvey'] })` — class instantiation)
- Technical analysis: `technicalindicators` (RSI, MACD, Bollinger Bands, ATR, Stochastic, OBV, Williams %R, VWAP, ADX)
- Caching: `node-cache` — quotes: 1 min, analysis: 5 min, OHLCV: 15 min, scanner: 30 min, market: 1 min, backtest: 1 hour
- Charts: `lightweight-charts` v5 (use `chart.addSeries(CandlestickSeries, ...)` — not `addCandlestickSeries`)
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)
- Logging: pino (`req.log` in route handlers, `logger` singleton elsewhere — never `console.log` in server code)

## Where things live

- `lib/api-spec/openapi.yaml` — OpenAPI spec, source of truth for all endpoints
- `lib/api-client-react/src/generated/` — Orval-generated React Query hooks + Zod schemas
- `lib/db/src/schema/watchlist.ts` — Drizzle schema for watchlist table
- `artifacts/api-server/src/routes/` — Express routes:
  - `stock.ts` — `/api/stock/:ticker/analysis`, `/api/stock/:ticker/ohlcv`
  - `scanner.ts` — all 13 `/api/scanner/*` endpoints
  - `watchlist.ts` — `/api/watchlist` CRUD
  - `market.ts` — `/api/market/overview` (quotes + regime + breadth)
  - `backtest.ts` — `/api/backtest/ic`, `/api/backtest/multi`
  - `research.ts` — `/api/research/gap-analysis`
  - `health.ts` — `/api/healthz`
- `artifacts/api-server/src/lib/` — backend engine:
  - `marketData.ts` — yahoo-finance2 wrapper
  - `indicators.ts` — RSI, MACD, BB, ATR, OBV, Williams %R, VWAP, ADX
  - `scoring.ts` — Atlas Alpha Score computation (0–100 composite)
  - `analysisEngine.ts` — full stock analysis orchestrator
  - `backtestEngine.ts` — walk-forward IC backtest engine
  - `calibrationStore.ts` — logistic regression calibration (score → P(positive return))
  - `gapAnalysis.ts` — gap precursor statistical research engine
  - `scanJob.ts` — background scanner job runner
  - `scannerUniverse.ts` — 373-ticker universe (large/mid-cap, ETFs, leveraged ETFs)
  - `cache.ts` — node-cache instances
  - `dbCache.ts` — database-level caching
  - `warmup.ts` — cache warmup on startup
- `artifacts/atlas-alpha/src/pages/` — React frontend pages:
  - `Dashboard.tsx` — main 3-panel dashboard
  - `Scanner.tsx` — market scanner with 13 tabs
  - `Watchlist.tsx` — watchlist management
  - `Research.tsx` — gap precursor analysis page
  - `BacktestLab.tsx` — full backtest lab

## Architecture decisions

- **Contract-first API**: OpenAPI spec drives codegen; server validates with Zod, client uses generated React Query hooks
- **yahoo-finance2 v3**: Must use `new YahooFinance({ suppressNotices: ['yahooSurvey'] })` — the default import is the class, not a pre-instantiated object
- **lightweight-charts v5**: Series creation changed from `chart.addCandlestickSeries()` to `chart.addSeries(CandlestickSeries, options)`
- **Scanner architecture**: 373 tickers analyzed in parallel batches; results cached 30 min. All 13 tab endpoints share a single background scan job.
- **Atlas Alpha Score**: Composite 0–100 from 6 sub-scores (trend, momentum, volume, options-proxy, relative strength, market regime) plus exhaustion, confidence, risk, and gap-probability overlays — see `scoring.ts`
- **Backtest engine**: Walk-forward, candle-by-candle Rank IC (Spearman correlation between score and forward return). Logistic regression calibrates score → probability of positive return. Cached 1 hour per ticker+horizon.
- **Market overview**: `/api/market/overview` returns `spy/qqq/iwm/vix` objects + `marketRegime` + `pctAboveSma50`/`pctAboveSma200` breadth + ADX + realized vol.

## Product

- **Dashboard** (`/`): 3-panel layout — watchlist/scanner sidebar, candlestick chart with full timeframe suite (1D/5D/1M/3M/6M/1Y/2Y/5Y/ALL), Atlas Alpha Score gauge with 10 sub-scores and AI signal narrative. Chart section includes an inline **ChartBacktestStrip** (quick-run backtest for the loaded ticker, shows Rank IC / t-stat / obs / signal mode / P(+) / bull hit rate without leaving the dashboard). Ticker-click from sidebar auto-loads on dashboard.
- **Scanner** (`/scanner`): 13 categories across 373 tickers — High Prob Longs, High Prob Shorts, Breakouts, Breakdowns, Gap Setup Long, Gap Setup Short, Gap Up, Gap Down, Gamma Squeeze, Short Squeeze, Institutional Accumulation, Mean Reversion, Key S/R Levels. Each tab has a **RUN BACKTEST (5D)** button that batch-fetches IC data for all results and adds a sortable **IC 5D** column.
- **Watchlist** (`/watchlist`): Persistent PostgreSQL watchlist — add/remove tickers, enriched with live price/change/score/direction.
- **Backtest Lab** (`/backtest`): Full 2Y walk-forward IC analysis per ticker. Selectable horizons (1D/5D/10D/20D). Score timeline chart (score line + forward-return histogram with auto-calibrated dot sizing by magnitude and color by outcome). IC by horizon bars, score bucket performance (bull/neutral/bear hit rates and avg returns), score↔return scatter plot. Auto-runs when navigated to with `?ticker=X`.
- **Research** (`/research`): Gap precursor analysis across all 373 tickers. Shows factor effect sizes for gap-up vs gap-down events (ATR%, BB width, RVOL, SMA distance, RSI momentum, etc.) vs baseline. Setup filter backtest: how often the ATR≥3.2% + BB≥15% + RVOL≥1.2× filter precedes a gap, lift ratio, and avg gap magnitude.
- **Market bar** (global): Live SPY/QQQ/IWM/VIX prices + market regime (RISK ON / RISK OFF / NEUTRAL) + breadth (% of stocks above SMA50 and SMA200).

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- `yahoo-finance2` v3: `setGlobalConfig` is gone; suppress notices via constructor option
- `lightweight-charts` v5: `addCandlestickSeries` removed; use `chart.addSeries(CandlestickSeries, opts)`
- Scanner first load takes ~15–30s (analyzing 373 tickers); subsequent loads within 30 min are instant from cache
- OHLCV `time` field must be a `YYYY-MM-DD` string for lightweight-charts v5 (not a Unix timestamp)
- Do not run `pnpm dev` at workspace root; use the workflows
- Analysis response shape: `direction`, `timeHorizon`, `expectedMovePercent`, etc. live inside `d.atlasScore`, not at the top level. Top-level keys are: `quote`, `atlasScore`, `trend`, `momentum`, `volume`, `volatility`, `options`, `patterns`, `relativeStrength`, `regimeIndicators`, `exhaustion`, `chartSignals`, `cachedAt`, `calibration`
- Market endpoint is `/api/market/overview` (not `/api/market/quotes`); returns `{ spy, qqq, iwm, vix, marketRegime, pctAboveSma50, pctAboveSma200, ... }`
- Backtest IC rating ("strong"/"moderate"/"noise") reflects magnitude only, not direction. A strong negative IC means a strong contrarian signal — use the `rankIC` sign and the MOMENTUM/CONTRARIAN badge to communicate direction.
- Backtest cache TTL is 1 hour per ticker+horizon — changing the backtest engine requires a server restart to see fresh results

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details

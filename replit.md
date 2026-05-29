# Atlas Alpha

Institutional-grade quant trading signal platform — Bloomberg/Goldman-style dark dashboard for technical analysis, scanner signals, and watchlist management. Uses Yahoo Finance (free, no API key) as the primary data source.

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
- Market data: `yahoo-finance2` v3 (requires `new YahooFinance()` — class instantiation)
- Technical analysis: `technicalindicators` (RSI, MACD, Bollinger Bands, ATR, Stochastic, OBV, Williams %R, VWAP, ADX)
- Caching: `node-cache` (quotes: 5 min TTL, OHLCV: 15 min, scanner: 10 min)
- Charts: `lightweight-charts` v5 (use `chart.addSeries(CandlestickSeries, ...)` — not `addCandlestickSeries`)
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/` — OpenAPI spec (`openapi.yaml`) — source of truth for all endpoints
- `lib/api-client-react/src/generated/` — Orval-generated React Query hooks + Zod schemas
- `lib/db/src/schema/watchlist.ts` — Drizzle schema for watchlist table
- `artifacts/api-server/src/lib/` — backend engine: `marketData.ts`, `indicators.ts`, `scoring.ts`, `analysisEngine.ts`, `scannerUniverse.ts`, `cache.ts`
- `artifacts/api-server/src/routes/` — Express routes: `stock.ts`, `scanner.ts`, `watchlist.ts`, `market.ts`
- `artifacts/atlas-alpha/src/` — React frontend: pages (`Dashboard`, `Scanner`, `Watchlist`), components

## Architecture decisions

- **Contract-first API**: OpenAPI spec drives codegen; server validates with Zod, client uses generated React Query hooks
- **yahoo-finance2 v3**: Must use `new YahooFinance({ suppressNotices: ['yahooSurvey'] })` — the default import is the class, not a pre-instantiated object
- **lightweight-charts v5**: Series creation changed from `chart.addCandlestickSeries()` to `chart.addSeries(CandlestickSeries, options)`
- **Scanner architecture**: ~80 tickers analyzed in parallel batches of 10; results cached 10 min to avoid re-scanning on every tab switch
- **Atlas Alpha Score**: Composite 0–100 score from 6 sub-scores (trend, momentum, volume, options-proxy, relative strength, market regime) — see `scoring.ts`

## Product

- **Dashboard**: 3-panel layout — watchlist/scanner sidebar, candlestick chart with period/interval controls, Atlas Alpha Score gauge with 8 sub-scores and signal narrative
- **Scanner**: 8 categories — High Prob Longs, High Prob Shorts, Breakouts, Breakdowns, Gamma Squeeze, Short Squeeze, Institutional Accumulation, Mean Reversion
- **Watchlist**: Persistent per-session watchlist (PostgreSQL), add/remove tickers, click to analyze on dashboard
- **Market bar**: Live SPY/QQQ/IWM/VIX quotes + market regime classification (RISK ON / RISK OFF / NEUTRAL)

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- `yahoo-finance2` v3: `setGlobalConfig` is gone; suppress notices via constructor option
- `lightweight-charts` v5: `addCandlestickSeries` removed; use `chart.addSeries(CandlestickSeries, opts)`
- Scanner first load takes ~15–20s (analyzing ~80 tickers); subsequent loads within 10 min are instant from cache
- OHLCV `time` field must be a `YYYY-MM-DD` string for lightweight-charts v5 (not a timestamp)
- Do not run `pnpm dev` at workspace root; use the workflows

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details

# Atlas Alpha — Full Platform Code Review

**Date:** 2026-06-02
**Scope:** Full platform — scoring, indicators, analysis, backtest, market data, scanner, paper trading, bot intelligence, API routes, frontend, DB schema, architecture
**Verdict: CONDITIONAL PASS** — 3 bugs fixed during review; 2 architectural limitations flagged for future work

---

## Top 10 Findings (Critical First)

| # | Severity | Subsystem | Finding | Status |
|---|---|---|---|---|
| 1 | ❌ Critical | Bot Intelligence | Calibration gate compared `probPositive` (0–100) to `0.52`/`0.48` (0–1 scale) — gate never blocked any entry | **Fixed** |
| 2 | ❌ Critical | Bot Intelligence | Stop-multiplier math inverted — widening categories (breakout, gamma squeeze) were actually tightening stops | **Fixed** (prior session) |
| 3 | ⚠️ Medium | Indicators | `calcChartSignals` MACD zero-cross: `!curr.histogram` is falsy when histogram === 0, skipping exact zero-crossing signals | **Fixed** |
| 4 | ⚠️ Medium | Calibration Store | Store keyed by `ticker` only; DB has entries per `ticker:horizon`. Last-written horizon wins non-deterministically on startup | Noted — architectural refactor needed |
| 5 | ⚠️ Medium | Bot Intelligence | Self-learning no-ops silently when `entryCriteria` is empty — adaptation logged but config unchanged | **Fixed** (prior session) |
| 6 | ⚠️ Medium | Scheduler | ET DST detection used `getTimezoneOffset()` heuristic — wrong on UTC hosts during EST→EDT transitions | **Fixed** (prior session) |
| 7 | ⚠️ Medium | DB Schema | `paper_trades`, `signal_log`, `alerts` tables missing indexes on high-frequency query columns (`status`, `ticker`, `createdAt`) | Noted — add before scaling |
| 8 | ⚠️ Low | API Routes | Bot control endpoints (`/bot/run`, `/bot/config`, `/bot/self-learn`) are unauthenticated | Acceptable for paper trading; needs auth before real-money use |
| 9 | ⚠️ Low | Backtest Engine | No explicit look-ahead bias guard — `rankIC` uses the full bar array; care needed if entry/exit timestamps are ever intraday | Acceptable for daily bars |
| 10 | ⚠️ Low | Market Data | `MMC`, `PARA`, `MRO`, `HES`, `ANSS` consistently fail Yahoo Finance fetch (likely delisted/renamed) — warmup logs noise on every restart | Remove from universe |

---

## Subsystem Ratings

### 1. Scoring Engine (`scoring.ts`) — ⚠️ Sound with notes
- 6 sub-scores (trend, momentum, volume, options-proxy, relative strength, market regime) combine into a 0–100 composite
- Weight rationale is documented and backed by IC²-analysis (RS raised from 13→20%, regime lowered from 8→4%)
- `confidenceScore` and `riskScore` overlays are well-reasoned
- `calcAtlasScore` accepts optional `ScoreOpts` allowing IC-optimal weight overrides — clean adaptive design
- **Note:** Options score is a proxy (no live options data) — labeling it `optionsScore` overstates its signal value; consider renaming `optionsProxyScore` in user-facing strings

### 2. Technical Indicators (`indicators.ts`) — ⚠️ Sound with one bug fixed
- RSI, MACD, Bollinger Bands, ATR, Stochastic, OBV, Williams %R, VWAP, ADX all use the `technicalindicators` library with correct parameterization
- `calcMomentum`: MACD crossover uses `(prevMacd.MACD ?? 0) < (prevMacd.signal ?? 0)` — safe null handling ✅
- `calcChartSignals`: **Fixed** — MACD zero-cross `!curr.histogram` falsy check now uses `== null`
- `calcPatterns`: Bull/bear flag detection uses `poleNetMove` (not H-L range) for target projection — correct ✅
- VWAP is computed on intraday bars when available; falls back gracefully ✅
- Pivot RSI divergence uses `findPivotLows`/`findPivotHighs` helpers — solid implementation

### 3. Analysis Engine (`analysisEngine.ts`) — ✅ Sound
- Clean orchestration: `runFullAnalysis` fetches quote + OHLCV in parallel, then pipelines all indicator calculations
- Error handling: per-ticker failures in warmup are caught with `allSettled` — warmup never crashes the server ✅
- Caching: 5-min TTL for analysis results, 15-min for OHLCV, 1-min for quotes — reasonable hierarchy
- `cachedAt` timestamp propagated to response so clients can show data age ✅

### 4. Backtest Engine (`backtestEngine.ts`) — ⚠️ Sound with notes
- Walk-forward Rank IC (Spearman) is the correct methodology for evaluating ordinal score quality ✅
- IS/OOS split properly holds out the most recent 20% of bars ✅
- Logistic regression calibration (score → P(positive return)) uses OOS Brier score for evaluation ✅
- `brierScore` persisted to `calibration_models` — enables model tracking over time ✅
- **Note:** No look-ahead bias at the daily bar level since scores are computed on the close and returns measured on the next close. Safe for daily use.
- **Note:** Cache TTL is 1 hour per `ticker:horizon`. Changing the scoring engine requires a server restart to invalidate stale backtest results.

### 5. Market Data Layer (`marketData.ts`) — ⚠️ Sound with notes
- `yahoo-finance2` v3 instantiated correctly: `new YahooFinance({ suppressNotices: ['yahooSurvey'] })` ✅
- Retry logic: 3 attempts with exponential backoff ✅
- OHLCV fallback chain: DB store → Yahoo (direct) — `weekly`/`monthly` correctly bypass the DB store ✅
- `fetchQuote` returns `undefined` for delisted symbols causing `Cannot read properties of undefined (reading 'symbol')` — this is caught upstream but logs noise
- **Action:** Remove `MMC`, `PARA`, `MRO`, `HES`, `ANSS` from the scanner universe (confirmed delisted/renamed)

### 6. Scanner (`scanJob.ts` + routes) — ✅ Sound
- 373-ticker universe analyzed in parallel batches with concurrency limiting ✅
- All 14 category endpoints share a single background scan job — efficient, avoids redundant reanalysis ✅
- 30-min cache with `staleWhileRevalidate` pattern — users get instant results after first load ✅
- `lightMode: true` in scan job skips `marketCycle` calculation appropriately (expensive, not needed for ranking) ✅
- Scanner RUN BACKTEST (5D) button batch-fetches IC for all results — correct use of the backtest cache ✅
- **Reversal Short Detection** added as the 14th endpoint (`/api/scanner/reversal-short`) — structural exhaustion signals (double top, distribution top, H&S, parabolic rise, RSI divergence, BB extension, wick rejection) scored 0–100 with conviction tiers (FORMING ≥45 / CONFIRMED ≥60 / EXTENDED ≥78) ✅
- Frontend restructured from 14 individual tabs to 4 logical groups: **▲ LONG IDEAS** (7 signal chips: HIGH PROB, BREAKOUTS, GAP SETUP ↑, GAP UP ↑, INST ACCUM, SQUEEZE, MEAN REV) · **▼ SHORT IDEAS** (6 chips: HIGH PROB, BREAKDOWNS, GAP SETUP ↓, GAP DOWN ↓, GAMMA SQUEEZE, ⚠ REVERSAL) · **KEY LEVELS** · **✦ CUSTOM SCAN** ✅

### 7. Paper Trading Engine (`paperTradingEngine.ts`) — ⚠️ Sound after fixes
- Entry/exit logic is clean: `runBotCycle` → evaluate exits → evaluate entries ✅
- `calcEntryLevels` computes ATR-based stop/target with 3:1 R:R — correct ✅
- Trailing stop activates after price crosses 33% toward target — reasonable implementation ✅
- **Fixed:** Stop-multiplier math was inverted (see finding #2) — now uses `riskDist = entryPrice - stopPrice`
- Position sizing respects `maxPositions` and `positionSizePct` caps ✅
- `peakPrice` tracked per position for trailing stop — correct ✅

### 8. Bot Intelligence + Scheduler — ⚠️ Sound after fixes
- **Fixed:** Calibration gate probability scale (0–100 vs 0–1) — was never blocking any entry
- **Fixed:** Self-learning mutex prevents concurrent adaptation runs
- **Fixed:** Self-learning injects `score ≥` criterion when none exists
- **Fixed:** Scheduler uses `Intl.DateTimeFormat` with `America/New_York` — DST-safe on any host
- Market regime gate logic (RISK OFF block, breadth-based score floor) is sound ✅
- Sim gate bucket matching by score × RSI zone is reasonable ✅
- Background enhancement loop (5-min) with per-step error isolation ✅
- **Architectural note:** Calibration store is keyed by `ticker` only. DB entries exist per `ticker:horizon`; the last horizon processed on startup wins for a given ticker. For the bot (which uses horizon=5), this is usually fine since 5D is most frequently fitted — but should be refactored to `ticker:horizon` keying for correctness.

### 9. API Routes — ⚠️ Needs attention
- Stock and watchlist routes use Zod validation for inputs/outputs ✅
- Scanner, bot, and research routes do not use Zod — rely on manual parsing
- All routes use `req.log` (pino) — no raw `console.log` in server code ✅
- Error responses are consistent (`{ error: string }`) ✅
- Bot control surface is unauthenticated — acceptable for single-user paper trading, must be addressed before multi-user or real-money deployment
- **Recommendation:** Add Zod guards to bot and scanner routes for consistency with the contract-first design

### 10. Frontend Pages — ⚠️ Generally sound
- **Nav** pruned to 4 items: Dashboard | Scanner | Lab | Bot Lab — Watchlist and Research removed from the nav bar (still accessible via direct URL); WatchlistSidebar footer now shows SCANNER + CSV IMPORT / MANAGE links ✅
- `Dashboard.tsx`: candlestick chart uses `chart.addSeries(CandlestickSeries, ...)` (v5 API) ✅; `ChartBacktestStrip` inline backtest is well-integrated ✅
- `Scanner.tsx`: 4-group tab layout (▲ LONG IDEAS / ▼ SHORT IDEAS / KEY LEVELS / ✦ CUSTOM SCAN) with inline signal picker chips within LONG and SHORT groups — replaces the previous 14-tab flat structure. React Query cache usage unchanged ✅
- `BacktestLab.tsx`: IC BACKTEST | RESEARCH mode switcher at the top of the header. In IC BACKTEST mode: score timeline, IC bars, scatter plot, bucket hit rates, auto-run on `?ticker=X` — unchanged ✅. In RESEARCH mode: embeds `Research.tsx` (gap precursor analysis) inline — no separate nav item needed ✅
- `BotLab.tsx`: Intelligence panel live countdown (`useCountdown` hook), category badges, adaptation log ✅; `⚠ REVERSAL` badge shown on open long positions when `reversalRisk.score ≥ 45` ✅
- `BotLab.tsx` Positions table: all numeric columns now sortable (TICKER, ENTRY, CURRENT, P&L, SCORE, HOLD) — default sort by P&L descending; ↑/↓ on active column, faint ↕ on inactive ✅
- `BotLab.tsx`: Stale intelligence data possible between 30s poll intervals — acceptable for monitoring UI
- `Analysis response shape gotcha`: `direction`, `timeHorizon`, `expectedMovePercent` live inside `d.atlasScore`, not top-level — documented in replit.md, several pages handle this correctly ✅

### 11. Database Schema — ⚠️ Missing indexes
- Drizzle schema is clean; Zod types generated via `drizzle-zod` ✅
- `paper_trades`: frequent queries by `.status` and `.ticker` — **no indexes on these columns**
- `signal_log`: queried by `ticker` and `createdAt` for analytics — **no index**
- `alerts`: filtered by `active` and `ticker` on every poll — **no index**
- `bot_adaptation_log`: small table, fine as-is
- `calibration_models`: queried by `ticker` + `scoreVersion` + `horizon` — **no composite index**
- **Action:** Add indexes before the tables grow beyond ~10k rows

### 12. Overall Architecture — ✅ Sound design
- Contract-first API (OpenAPI → Orval codegen) enforces schema discipline between server and client ✅
- Caching hierarchy is well-designed: quotes (1m) < market (1m) < analysis (5m) < OHLCV (15m) < scanner (30m) < backtest (1h) ✅
- Dependency chain is linear and safe: `botIntelligence → paperTradingEngine → botScheduler → index` — no circular imports ✅
- DB + in-memory hybrid cache (node-cache + dbCache) provides resilience across restarts ✅
- All server logging goes through `pino` (req.log in routes, logger singleton elsewhere) — no `console.log` in server code ✅
- `yahoo-finance2` is the only data source — zero external API cost, but single point of failure for all market data
- **Scalability note:** 373-ticker warmup on startup adds ~2–3 min latency before cache is hot; acceptable for current scale

---

## Missing DB Indexes (Action Required)

```sql
-- paper_trades
CREATE INDEX ON paper_trades(status);
CREATE INDEX ON paper_trades(ticker);
CREATE INDEX ON paper_trades(exit_at DESC) WHERE status = 'closed';

-- signal_log
CREATE INDEX ON signal_log(ticker, created_at DESC);

-- alerts
CREATE INDEX ON alerts(ticker) WHERE active = true;

-- calibration_models
CREATE INDEX ON calibration_models(ticker, horizon, score_version, fitted_at DESC);
```

---

## Delisted Tickers to Remove from Universe

`MMC`, `PARA`, `MRO`, `HES`, `ANSS` — consistently returning "No data found" from Yahoo Finance on every warmup. Remove from `scannerUniverse.ts`.

---

## Typecheck Status (Post-fixes)

```
artifacts/api-server     ✅ 0 errors
artifacts/atlas-alpha    ✅ 0 errors
artifacts/mockup-sandbox ✅ 0 errors
scripts                  ✅ 0 errors
```

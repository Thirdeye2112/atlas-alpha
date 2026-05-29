# Atlas Alpha — AI Review Guide (v2)

Institutional-grade quant trading signal platform. Bloomberg/Goldman-style dark dashboard built on Yahoo Finance (free, no API key). This document is written for AI reviewers who want to understand the system, identify improvement opportunities, and reason about the code without live access.

---

## Quick Start

Two services must be running:

| Service             | Port  | Path |
|---------------------|-------|------|
| Express API         | 8080  | /api |
| Vite React frontend | 20959 | /    |

All traffic routes through a shared reverse proxy on `localhost:80`.

---

## Live API — Test Endpoints

```
GET  /api/healthz
GET  /api/stock/AAPL/analysis
GET  /api/stock/AAPL/ohlcv?period=3mo&interval=1d
GET  /api/stock/AAPL/historical-analysis?asOf=2026-01-15
GET  /api/scanner/top-longs
GET  /api/scanner/top-shorts
GET  /api/scanner/breakouts
GET  /api/scanner/breakdowns
GET  /api/scanner/gamma-squeeze
GET  /api/scanner/short-squeeze
GET  /api/scanner/institutional-accumulation
GET  /api/scanner/mean-reversion
GET  /api/watchlist
POST /api/watchlist          body: {"ticker":"TSLA"}
DELETE /api/watchlist/TSLA
GET  /api/market/overview
GET  /api/backtest/ic?ticker=AAPL&horizon=10
```

Scanner first call: 30–60s (300 tickers, batches of 20). Cached 30 min.
Backtest first call: 10–25s (2-year walk-forward computation). Cached 1 hr.

---

## Atlas Alpha Score

```
Score = Trend(30%×gate) + Momentum(20%×gate) + Volume(15%) + VolSqueeze(10%) + RelStrength(15%) + Regime(10%)
```

### Regime Gate (v2 — new)
Trend and Momentum are multiplied by a gate factor derived from the market regime score.
This reduces false signals in choppy or fearful markets where momentum-following underperforms.

| Regime Score | Gate | Effect |
|---|---|---|
| < 35 (risk-off) | 0.70 | −30% on trend + momentum |
| < 50 (neutral)  | 0.85 | −15% on trend + momentum |
| ≥ 50 (risk-on)  | 1.00 | No dampening |

### Sub-scores (0–100 each)

**Trend:** Price alignment above SMA20/50/100/200 + EMA8/21/34.
`score = (count above / 7) × 100`. Golden/death cross detection as bonus signals.

**Momentum:** RSI14 deviation from 50 (±25 pts), MACD above/below signal (±8 pts), Stoch K vs D (±5 pts), CCI directional (±10 pts), ROC sign (±10 pts), MACD crossover bonus (±5 pts), RSI divergence bonus (±5 pts).

**Volume:** OBV trend rising/flat/falling, Chaikin Money Flow (CMF), relative volume vs 20-day average, accumulation/distribution line direction.

**Volatility Squeeze (renamed from "Options"):** Bollinger Bands inside Keltner Channels = true compression. Score reflects squeeze intensity and direction. This is a proxy — no real options data available from Yahoo Finance free tier.

**Relative Strength:** Mansfield multi-timeframe RS vs SPY:
`40% × (21-day return vs SPY) + 35% × (63-day) + 25% × (126-day)`.
Also computed vs QQQ and IWM for cross-benchmark context.

**Market Regime (v2 — enhanced):** Three-factor composite computed on SPY's 1-year daily bars:
- 50% SPY SMA alignment score (price above key MAs)
- 30% realized vol state: `100 − vol_percentile` (low vol = calm = high score)
- 20% ADX(14): `clamp((ADX − 15) × 5)` — ADX 35 → 100, ADX 15 → 0

VIX override: if VIX > 30, force market regime to risk_off (cap score at 30) regardless of trend.

### Confidence (v2 — fixed)

Previous implementation counted `max(bullSignals, bearSignals) / 18` — which rewarded redundancy (18 correlated momentum indicators all firing the same direction inflated confidence).

New implementation uses **category-level agreement across 5 orthogonal buckets**:
```
bullCats = count of: [trend>60, momentum>60, volume>60, rs>60, regime>60]
bearCats = count of: [trend<40, momentum<40, volume<40, rs<40, regime<40]
confidenceScore = max(bullCats, bearCats) / 5 × 100
```
Maximum possible is 100% (all 5 categories aligned). A 3/5 score = 60% confidence.

### Probability Mapping
```
bullishProbability = 1 / (1 + exp(−0.08 × (score − 50))) × 100
```
Score 50→50%, 70→84%, 80→93%, 30→16%.

**Limitation:** The slope (0.08) and midpoint (50) are unvalidated heuristics. Should be fit via logistic regression on actual score→forward return data.

---

## Walk-Forward Backtest (v2 — new)

Endpoint: `GET /api/backtest/ic?ticker=AAPL&horizon=10`

### Algorithm (chronological, no look-ahead)
1. Fetch 2 years of daily OHLCV for ticker + SPY + QQQ + IWM
2. Walk forward from bar 210 (SMA200 warmup) to bar N−horizon
3. At each step: compute full Atlas Alpha score using **only data available at that moment** (sliced arrays)
4. Record the actual forward return N days later
5. Compute Pearson IC (score vs forward return), bucket hit rates, scatter data

### Response
```json
{
  "ic": -0.093,
  "icRating": "moderate",
  "totalObservations": 282,
  "bull": { "count": 139, "hitRate": 60, "avgReturn": 1.38 },
  "neutral": { "count": 54, "hitRate": 57, "avgReturn": 0.91 },
  "bear": { "count": 89, "hitRate": 45, "avgReturn": 2.02 },
  "scatter": [{ "x": 81, "y": 3.2, "date": "2025-09-14" }, ...]
}
```

`icRating`: "strong" (|IC|≥0.10), "moderate" (≥0.05), "weak" (≥0.02), "noise" (<0.02)

### Interpretation Notes
- IC = Pearson correlation between score and forward return. Positive = score predicts returns. Negative = mild contrarian effect (score high when stock is extended/mean-reversion prone).
- AAPL shows IC = −0.093 at 10-day horizon. Large-caps that have already moved tend to revert. Test on mid/small-cap momentum names where trend-following is stickier.
- Hit rate of 60% when score ≥ 60 means: in 60% of bull-signal days, the stock was higher N days later. Baseline (neutral) is typically 52–55% for equities (long-term upward drift).
- Cached 1 hour in memory. Cleared on server restart.

---

## Chart Overlays

**Moving averages** (frontend, from OHLCV): SMA50 orange, SMA87 purple, SMA200 red (1Y+ only)

**Price lines** (API): BB+ gray dotted, BB− gray dotted, SUP green dashed, RES red dashed

**Volume histogram**: bottom 22% of chart, green (up day) / red (down day) bars

**Signal markers** (1d/1wk/1mo only, capped at 20 most recent):
- `RSI↑` strong bull — RSI bounces back above 30
- `OB` moderate bull — RSI enters overbought (>70)
- `RSI↓` moderate bear — RSI rolls back below 70
- `OS` strong bear — RSI enters oversold (<30)
- `BB↑` / `BB↓` — Bollinger breakout/breakdown (last 20 bars only)
- `BB↪` / `BB↩` — mean reversion back inside band (last 20 bars only)
- `VOL` — volume spike >2.5× 20-day average

---

## Architecture

```
pnpm monorepo
├── lib/
│   ├── api-spec/openapi.yaml           ← Source of truth for all endpoints
│   ├── api-client-react/generated/     ← Orval React Query hooks + Zod schemas
│   └── db/schema/watchlist.ts          ← Drizzle ORM (PostgreSQL watchlist)
└── artifacts/
    ├── api-server/src/lib/
    │   ├── marketData.ts               ← yahoo-finance2 wrapper (fetchQuote, fetchOHLCV)
    │   ├── indicators.ts               ← All TA: calcTrend, calcMomentum, calcVolume,
    │   │                                  calcVolatility, calcOptions, calcRelativeStrength,
    │   │                                  calcRegimeIndicators (ADX + realized vol), calcChartSignals
    │   ├── scoring.ts                  ← Atlas Alpha compositor, confidence, regime gate, narrative
    │   ├── analysisEngine.ts           ← Orchestrates full analysis, caches 5 min
    │   ├── scannerUniverse.ts          ← ~300 tickers
    │   └── cache.ts                    ← NodeCache: analysis 5min, OHLCV 15min, scanner 30min, backtest 1hr
    └── api-server/src/routes/
        ├── stock.ts                    ← /analysis, /ohlcv, /historical-analysis
        ├── scanner.ts                  ← /scanner/* (8 categories, batch=20)
        ├── market.ts                   ← /market/overview (SPY/QQQ/IWM/VIX + enhanced regime)
        ├── watchlist.ts                ← CRUD (PostgreSQL, session-scoped)
        └── backtest.ts                 ← /backtest/ic (walk-forward IC, 1yr cache)
```

---

## Known Limitations

1. **VWAP is VWMA** — Yahoo free tier = daily bars only. True VWAP requires intraday tick data. Removed from chart overlays to avoid misleading display.

2. **Vol Squeeze (Options) is fully synthetic** — `putCallRatio`, `maxPain`, `callWall`, `putWall`, `gammaFlipLevel` are all null in the response. Score is purely BB-inside-Keltner compression. Weight reduced to 10%.

3. **Scanner cache is in-memory** — Cleared on server restart. No disk persistence. First-load penalty is 30–60s.

4. **Logistic slope unvalidated** — The `0.08` slope is a heuristic, not regression-fit on actual return distributions. Should be calibrated on `score → actual N-day return` data from the backtest endpoint.

5. **Adjusted prices** — Signal computation uses adjusted OHLC. Splits/dividends retroactively change historical bar values, so historical-replay scores differ from what traders saw in real time.

6. **No sector breadth** — Regime score doesn't include breadth (% of stocks above SMA50/200). The 300-ticker universe could be used to compute this, but would require a full scan pass as a prerequisite.

7. **Pearson IC, not Spearman** — Pearson assumes linear relationship. Spearman rank IC is more robust for fat-tailed equity return distributions. Not implemented.

8. **No IC-weighted scoring** — The 30/20/15/10/15/10 weight split is heuristic. True factor IC weighting would require regression of each category's standalone predictive power vs actual forward returns.

9. **Static ticker universe** — ~300 hardcoded tickers. No dynamic S&P 500 membership, no survivorship bias correction.

10. **No intraday markers** — Chart signal markers appear only on 1d/1wk/1mo intervals.

---

## Stack (gotchas for AI reviewers)

- **lightweight-charts v5**: `chart.addSeries(CandlestickSeries, opts)` — NOT `addCandlestickSeries()`. Markers via `createSeriesMarkers(series, markers)`.
- **yahoo-finance2 v3**: `new YahooFinance({ suppressNotices: ['yahooSurvey'] })` — NOT `setGlobalConfig()`.
- **zod v4**: import from `'zod/v4'`.
- **Express v5**: async route errors auto-propagate (no try/catch needed).
- **pnpm monorepo**: Do NOT run `pnpm dev` at workspace root. Use per-package commands or Replit workflows.
- **technicalindicators**: RSI, MACD, BollingerBands, EMA, SMA, Stochastic, CCI, ROC, OBV, ATR, ADX all confirmed available.

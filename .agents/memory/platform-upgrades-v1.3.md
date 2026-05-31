---
name: Platform upgrades v1.3
description: Key decisions and gotchas from the May 2026 Atlas Alpha platform upgrade (regime v1.3, IS/OOS, alerts, AI narrative).
---

## Regime indicator v1.3 (SCORE_VERSION = "v1.3")

New weights (40/20/15/15/10): SPY SMA / vol state / ADX / credit spread / VIX term structure.

**RegimeIndicators** now has two extra fields: `creditSpreadFactor: number | null` and `vixTermStructureFactor: number | null`.

`calcRegimeIndicators(bars, spyTrend, extra?)` accepts optional `RegimeExtra` — safe to omit (defaults to neutral 50 for both factors, preserving score scale in backtestEngine historical loops which don't have live HYG/LQD data).

HYG/LQD factor: 20D ratio momentum; -2% → 0, +2% → 100. VIX term structure: VIX3M/VIX ratio; 0.80 → 0, 1.30 → 100.

**Why:** Credit spreads and VIX term structure are leading indicators of regime shifts not captured by SPY trend alone.

## IS/OOS walk-forward split

Strict 50/50 temporal split: first half = in-sample, second half = out-of-sample. Computed from `dataPoints` array in `backtestEngine.ts`.

Fields added to `BacktestOutput`: `inSampleIC`, `outOfSampleIC`, `icDegradation` (IS - OOS), `oosPeriods[]`.

**Why:** Simple 50/50 temporal split was chosen over rolling window for simplicity. OOS degradation > 0.05 = overfit risk displayed in UI.

## Brier CI

Bootstrap 200 resamples with replacement, 90% CI (5th/95th percentile). Added `brierScoreCI: { low, high } | null` to BacktestOutput.

**Why:** Single Brier score has high variance with ~280 obs; CI quantifies uncertainty.

## Alert system

Table: `alerts` (id, ticker, conditionType, threshold, lastKnownDir, isActive, lastTriggeredAt, acknowledgedAt, createdAt).
Routes: GET/POST/DELETE /api/alerts, POST /api/alerts/:id/acknowledge, GET /api/alerts/triggered.
`checkAlertsForTicker(ticker, score, direction)` exported from alerts.ts — called fire-and-forget in stock analysis route.

## AI narrative

`generateNarrative()` in `narrative.ts` — guarded by `ENABLE_AI_NARRATIVE=true` env var + OpenAI integration provisioned.
Uses Replit AI Integrations proxy: `AI_INTEGRATIONS_OPENAI_BASE_URL` + `AI_INTEGRATIONS_OPENAI_API_KEY`.
Cached 5 min (node-cache). Returns `null` when not configured → frontend falls back to static `signalNarrative`.

## AnalysisResult field name gotchas

When accessing analysis result fields in routes:
- `analysis.momentum.rsi` (NOT rsi14)
- `analysis.momentum.macdCrossover` for string signal (NOT macdSignal — that's the numeric MACD signal line value)
- `analysis.trend.priceVsSma20/50/200` (NOT priceAboveSma — those don't exist; use `> 0` comparison for boolean)
- `analysis.volume` has no `vwapDistance` — compute as `(quote.price - volume.vwap) / volume.vwap * 100`
- `analysis.volatility.atrPercent` (NOT atr14Pct)
- `analysis.volatility.bollingerWidth` (NOT bbWidth)
- `analysis.quote` is typed `unknown` in analysisEngine — cast with `(analysis.quote as { price: number }).price`

## db.execute() return type

`db.execute<T>(sql\`...\`)` with drizzle/pg returns a `QueryResult<T>` whose `.rows` property is the actual array.
Cast with `(result as unknown as { rows: T[] }).rows` to get the iterable. Don't assume it's directly iterable.

## Universe metadata

`getAssetType(ticker)` and `isStructurallyDistorted(ticker)` exported from `scannerUniverse.ts`.
Leveraged ETFs + volatility ETFs (VXX, UVXY, SVXY, TQQQ, etc.) are flagged as structurally distorted.

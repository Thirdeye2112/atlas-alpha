---
name: TA overlays v2
description: Architecture and gotchas for the 6 TA quality features added in the v2 overlay pass (Fib, VolumeProfile, WeeklyContext, pivot RSI divergence, IV rank, Anchored VWAP)
---

## What was added

**Backend (indicators.ts)**
- `rsiDivergenceStrength: "strong"|"weak"|null` added to `MomentumResult`; uses `findPivotLows` / `findPivotHighs` helpers (window=3) — compares last 2 swing lows/highs in price vs RSI at same bar indices
- `ivRankProxy: number` and `realizedSkew: number` added to `OptionsResult`; `calcOptions` now accepts optional `bars?: OHLCVBar[]` 5th parameter
- `calcVolatility` now populates `ivRank` and `ivPercentile` (no longer null) — rolling 20-day realized-vol percentile over trailing history
- `calcFibLevels(bars)` — 100-bar swing H/L, 9 Fib ratios (0%–161.8%), trend determined by which extreme came last
- `calcVolumeProfile(bars, numBuckets=24, lookbackBars=60)` — distributes bar volume across price buckets proportionally by overlap; value area = 70% of total from POC outward
- `calcWeeklyContext(weeklyBars)` — returns null if <10 weekly bars; weekly SMA20/SMA50/RSI14/MACD; `weeklyAlignment` = "bullish"|"bearish"|"neutral"

**Backend (analysisEngine.ts)**
- `AnalysisResult` gained: `fibLevels: FibLevelsResult|null`, `volumeProfile: VolumeProfileResult|null`, `weeklyContext: WeeklyContextResult|null`
- `buildResult` gained `weeklyBars: OHLCVBar[] = []` as the 10th parameter (after lightMode)
- `runFullAnalysis`: adds `fetchOHLCV(sym, "2y", "1wk")` to the Promise.all; skipped in lightMode (`Promise.resolve([])`) to avoid extra Yahoo fetch during scanner batches
- `calcOptions` call now passes `bars` as the 5th argument

**Frontend (LightweightChart.tsx)**
- New `ChartLineSeries` interface: `{ label, color, lineStyle, lineWidth?, data: {time,value}[] }`
- New `lineSeries?: ChartLineSeries[]` prop; rendered as full-width LineSeries (not short stubs) after the SMA section, with `lastValueVisible: true`
- Price stubs (priceLines) remain 2-bar stubs — only lineSeries get full-width treatment

**Frontend (Dashboard.tsx)**
- `buildPriceLines` expanded: adds Fib levels (F23.6%/38.2%/50%/61.8%/78.6% as dashed, 0%/100% as dotted, amber for uptrend / violet for downtrend) + POC (yellow dashed) / VAH/VAL (orange dotted)
- `anchoredVwapSeries` useMemo: filters to `b.time.length === 10` (daily bars only), slices by anchor (3M=65/6M=130/1Y=252 bars), cumulative TP×V / cumV
- AVWAP toggle only shown for `["3mo","6mo","1y","2y","5y","max"]` timeframes
- Weekly badge: `(displayAnalysis as unknown as {...})?.weeklyContext` — cast needed because generated type uses `?` optional field; badge shows `WK ↑↑ BULLISH · RSI 69.7` style

## Why

- Pivot-based RSI divergence is signal-quality improvement over linear 10-bar comparison — avoids false divergences from choppy ranges
- Realized vol percentile as IV rank proxy is the best available proxy without real options chain data; it fills the previously-null `ivRank`/`ivPercentile` fields
- weeklyBars fetch is skipped in lightMode to prevent 373×2 = 746 extra Yahoo requests per scanner cycle

## Pattern engine v2 (peak-anchored multi-TF)

- `calcPatternOverlaysMultiTF(dailyBars, weeklyBars)` is the new main entry point in `patternOverlays.ts`; `calcPatternOverlays` is a backward-compat wrapper
- `detectPeakAnchoredFlags` uses a "grow-the-flag" approach: finds actual swing highs/lows (pivot window ±3 daily / ±2 weekly), measures pole, then expands the flag bar-by-bar stopping when `flagRange > poleRange * 0.65` — this correctly bounds the flag to just the consolidation period, not the breakdown
- `PatternOverlay` now has optional `timeframe?: "daily" | "weekly"` — purple chip in the right panel for weekly, blue for daily
- Daily opts: pivotWindow=3, minPolePct=5, maxPoleBars=12, flagMaxBars=10, lookbackBars=90
- Weekly opts: pivotWindow=2, minPolePct=5, maxPoleBars=6, flagMaxBars=5, lookbackBars=40
- Returns up to 4 patterns total; dedup by breakdown price within 4%
- Falls back to triangle detection (tip-of-series) if no flags found

## Gotchas

- `rsiOffset = closes.length - rsiArr.length` — RSI has 14 fewer values than the closes array; `toRsiIdx` maps slice-local index back to rsiArr index
- `calcWeeklyContext` returns `null` (not a default object) if `weeklyBars.length < 10` — frontend must null-check
- Codegen temporarily deletes generated files during `orval --config` clean step — this causes transient Vite HMR errors; a workflow restart clears them

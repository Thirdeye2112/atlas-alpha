---
name: Pattern overlays architecture
description: How bull/bear flag and triangle overlays are detected, projected, and rendered on charts
---

## Rule
`patternOverlays.ts` uses **three time scales** (short/medium/long) to detect flags. Target projection uses `poleNetMove` (close-to-close), NOT `poleTop - poleBase` (H-L range) — the full range inflates targets drastically for volatile names.

## Detection scales
- Short: poleLookback=25, flagBars=8 (~1.5 months)
- Medium: poleLookback=50, flagBars=15 (~3 months)
- Long: poleLookback=80, flagBars=25 (~5 months)

Returns the **first (most recent/significant) match** — one overlay per ticker.

**Why:** Short-only detection misses patterns where the pole is a multi-month rally (e.g. COIN, AVGO). Medium/long scales catch the structural pattern the user actually sees on the chart.

## Target projection formula
- Bull flag: `target = breakout + poleNetMove` where `poleNetMove = |poleCloses[-1] - poleCloses[0]|`
- Bear flag: `target = breakdown - poleNetMove`
- Using `poleTop - poleBase` (range) instead creates nonsensical targets when the pole overlaps a wider volatile range

## Dashboard integration
- `signals` prop: only passed for `timeframe.period === "3mo"` — empty array for all other timeframes
- `showSwingPoints`: true for 6mo/1y/2y/5y/max — renders pivot H/L circles instead of signal text
- `swingLookback`: 3 for 6mo, 4 for 1y, 5 for longer
- `patternOverlays`: always passed — active on all timeframes
- Legend card: rendered below signal key using IIFE, shows type badge + confidence + B/O / T1 / SL levels

## Rendering (LightweightChart.tsx)
- `PatternLine[]` → LineSeries (diagonal trendlines on chart)
- `PatternTarget[]` → createPriceLine (horizontal stubs with labels on right scale)
- Colors: bull lines = #22c55e, bear lines = #ef4444

## Known behaviour
- NVDA (mega-cap in tight range): no overlay — correct, no qualifying pattern
- AAPL 3M: no overlay — correct
- AMD: bull-flag high (+60.4% pole, B/O 527, T1 683, SL 486)
- AVGO: bull-flag high (+34.6% pole)
- COIN: bear-flag medium (-13.7% pole, B/D 169, T1 137, SL 222)

---
name: Adaptive scoring architecture
description: How per-ticker backtest IC² weights flow into live scoring, and the IC quality/contrarian system
---

## The integration chain

1. **backtestEngine.ts** — computes `optimalWeights` (IC²-proportional) and now passes them to `calibrationStore.set()` alongside slope/intercept
2. **calibrationStore.ts** — `CalibrationEntry` has `optimalWeights?: WeightOverrides | null`; in-memory only (not persisted to DB — repopulated on next scan/backtest)
3. **analysisEngine.ts** — `buildResult()` calls `calibrationStore.getFitted(sym)` BEFORE calling `calcAtlasScore`, passes `{ weights, rankIC, icRating }` as `opts`
4. **scoring.ts** — `calcAtlasScore` accepts `opts?: ScoreOpts`; when weights present, scales them to 79% factor budget (options 9% + exhaustion 12% fixed); IC confidence cap + contrarian flag + narrative injection
5. **stock.ts** — calibration overlay adds `isContrarian`, `usingAdaptiveWeights`, `signalQuality` to every analysis response
6. **Dashboard.tsx** — reads these fields from `displayAnalysis.calibration` to show CONTRARIAN IC / ADAPTIVE WEIGHTS / IC NOISE badges under the direction label

## Weight budget math

- Fixed: options 9%, exhaustion 12% → factor budget = 79%
- Per-factor weight = `(optimalWeights.factor / 100) * 0.79`
- RegimeGate still applied on top of trendW and momW

## IC confidence cap

- `icRating === "noise"` OR `|rankIC| < 0.03` → `cappedConfidence = min(confidenceScore, 50)`
- Contrarian: `rankIC < -0.02 && !isNoiseIC` → adds ⚠️ CONTRARIAN SIGNAL to narrative + Dashboard badge

## Timing caveat

- On server restart, `optimalWeights` is null (DB only stores slope/intercept, not weights)
- Adaptive weights activate after the next scan job recalibrates that ticker (~30 min) or user runs BacktestLab
- Score is cached 5 min — adaptive weights apply on the next cache miss after calibration fits

## Bug fixed

- Dashboard.tsx previously checked `cal?.status === "fitted"` (never true); fixed to `"live-fit" || "stale-fit"`
- This was causing the calibration probability panel, FIT badge, and heuristic comparison to never render

## WeightOverrides interface

Exported from `scoring.ts`:
```typescript
{ trend: number; momentum: number; volume: number; relativeStrength: number; regime: number }
```
(percentages, should sum to ~100 across the 5 factors)

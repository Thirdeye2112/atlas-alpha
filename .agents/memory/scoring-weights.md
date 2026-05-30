---
name: Scoring weights rationale
description: Current scoring engine weights in calcAtlasScore and why they were changed from defaults
---

## Current weights (scoring.ts calcAtlasScore)
- Trend: 0.24 (was 0.27)
- Momentum: 0.18 (unchanged)
- Volume: 0.13 (unchanged)
- Options: 0.09 (unchanged)
- Relative Strength: 0.20 (was 0.13)
- Regime: 0.04 (was 0.08)
- Exhaustion: 0.12 (unchanged)
Total: 1.00

## Reason for changes
Derived from IC²-proportional analysis of 2Y daily backtest across HOOD (mid-cap) at 5D/10D/20D horizons:
- RS had IC 0.272–0.403 but only 13% weight → underweighted, raised to 20%
- Regime had IC -0.029 to -0.142 (NEGATIVE) at all horizons → hurting prediction, lowered to 4%
- Trend had IC 0.194, was slightly overweighted at 27%, reduced to 24%

**Why:** IC²-proportional allocation gives weight proportional to squared information coefficient. Factors with negative IC for individual stocks (regime) should be minimized.

**How to apply:** These are global defaults. The BacktestLab page shows ticker-specific optimal weights which can differ substantially (e.g. RS should be 39-55% for HOOD specifically). The global weights are a compromise across ticker types.

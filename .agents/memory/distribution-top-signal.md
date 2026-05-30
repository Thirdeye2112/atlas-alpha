---
name: Distribution top signal
description: Overbought exhaustion mirror for calcExhaustion — when to flag distribution tops (mean-reversion risk at highs)
---

## Rule
When multiple overbought signals converge, `exhaustionSignal = "distribution_top"` is triggered with a low exhaustion score (<30).

## Triggers (in calcExhaustion)
- StochK > 90 AND StochD > 90: -15 to exhaustion score
- StochK > 80, StochD > 80, K < D (bearish cross from OB): -10
- RSI > 80: -15; RSI > 70: -8
- Price above BB upper: -5 to -15 depending on deviation %
- Price > SMA20 by 15%+: -8; by 20%+: -12
- RVOL < 0.8 at price > SMA20 >10%: -6 (distribution signal)
- CCI > 200: -8; CCI > 150: -4

## Signal classification
`exhaustionSignal = "distribution_top"` when score <= 30 AND stoch K/D > 80 AND (price > BB+ OR vsSMA20 > 10%)

## Momentum score fix (calcMomentum)
Stoch at K/D > 90: -8 (not +5). CCI > 150: ramps back toward 0 instead of staying at +10.

**Why:** The exhaustion engine was oversold-only before. HOOD April 27 2025 had stoch 97/94, CCI 190, price 19% above SMA20, RVOL 0.71x — scored 75 BULLISH despite drop the next day. The distribution_top signal drops exhaustion score to ~24 and adds a warning narrative.

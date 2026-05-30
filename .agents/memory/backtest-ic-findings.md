---
name: Backtest IC findings
description: Cross-sectional IC analysis results — which tickers are momentum vs contrarian, and which factors predict best
---

## Rule
Atlas Score IC is POSITIVE (momentum signal) for small/mid-cap individual stocks, and NEGATIVE (contrarian) for mega-caps and index ETFs.

## IC by stock type (5D horizon, run May 2026)
- HOOD (mid-cap): rankIC +0.119, strong, t=2.02 — momentum signal
- SPY (index): rankIC -0.216, strong — CONTRARIAN (high score → bearish)
- NVDA (mega-cap): rankIC -0.168, strong — CONTRARIAN
- AAPL (mega-cap): rankIC -0.087, moderate — contrarian

## IC strengthens with time horizon (HOOD)
- 1D: 0.026 (noise)
- 5D: 0.119 (strong)
- 10D: 0.177 (strong)
- 20D: 0.275 (strong)

## Factor ranking (HOOD 10D horizon)
1. Relative Strength: 0.272 — far stronger than current 13% weight suggests
2. Trend: 0.194
3. Volume: 0.165
4. Momentum: 0.134
5. Regime: -0.1 (NEGATIVE — regime dampening hurts individual stock prediction)

**Why:** Mean-reversion dynamics dominate mega-caps/indices; momentum dynamics dominate smaller individual stocks.

**How to apply:** When IC is negative for a ticker, flag as "contrarian indicator" in UI. Already implemented in BacktestLab page. Scoring weights updated globally to reflect RS underweighting and Regime overweighting.

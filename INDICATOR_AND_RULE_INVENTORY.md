# Atlas Indicator and Rule Inventory
**Generated:** 2026-06-15  
**Scope:** atlas-alpha (Node/Express API) + atlas-research (Python ML pipeline)  
**Sources read:** feature_factory.py, all feature modules, all confluence components, conviction engine, alignment engine, score engine, conditional engine, backtest/conditions.py, omni_proxy.py, classifier.py, recommendations.py, health.py, regime_interactions.py, all research-*.ts routes

---

## 1. Technical Indicators

### 1.1 Momentum

| Feature Name | Formula / Window | File | Used In |
|---|---|---|---|
| `return_1d` | log(close[-1] / close[-2]) | `features/momentum.py` | ML, conditional, attribution |
| `return_3d` | log(close[-1] / close[-4]) | `features/momentum.py` | ML, conditional |
| `return_5d` | log(close[-1] / close[-6]) | `features/momentum.py` | ML, conditional, labels |
| `return_10d` | log(close[-1] / close[-11]) | `features/momentum.py` | ML |
| `return_20d` | log(close[-1] / close[-21]) | `features/momentum.py` | ML |
| `return_60d` | log(close[-1] / close[-61]) | `features/momentum.py` | ML |
| `rsi_14` | Wilder RSI, period=14. Uses simple avg for seed, not recursive. | `features/momentum.py` | ML, conditional, attribution classifier |
| `rsi_momentum_5d` | rsi_14(today) − rsi_14(5 bars ago) | `features/momentum.py` | ML |
| `macd_histogram` | EMA(12) − EMA(26) − EMA9(MACD line); uses standard α=2/(n+1) | `features/momentum.py` | ML |
| `roc_20` | (close[-1] − close[-21]) / close[-21] | `features/momentum.py` | ML |

> **Implementation note:** RSI seed = simple mean of first `period` gains/losses (not Wilder recursive). This means RSI values on early bars differ from TradingView. The conditional engine uses a separate vectorised implementation (`backtest/conditions.py:_rsi_series`) which uses Wilder smoothing recursively — these two are slightly different.

---

### 1.2 Trend / Moving Averages

| Feature Name | Formula | File | Used In |
|---|---|---|---|
| `distance_sma20` | (close − SMA20) / SMA20 | `features/trend.py` | ML, feature IC |
| `distance_sma50` | (close − SMA50) / SMA50 | `features/trend.py` | ML, feature IC |
| `distance_sma200` | (close − SMA200) / SMA200 | `features/trend.py` | ML, feature IC |
| `above_sma20` | 1.0 if close > SMA20 else 0.0 | `features/trend.py` | ML, conditional |
| `above_sma50` | 1.0 if close > SMA50 else 0.0 | `features/trend.py` | ML, conditional |
| `above_sma200` | 1.0 if close > SMA200 else 0.0 | `features/trend.py` | ML, conditional |
| `distance_sma20_momentum` | distance_sma20(today) − distance_sma20(5 bars ago) | `features/trend.py` | ML |
| `spy_above_sma50` | 1.0 if SPY > SPY_SMA50 else 0.0 | `features/regime.py` | ML, regime component |
| `spy_above_sma200` | 1.0 if SPY > SPY_SMA200 else 0.0 | `features/regime.py` | ML, regime component, interactions |
| `market_trend` | +1 (both above), −1 (both below), 0 (split) | `features/regime.py` | ML, regime component, interactions |

> **Phase 2 stubs (deferred):** VIX regime, ADX trend strength, breadth % above SMA200. These are stubbed in `features/regime.py` but not computed.

---

### 1.3 Volatility

| Feature Name | Formula | File | Used In |
|---|---|---|---|
| `atr_14` | Mean True Range over 14 bars. TR = max(H−L, |H−C_prev|, |L−C_prev|) | `features/volatility.py` | ML, risk component |
| `atr_pct` | atr_14 / close (used in risk component) | computed in risk.py | Confluence risk penalty |
| `realized_vol_20` | annualised σ of 20-day log returns × √252 | `features/volatility.py` | ML, regime component, interactions |
| `realized_vol_60` | annualised σ of 60-day log returns × √252 | `features/volatility.py` | ML, regime component, interactions |

**Volatility regime classification** (in `confluence/components/regime.py`):
```
vol_regime = "high_vol" if realized_vol_20 > realized_vol_60 × 1.25 else "low_vol"
```

---

### 1.4 Volume

| Feature Name | Formula | File | Used In |
|---|---|---|---|
| `volume_ratio_20` | volume[-1] / mean(volume[-21:-1]) — today vs prior 20d avg | `features/volume.py` | ML, conditional, attribution |
| `dollar_volume_20` | mean(close × volume over last 20d) | `features/volume.py` | ML, risk component, quality tier |
| `volume_trend_5d` | mean(volume[-5:]) / mean(volume[-10:-5]) | `features/volume.py` | ML |

---

### 1.5 Relative Strength vs SPY

| Feature Name | Formula | File | Used In |
|---|---|---|---|
| `rs_spy_20` | log_return(ticker, 20d) − log_return(SPY, 20d) | `features/relative_strength.py` | ML, interactions |
| `rs_spy_60` | log_return(ticker, 60d) − log_return(SPY, 60d) | `features/relative_strength.py` | ML, interactions |
| `rs_spy_120` | log_return(ticker, 120d) − log_return(SPY, 120d) | `features/relative_strength.py` | ML |
| `rs_spy_20_momentum` | rs_spy_20(today) − rs_spy_20(5 bars ago) | `features/relative_strength.py` | ML |

---

### 1.6 OMNI / OSCAR Suite

The OMNI indicator tracks EMA of daily **LOW** prices (not closes). Oscar Carboni's original OMNI uses EMA of lows. Multiple variants were tested; EMA(Low, 82) was confirmed as the primary implementation.

| Feature Name | Formula | File | Used In |
|---|---|---|---|
| `omni_82_value` | EMA(low, 82) — final bar value | `features/omni_proxy.py` | ML |
| `omni_82_above` | 1.0 if close > EMA(low,82) else 0.0 | `features/omni_proxy.py` | ML, quality_tier, jarvis, interactions |
| `omni_82_distance` | (close − OMNI82) / OMNI82 | `features/omni_proxy.py` | ML, interactions |
| `omni_82_slope` | (OMNI82[-1] − OMNI82[-6]) / |OMNI82[-6]| — 5-bar fractional slope | `features/omni_proxy.py` | ML, interactions |
| `omni_82_bounce` | 1.0 if |low − OMNI82| / OMNI82 ≤ 0.5% AND close > open | `features/omni_proxy.py` | ML |
| `omni_82_distance_5d_change` | omni_82_distance(today) − omni_82_distance(5 bars ago) | `features/omni_proxy.py` | ML |
| `omni_82_slope_10d` | (OMNI82[-1] − OMNI82[-11]) / |OMNI82[-11]| | `features/omni_proxy.py` | ML |
| `omni_87_value` | EMA(low, 87) — final bar value | `features/omni_proxy.py` | ML |
| `omni_87_above` | 1.0 if close > EMA(low,87) else 0.0 | `features/omni_proxy.py` | ML, conditional |
| `omni_87_distance` | (close − OMNI87) / OMNI87 | `features/omni_proxy.py` | ML |
| `omni_87_slope` | (OMNI87[-1] − OMNI87[-6]) / |OMNI87[-6]| | `features/omni_proxy.py` | ML |
| `hma_87_above` | 1.0 if close > HMA(close,87) else 0.0. HMA = WMA(2×WMA(n/2) − WMA(n), √n) | `features/omni_proxy.py` | ML, conditional |
| `hma_87_distance` | (close − HMA87) / HMA87 | `features/omni_proxy.py` | ML |
| `oscar_87_value` | OSCAR(87): smoothed stochastic 0–100. Each bar: 2/3×prev + 1/3×rough where rough=(close−min_low)/(max_high−min_low)×100 | `features/omni_proxy.py` | ML, conditional |
| `oscar_87_above_50` | 1.0 if OSCAR(87) > 50 else 0.0 | `features/omni_proxy.py` | ML, conditional |

**OMNI variants tested** (research only, not in production features):

| Variant | Period | Description |
|---|---|---|
| `ema_lows_55` | 55 | EMA of lows |
| `ema_lows_82` | 82 | **Primary (confirmed as OMNI)** |
| `ema_lows_87` | 87 | Secondary |
| `ema_lows_89` | 89 | Tested |
| `wma_lows_87` | 87 | Linearly-weighted MA of lows |
| `dema_lows_87` | 87 | Double EMA of lows (lower lag) |
| `ema_median_87` | 87 | EMA of (H+L)/2 |
| `ema_typical_87` | 87 | EMA of (H+L+C)/3 |
| `hma_82` | 82 | Hull MA of closes |
| `hma_87` | 87 | Hull MA of closes |
| `ema_close_87` | 87 | Baseline: standard EMA of closes |

---

### 1.7 Quality Tier and Jarvis Signal

Computed in `features/feature_factory.py` using trailing 252-bar median price and average dollar volume:

```
Tier 1: median_price > $50  AND avg_dvol > $25M  → Jarvis =  omni_82_above×2−1   (±1.0)
Tier 2: $20 ≤ price ≤ $50  AND avg_dvol > $5M   → Jarvis =  omni_82_above×2−1   (±1.0)
Tier 3: $5  ≤ price ≤ $20  AND avg_dvol > $1M   → Jarvis =  0.0 (neutral)
Tier 4: everything else (micro/junk)              → Jarvis = -(omni_82_above×2−1)  (inverted)
```

| Feature Name | Output | File | Used In |
|---|---|---|---|
| `quality_tier` | 1.0–4.0 | `features/feature_factory.py` | ML, scanner |
| `jarvis_quality_adjusted` | −1.0, 0.0, or +1.0 | `features/feature_factory.py` | ML |

> **Implicit rule:** Tier 4 (micro/junk) inverts the OMNI signal. Above OMNI in low-quality stocks is a negative signal. This is a hidden bearish bias for sub-$5/low-liquidity names.

---

### 1.8 Regime Interaction Features (V3 ML Features)

Cross products of base features with regime masks. Motivated by IC analysis showing OMNI features only work above the 200DMA and volatility features work better below.

| Interaction Feature | Base | Regime Mask | Rationale |
|---|---|---|---|
| `omni_82_distance_x_above_200dma` | `omni_82_distance` | SPY > SMA200 | OMNI IC positive above, negative below |
| `omni_82_above_x_above_200dma` | `omni_82_above` | SPY > SMA200 | Same |
| `omni_82_slope_x_above_200dma` | `omni_82_slope` | SPY > SMA200 | IC = +0.002 above, −0.054 below |
| `realized_vol_20_x_below_200dma` | `realized_vol_20` | SPY < SMA200 | Vol IC = +0.046 below |
| `realized_vol_60_x_below_200dma` | `realized_vol_60` | SPY < SMA200 | Vol IC higher in downtrends |
| `return_1d_x_below_200dma` | `return_1d` | SPY < SMA200 | Mean-reversion stronger below |
| `return_3d_x_below_200dma` | `return_3d` | SPY < SMA200 | Same |
| `return_5d_x_below_200dma` | `return_5d` | SPY < SMA200 | Same |
| `rs_spy_20_x_bull` | `rs_spy_20` | market_trend==+1 | RS IC positive only in bull markets |
| `rs_spy_60_x_bull` | `rs_spy_60` | market_trend==+1 | Same |

File: `features/regime_interactions.py`

---

## 2. Pattern Rules

### 2.1 Candlestick Patterns

| Pattern Name | Condition | Used In |
|---|---|---|
| `hammer` | Via `patterns/candlestick.py:detect_patterns()` | Conditional backtester |
| `doji` | Via `patterns/candlestick.py:detect_patterns()` | Conditional backtester |
| `shooting_star` | Via `patterns/candlestick.py:detect_patterns()` | Conditional backtester |
| `engulfing_bull` | Via `patterns/candlestick.py:detect_patterns()` (alias: `bullish_engulfing`) | Conditional backtester |
| `engulfing_bear` | Via `patterns/candlestick.py:detect_patterns()` (alias: `bearish_engulfing`) | Conditional backtester |
| `inside_day` | high < prev_high AND low > prev_low (hardcoded in conditions.py) | Conditional backtester |
| `outside_day` | high > prev_high AND low < prev_low (hardcoded in conditions.py) | Conditional backtester |

File: `backtest/conditions.py:eval_candle()`

---

### 2.2 Price / Range Conditions

| Condition Type | Exact Logic | Default Params | File |
|---|---|---|---|
| `consecutive_down` | N consecutive closes below prior close; rolling sum of down-days == N | n_days=3 | `backtest/conditions.py` |
| `consecutive_up` | N consecutive closes above prior close | n_days=3 | `backtest/conditions.py` |
| `gap_down` | (open/prev_close − 1) × 100 < −pct | min_gap_pct=2.0% | `backtest/conditions.py` |
| `gap_up` | (open/prev_close − 1) × 100 > +pct | min_gap_pct=2.0% | `backtest/conditions.py` |
| `near_52w_low` | (close − rolling_min_252(low)) / rolling_min_252(low) ≤ within | within_pct=5% | `backtest/conditions.py` |
| `near_52w_high` | (rolling_max_252(high) − close) / rolling_max_252(high) ≤ within | within_pct=5% | `backtest/conditions.py` |
| `breakout_52w_high` | close > rolling_max_252(shift(1)·high) — breaks above prior year high | — | `backtest/conditions.py` |
| `above_level` | close > threshold | threshold=30.0 | `backtest/conditions.py` |
| `below_sma` | close < SMA(period) | period=200 | `backtest/conditions.py` |
| `above_sma` | close > SMA(period) | period=50 | `backtest/conditions.py` |
| `nr7` | today's range < minimum range of prior (lookback−1) bars | lookback=7 | `backtest/conditions.py` |

**Aliases registered in the conditions registry** (probability engine compatibility):
- `down_streak` → `consecutive_down` (param `n` → `n_days`)
- `up_streak` → `consecutive_up`

---

### 2.3 Volume Conditions

| Condition Type | Exact Logic | Default Params | File |
|---|---|---|---|
| `high_volume` | volume ≥ mult × rolling_mean(volume, lookback) | mult=2.0, lookback=20 | `backtest/conditions.py` |
| `volume_climax_down` | high_volume AND close < open (red bar on high volume) | mult=2.0, lookback=20 | `backtest/conditions.py` |
| `volume_climax_up` | high_volume AND close > open (green bar on high volume) | mult=2.0, lookback=20 | `backtest/conditions.py` |

---

### 2.4 RSI Conditions

| Condition Type | Exact Logic | Default Params | File |
|---|---|---|---|
| `oversold_rsi` | Wilder RSI(period) < threshold | threshold=30, period=14 | `backtest/conditions.py` |
| `overbought_rsi` | Wilder RSI(period) > threshold | threshold=70, period=14 | `backtest/conditions.py` |

---

### 2.5 OMNI / OSCAR Conditions

All OMNI conditions use period defaults. The primary variant tested is period=87 (close-based, legacy) or period=82 (EMA of lows, confirmed production OMNI).

| Condition Type | Exact Logic | Default Period | File |
|---|---|---|---|
| `omni_cross_up` | close crosses above EMA(close, period) [legacy close-based alias] | 87 | `backtest/conditions.py` |
| `omni_cross_down` | close crosses below EMA(close, period) | 87 | `backtest/conditions.py` |
| `omni_green_nd` | close > EMA(close, period) for N consecutive days | period=87, n=3 | `backtest/conditions.py` |
| `omni_red_nd` | close < EMA(close, period) for N consecutive days | period=87, n=3 | `backtest/conditions.py` |
| `ema_lows_cross_up` | close crosses above EMA(low, period) — true OMNI signal | 87 | `backtest/conditions.py` |
| `ema_lows_cross_down` | close crosses below EMA(low, period) | 87 | `backtest/conditions.py` |
| `ema_lows_support` | |low − EMA(low,p)| / EMA ≤ 0.5% AND close > open (bounce off OMNI) | 87, touch_pct=0.5% | `backtest/conditions.py` |
| `ema_lows_above_nd` | close > EMA(low, period) for N consecutive days | 82, n=3 | `backtest/conditions.py` |
| `ema_lows_green_slope` | close > EMA(low, period) AND EMA slope is positive over slope_bars | 82, 5 | `backtest/conditions.py` |
| `oscar_cross_up` | OSCAR(87) crosses above 50 | 87 | `backtest/conditions.py` |
| `oscar_cross_down` | OSCAR(87) crosses below 50 | 87 | `backtest/conditions.py` |
| `oscar_above_50` | OSCAR(87) > 50 (state, not cross) | 87 | `backtest/conditions.py` |
| `hma_cross_up` | close crosses above HMA(close, period) | 87 | `backtest/conditions.py` |
| `hma_cross_down` | close crosses below HMA(close, period) | 87 | `backtest/conditions.py` |

---

### 2.6 Calendar / Seasonality Conditions

| Condition Type | Exact Logic | File |
|---|---|---|
| `end_of_month` | Last N trading days of any calendar month | `backtest/conditions.py` |
| `turn_of_month` | First N trading days of any calendar month | `backtest/conditions.py` |
| `day_of_week` | Specific weekday (0=Monday … 4=Friday) | `backtest/conditions.py` |
| `fomc_proximity` | Within ±proximity_days of an FOMC meeting date (from `market_calendar` table) | `backtest/conditions.py` |
| `opex_week` | Week containing monthly options expiry date | `backtest/conditions.py` |
| `triple_witching_week` | Week containing quarterly triple-witching | `backtest/conditions.py` |

---

### 2.7 Sector Conditions

| Condition Type | Exact Logic | File |
|---|---|---|
| `sector_leading_nd` | Sector ETF (e.g. XLV) has rank_among_sectors ≤ N for n_days consecutive days | `backtest/conditions.py` |
| `xly_vs_xlp` | XLY 20d RS vs SPY > XLP 20d RS vs SPY (risk-on signal: discretionary outperforming staples) | `backtest/conditions.py` |
| `iwm_vs_spy` | IWM N-day return − SPY N-day return ≥ outperform_pct (small-cap breadth signal) | `backtest/conditions.py` |

---

## 3. Atlas Confluence Score — 6 Components

The confluence score is a 0–100 **quality** score (NOT directional). 80+ means strong multi-signal agreement. The score is direction-agnostic; direction is determined separately by alignment.

### Alignment Decision Rule (`confluence/alignment.py`)

```python
bull_weight = Σ(strength × weight) for bullish components
bear_weight = Σ(strength × weight) for bearish components

if bull_weight > bear_weight × 1.15  → dominant = bullish
elif bear_weight > bull_weight × 1.15 → dominant = bearish
else                                   → dominant = neutral
```

The 1.15× threshold is an implicit asymmetric gate — bull and bear must differ by >15% on a weighted basis before a direction is declared.

### Score Formula (`confluence/score.py`)

```python
aligned_components = components where direction == dominant_direction (excl. regime)
total_weight       = Σ(aligned.weight)
avg_strength       = Σ(strength × weight) / total_weight
alignment_ratio    = aligned_count / total_available   # from alignment.py
base               = (0.65 × avg_strength + 0.35 × alignment_ratio) × 100
regime_adjusted    = base × fitness_multiplier         # from regime table
final_score        = regime_adjusted − risk_penalty    # clipped to [0, 100]
```

If no directional consensus: `base = 20 + max(0, 20 − conflicting_count × 4)`

---

### Component 1: ML (`confluence/components/ml.py`)

| Property | Value |
|---|---|
| Weight | 0.30 |
| Source table | `predictions` |
| Bullish threshold | probability_positive ≥ 0.55 |
| Bearish threshold | probability_positive ≤ 0.45 |
| Neutral zone | 0.45 < prob < 0.55 |
| Strength formula | 0.6 × |prob − 0.5| × 2 + 0.4 × |rank_pct − 0.5| × 2 |
| Score (bullish) | 50 + rank_pct × 50 × confidence |
| Score (bearish) | 50 + (1 − rank_pct) × 50 × confidence |
| Score (neutral) | 30.0 |
| Unavailable if | No row in `predictions` for (ticker, date) |

---

### Component 2: Pattern (`confluence/components/pattern.py`)

| Property | Value |
|---|---|
| Weight | 0.20 |
| Source table | `conditional_patterns` JOIN `conditional_pattern_results` |
| Min sample size | 20 occurrences |
| Min hit rate threshold | 0.55 (55%) to count as directional signal |
| Direction logic | Net = (bullish_patterns − bearish_patterns); net>0 → bullish, net<0 → bearish |
| Strength formula | min(1.0, aligned/active × (avg_hit − 0.5) × 4.0) |
| Score | strength × 100 if directional, else 30.0 |
| Unavailable if | No patterns have min_sample OR zero patterns trigger on feature row |
| Uses market-wide aggregates only | Ticker-specific per-pattern stats not yet used |

**Pattern triggers evaluated in real-time** from feature row (lightweight eval in `_is_triggered()`):
- `consecutive_down` / `consecutive_up` → uses return_Nd
- `oversold_rsi` / `overbought_rsi` → uses rsi_14
- `gap_down` → uses return_1d
- `near_52w_low` / `near_52w_high` → uses dist_52w_low / dist_52w_high
- `high_volume` → uses rvol_20

---

### Component 3: Probability (`confluence/components/probability.py`)

| Property | Value |
|---|---|
| Weight | 0.20 |
| Source table | `alpha_signal_calibrations` |
| Qualification | status='promoted' AND sanity_pass=TRUE AND n_resolved≥30 AND hit_rate_5d≥0.55 |
| Min active signals | 2 |
| Weighting | w = (hit_rate − 0.5) × min(1.0, n_resolved/200) |
| Direction threshold | bull_frac ≥ 0.60 → bullish; bear_frac ≥ 0.60 → bearish |
| Strength | |bull_frac − bear_frac| |
| Unavailable if | Fewer than 2 promoted signals meet criteria |

**Signal types handled:**
- `direction` — matches `atlas_direction` from feature row
- `score_bucket` — matches `atlas_score` or `rank_percentile` range (e.g. "60-80")
- `pattern` — matches pattern names list in feature row
- `exhaustion` — matches `exhaustion_signal` field
- `smart_gate` — matches `smart_gate_enter` field

---

### Component 4: Feature IC (`confluence/components/feature_ic.py`)

| Property | Value |
|---|---|
| Weight | 0.10 |
| Source table | `feature_regime_performance` |
| Min IC threshold | |mean_ic| ≥ 0.008 |
| Min features needed | 5 scored features |
| Qualification | classification IN ('Always Useful', 'Regime Sensitive') |
| Direction logic | IC>0 and val>0 → bullish; IC<0 → inverts (mean reversion); weighted by sign_stability |
| Directional threshold | bull_frac or bear_frac ≥ 0.60 |
| Strength | |bull_frac − bear_frac| |
| Unavailable if | No features qualify for current regime, OR fewer than 5 scored |

**Implicit mean-reversion inversion:** Features with negative IC are automatically interpreted as contrarian — a high value signals the opposite of what the feature suggests at face value.

---

### Component 5: Regime (`confluence/components/regime.py`)

| Property | Value |
|---|---|
| Weight | 0.15 |
| Strength | 0.7 if directional, 0.3 if neutral |
| Score | 65.0 if directional, 40.0 if neutral |
| Bull regime | market_trend > 0 OR (market_trend null AND spy_above_sma200 > 0.5) |
| Bear regime | market_trend < 0 OR spy_above_sma200 ≤ 0.5 |
| Range regime | market_trend == 0 or both null |
| Signal | bullish if bull AND spy above 200; bearish if bear AND spy below 200; else neutral |
| Unavailable if | Both spy_above_sma200 and market_trend are null |

**Regime Fitness Multipliers** — applied to pre-regime base score:

| Market Regime | Signal Direction | Fitness |
|---|---|---|
| bull | bullish (+1) | 1.00 |
| bull | neutral (0) | 0.85 |
| bull | bearish (−1) | **0.72** |
| bear | bearish (−1) | 1.00 |
| bear | neutral (0) | 0.85 |
| bear | bullish (+1) | **0.72** |
| range | bullish or bearish | 0.88 |
| range | neutral | 0.80 |
| no data | any | 0.90 |

---

### Component 6: Risk (`confluence/components/risk.py`)

This component is **penalty-only** — it deducts points from the final score. It does not contribute to direction.

| Property | Value |
|---|---|
| Weight | 0.05 |
| Max penalty | 25 points |
| Direction | Always "neutral"; excluded from alignment counting |

**Penalty Schedule:**

| Condition | Feature Used | Penalty |
|---|---|---|
| data_quality_score < 0.70 | `data_quality_score` | −10 pts |
| data_quality_score 0.70–0.80 | `data_quality_score` | −4 pts |
| dollar_volume_20 < $1M | `dollar_volume_20` | −10 pts |
| dollar_volume_20 $1M–$5M | `dollar_volume_20` | −4 pts |
| expected_drawdown < −5% | `expected_drawdown` | −5 pts |
| expected_drawdown −2% to −5% | `expected_drawdown` | −2 pts |
| atr_pct > 6% | `atr_pct` | −3 pts |
| **Total cap** | | **−25 pts max** |

---

## 4. Atlas Conviction Layer

Formula and thresholds from `conviction/engine.py`.

### Formula (vectorised)

```python
# Step 1: Alignment base (85% weight)
align_base = (aligned_count / 5) × 100        # anchors tier to count, not quality

# Step 2: Quality score (15% weight)
ml_dist   = clip(|ml_prob − 0.5|, 0, 0.5)
rank_dist = clip(|ml_rank − 0.5|, 0, 0.5)
ml_str    = 0.6 × ml_dist×2 + 0.4 × rank_dist×2            # [0, 1]
quality_score = ml_str×40 + prob_endorses×25 + ic_endorses×20 + regime_q×15   # [0, 100]
  where:
    prob_endorses  = (dominant_dir != 0) AND (prob_dir == dominant_dir)
    ic_endorses    = (dominant_dir != 0) AND (feat_ic_dir == dominant_dir)
    regime_q       = 1.0 if agrees, 0.0 if conflicts, 0.5 if neutral/unavailable

# Step 3: Combined
raw = 0.85 × align_base + 0.15 × quality_score

# Step 4: Neutral penalty
if dominant_direction == 0: score × 0.50

conviction_score = clip(round(raw × neutral_mult, 2), 0, 100)
```

### Level Thresholds

| Level | Score Range | Alignment Interpretation |
|---|---|---|
| VERY_HIGH | ≥ 68 | 4–5 components aligned, non-neutral direction |
| HIGH | ≥ 51 | 3 components aligned, non-neutral |
| MODERATE | ≥ 34 | 2 components aligned |
| LOW | < 34 | 0–1 aligned, or high-aligned but neutral direction |

**Threshold derivation:** min score for k-aligned = (k/5)×100×0.85. Quality modifier (max ±7.5 pts at 15% weight) cannot cross a tier boundary set by a different alignment count. This prevents the inverse-ordering bug.

### Historical Performance (backtest 2015–2026)

| Level | Hit Rate 5d | Avg Return 5d | N |
|---|---|---|---|
| LOW | 54.0% | +0.150% | 30,086 |
| MODERATE | 54.0% | +0.250% | 132,343 |
| HIGH | 54.4% | +0.302% | 199,388 |
| VERY_HIGH | 55.6% | +0.377% | 167,688 |

All permutation tests: p=0.0000. Monotone ordering: ✓

---

## 5. Probability / Alpha Signal Calibration

The probability component reads from `alpha_signal_calibrations`, which is populated by an external calibration pipeline. Promoted signals feed back into the confluence probability component.

### Signal Types Currently in System

| Signal Type | Signal Key Format | Condition | Notes |
|---|---|---|---|
| `direction` | `"bullish"`, `"bearish"`, `"neutral"` | atlas_direction matches key | Directional consensus |
| `score_bucket` | `"60-80"`, `"40-60"`, etc. | atlas_score / rank_percentile in range | ml_rank_bucket promoted signals |
| `pattern` | Pattern name string | Pattern in ticker's current pattern list | |
| `exhaustion` | e.g. `"exhausted_up"` | exhaustion_signal column matches | |
| `smart_gate` | e.g. `"enter"` | smart_gate_enter column matches | |

**Promoted signals as of last known state (from memory):**
- `ml_rank_bucket/60-80` — promoted
- `ml_rank_bucket/40-60` — promoted

### Qualification Rules for Promotion

```
status = 'promoted'
AND sanity_pass = TRUE
AND n_resolved >= 30
AND hit_rate_5d >= 0.55
```

**Weight per signal in component:**
```python
w = (hit_rate_5d − 0.5) × min(1.0, n_resolved / 200)
```

Signals with larger samples and higher hit rates get more weight automatically. No fixed weight — evidence-driven.

---

## 6. Conditional Pattern Backtester

### All 44 Registered Condition Types

**Group A — Price/Return (10 types)**

| Name | Core Logic |
|---|---|
| `consecutive_down` | N closes each < prior close |
| `consecutive_up` | N closes each > prior close |
| `gap_down` | Open/prev_close − 1 < −min_gap_pct |
| `gap_up` | Open/prev_close − 1 > +min_gap_pct |
| `near_52w_low` | (close − 52w_low) / 52w_low ≤ within_pct |
| `near_52w_high` | (52w_high − close) / 52w_high ≤ within_pct |
| `breakout_52w_high` | close > prior year high (lagged by 1) |
| `above_level` | close > threshold |
| `below_sma` | close < SMA(period) |
| `above_sma` | close > SMA(period) |

**Group B — Volume (3 types)**

| Name | Core Logic |
|---|---|
| `high_volume` | volume ≥ mult × 20d avg volume |
| `volume_climax_down` | high_volume AND close < open |
| `volume_climax_up` | high_volume AND close > open |

**Group C — Volatility (1 type)**

| Name | Core Logic |
|---|---|
| `nr7` | today's (high−low) < min range of prior 6 bars |

**Group D — RSI (2 types)**

| Name | Core Logic |
|---|---|
| `oversold_rsi` | Wilder RSI(14) < 30 |
| `overbought_rsi` | Wilder RSI(14) > 70 |

**Group E — Candlestick (7 types)**

| Name | Core Logic |
|---|---|
| `candle` (hammer) | via `patterns/candlestick.py` |
| `candle` (doji) | via `patterns/candlestick.py` |
| `candle` (shooting_star) | via `patterns/candlestick.py` |
| `candle` (engulfing_bull) | via `patterns/candlestick.py` |
| `candle` (engulfing_bear) | via `patterns/candlestick.py` |
| `candle` (inside_day) | high < prev_high AND low > prev_low |
| `candle` (outside_day) | high > prev_high AND low < prev_low |

**Group F — Calendar (6 types)**

| Name | Core Logic |
|---|---|
| `end_of_month` | Last N trading days of month |
| `turn_of_month` | First N trading days of month |
| `day_of_week` | Specific weekday (0–4) |
| `fomc_proximity` | ±proximity_days of FOMC date |
| `opex_week` | Week of monthly options expiry |
| `triple_witching_week` | Week of quarterly triple-witching |

**Group G — OMNI/Oscar/HMA (10 types)**

| Name | Core Logic |
|---|---|
| `omni_cross_up` | close crosses above EMA(close, period) [legacy close-based] |
| `omni_cross_down` | close crosses below EMA(close, period) |
| `omni_green_nd` | close > EMA(close, period) for N days |
| `omni_red_nd` | close < EMA(close, period) for N days |
| `ema_lows_cross_up` | close crosses above EMA(low, period) [true OMNI] |
| `ema_lows_cross_down` | close crosses below EMA(low, period) |
| `ema_lows_support` | low touches EMA(low) within 0.5% AND closes bullish |
| `ema_lows_above_nd` | close > EMA(low, period) for N days |
| `ema_lows_green_slope` | close > EMA(low, period) AND slope positive |
| `oscar_cross_up` | OSCAR(87) crosses above 50 |
| `oscar_cross_down` | OSCAR(87) crosses below 50 |
| `oscar_above_50` | OSCAR(87) > 50 (state) |
| `hma_cross_up` | close crosses above HMA(close, period) |
| `hma_cross_down` | close crosses below HMA(close, period) |

**Group H — Sector (3 types)**

| Name | Core Logic |
|---|---|
| `sector_leading_nd` | Sector rank ≤ threshold for N consecutive days |
| `xly_vs_xlp` | XLY 20d RS vs SPY > XLP 20d RS vs SPY |
| `iwm_vs_spy` | IWM return − SPY return ≥ outperform_pct over N days |

**Aliases (2):** `down_streak` → `consecutive_down`, `up_streak` → `consecutive_up`

---

## 7. Feature Health Classification

Computed by `features/health.py` from `feature_performance` IC stats. Output written to `feature_review_flags`.

### Classification Thresholds

| Category | Conditions |
|---|---|
| `strong` | mean_IC ≥ 0.03 AND t-stat ≥ 2.0 AND sign_stability ≥ 60% |
| `useful` | mean_IC ≥ 0.01 AND t-stat ≥ 1.0 AND sign_stability ≥ 50% |
| `degrading` | sign_stability < 45% (sign flips too often across walk-forward folds) |
| `candidate_remove` | Pearson corr ≥ 0.80 with a stronger feature |
| `weak` | Below useful thresholds |

These are advisory — no auto-deletion or weight change. Human must act.

### Regime Sensitivity (from `feature_regime_performance`)

Each feature is classified in each regime:
- `'Always Useful'` — meaningful IC regardless of regime
- `'Regime Sensitive'` — significant IC only in certain regimes
- Excluded from feature_ic component if below IC threshold (|IC| < 0.008)

---

## 8. Adaptive Weighting Recommendations

Source: `attribution/recommendations.py`

### Baseline Hit Rates (long-run backtest 2015–2026)

| Component | Baseline HR |
|---|---|
| `ml` | 54.3% |
| `pattern` | 54.1% |
| `probability` | 54.2% |
| `feature_ic` | 54.4% |
| `regime` | 54.0% |

### Current Confluence Weights

| Component | Current Weight |
|---|---|
| `ml` | 0.30 |
| `pattern` | 0.20 |
| `probability` | 0.20 |
| `feature_ic` | 0.15 |
| `regime` | 0.10 |
| `risk` | 0.05 (penalty only) |

> Note: `feature_ic` weight in confluence (0.10) differs from its weight in recommendations baseline (0.15). The confluence weight is defined in `components/feature_ic.py`.

### Recommendation Rules (all output `status='pending'` — never auto-promoted)

| Rule | Trigger Condition | Action |
|---|---|---|
| `increase_weight` | HR > baseline + 3pp AND n ≥ 100 AND trend='improving' | +5pp weight (capped at 0.45) |
| `reduce_weight` | HR < baseline − 3pp AND n ≥ 100 AND trend='degrading' | −5pp weight (floored at 0.05) |
| `invert_signal` | HR < 47% AND n ≥ 100 (anti-correlated) | Priority=urgent, weight unchanged |
| `disable_in_regime` | HR < 48% in specific regime AND n ≥ 50 | suggested_weight = 0.0 for that regime |
| `keep_unchanged` | |delta| ≤ 1pp AND n ≥ 100 | Low priority advisory |

---

## 9. Error Attribution — Failure Classes

Source: `attribution/classifier.py`

### Priority Order (first match wins for primary classification)

| Priority | Class | Condition | Confidence |
|---|---|---|---|
| 1 | `correct` | hit_or_miss == True | 1.00 |
| 2 | `event_gap` | |actual_return| > 4% | 0.90 |
| 3 | `model_overconfidence` | predicted_probability > 70% AND miss | 0.85 |
| 4 | `regime_mismatch` | bullish pred in bear/below_200dma OR bearish in strong bull/low_vol | 0.80 |
| 5 | `conflicting_signal_ignored` | conflicting_count ≥ 2 | 0.75 |
| 6 | `weak_confluence` | confluence_score < 40 OR conviction_level == 'LOW' | 0.70 |
| 7 | `momentum_exhaustion` | RSI > 70 (bullish miss) OR RSI < 30 (bearish miss) | 0.72 |
| 8 | `mean_reversion_failure` | bearish pred with trend_score > 0.65, or bullish pred with trend_score < 0.35 | 0.65 |
| 9 | `low_liquidity_failure` | volume / ADV < 0.50 | 0.60 |
| 10 | `unknown` | none of the above | 0.40 |

**Regime mismatch conditions:**
- Bullish prediction → mismatch if: regime ∈ {bear_market, below_200dma} OR vol_regime == high_vol
- Bearish prediction → mismatch if: regime ∈ {bull_market, above_200dma} AND vol_regime == low_vol

---

## Table A: Active Signals

Signals currently used in the live confluence scoring pipeline.

| Signal | Component | Weight | Backtested | Status |
|---|---|---|---|---|
| ML probability | ml | 0.30 | Yes | Active |
| ML rank percentile | ml | 0.30 | Yes | Active |
| Promoted conditional patterns | pattern | 0.20 | Yes | Active |
| Promoted alpha calibration signals | probability | 0.20 | Yes | Active (≥2 promoted required) |
| Feature IC in current regime | feature_ic | 0.10 | Yes | Active |
| Market regime classification | regime | 0.15 | Yes | Active |
| Data quality penalty | risk | 0.05 | N/A | Active |
| Liquidity penalty | risk | 0.05 | N/A | Active |
| Expected drawdown penalty | risk | 0.05 | N/A | Active |
| ATR extreme penalty | risk | 0.05 | N/A | Active |
| OMNI82 features (all 7) | ML input | — | Yes | Active in ML |
| OMNI87 features (4) | ML input | — | Yes | Active in ML |
| HMA87 features (2) | ML input | — | Yes | Active in ML |
| OSCAR87 features (2) | ML input | — | Yes | Active in ML |
| Regime interaction features (V3, 10) | ML input | — | Yes | Active in ML |
| Quality tier (1–4) | ML + quality_tier | — | Yes | Active in ML |
| jarvis_quality_adjusted | ML input | — | Yes | Active in ML |

---

## Table B: Dormant / Unused Signals

Signals defined but not actively used in scoring.

| Signal | Location | Reason Dormant |
|---|---|---|
| VIX regime (`vix_level`, `vix_regime`) | `features/regime.py` stubs | Requires VIX feed — Phase 2 |
| Breadth (% above SMA200) | `features/regime.py` stubs | Requires full-universe computation — Phase 2 |
| ADX trend strength | `features/regime.py` stubs | Phase 2 |
| `omni_cross_up` / `omni_cross_down` (close-based) | `backtest/conditions.py` | Legacy alias; real OMNI uses `ema_lows_*` |
| OMNI variants: wma_lows_87, dema_lows_87, ema_median_87, ema_typical_87, ema_close_87 | `features/omni_proxy.py` VARIANTS | Research only; not in production feature set |
| `atr_14` raw value (not normalised) | `features/volatility.py` | risk component uses `atr_pct`; raw used only in ML |
| Sector RS (XLY, XLP, IWM) | `backtest/conditions.py` sector conditions | Only in conditional backtester, not in confluence |
| `expected_drawdown` feature | `confluence/components/risk.py` | Feature named but not in standard feature_factory output; computed elsewhere |

---

## Table C: Duplicate / Aliased Signals

| Signal | Duplicate Of | Notes |
|---|---|---|
| `down_streak` | `consecutive_down` | Alias registered in REGISTRY; same evaluator |
| `up_streak` | `consecutive_up` | Alias registered in REGISTRY |
| `omni_cross_up` (close-based) | `ema_lows_cross_up` | Legacy; omni_cross_up uses EMA of closes, ema_lows_cross_up uses EMA of lows. Conceptually different — ema_lows is the true OMNI |
| `bullish_engulfing` | `engulfing_bull` | candle alias in conditions.py |
| `bearish_engulfing` | `engulfing_bear` | candle alias in conditions.py |
| `dist_52w_low` | `near_52w_low` feature | Pattern component uses `dist_52w_low`; condition uses `near_52w_low` logic |
| `rvol_20` | `volume_ratio_20` | Pattern component uses `rvol_20` key; feature factory outputs `volume_ratio_20` — these may be the same or may mismatch |
| `rsi_14` (momentum.py) | `rsi_14` (conditions.py `_rsi_series`) | Two separate RSI implementations; conditions.py uses true Wilder recursive, features/momentum.py uses simple avg seed. Values differ on first ~28 bars |

---

## Table D: Signals with Positive Historical Evidence

| Signal | Evidence | Source |
|---|---|---|
| VERY_HIGH conviction (score ≥ 68) | HR = 55.6%, avg return +0.377%, n=167,688, p=0.0000 | Conviction backtest 2015–2026 |
| HIGH conviction (score ≥ 51) | HR = 54.4%, avg return +0.302%, n=199,388, p=0.0000 | Conviction backtest |
| MODERATE conviction (score ≥ 34) | HR = 54.0%, avg return +0.250%, n=132,343, p=0.0000 | Conviction backtest |
| ml_rank_bucket/60-80 | Promoted in alpha_signal_calibrations | Probability calibration pipeline |
| ml_rank_bucket/40-60 | Promoted in alpha_signal_calibrations | Probability calibration pipeline |
| OMNI82 features in bull/above_200dma regime | IC = +0.026/+0.015 (omni_82_distance/above) | REGIME_SENSITIVITY_REPORT |
| Realized vol features in bear/below_200dma | IC = +0.053 (realized_vol_20) | REGIME_SENSITIVITY_REPORT |
| RS vs SPY in bull markets | IC positive only in bull markets | regime_interactions.py rationale |
| Return features below 200DMA | IC more negative → mean-reversion signal stronger | regime_interactions.py rationale |

---

## Table E: Signals with Negative Historical Evidence

| Signal | Evidence | Source |
|---|---|---|
| OMNI82 in bear/below_200dma regime | IC negative (omni_82_slope = −0.054 below 200DMA) | REGIME_SENSITIVITY_REPORT |
| Quality Tier 4 / jarvis_quality_adjusted (inverted) | Micro/junk stocks: OMNI above-line is bearish | feature_factory.py logic |
| Conflicting signals (conflicting_count ≥ 2) | Associated with prediction failures → classified as `conflicting_signal_ignored` | attribution/classifier.py |
| RSI > 70 on bullish predictions | Classified as `momentum_exhaustion` in failed predictions | attribution/classifier.py |
| RSI < 30 on bearish predictions | Classified as `momentum_exhaustion` | attribution/classifier.py |

---

## Table F: Signals Not Yet Backtested

| Signal | Location | Status |
|---|---|---|
| `volume_trend_5d` | `features/volume.py` | ML feature; no isolated backtest |
| `distance_sma20_momentum` | `features/trend.py` | ML feature; no isolated backtest |
| `rsi_momentum_5d` | `features/momentum.py` | ML feature; no isolated backtest |
| `rs_spy_20_momentum` | `features/relative_strength.py` | ML feature; no isolated backtest |
| `omni_82_bounce` | `features/omni_proxy.py` | ML feature; no isolated backtest |
| `omni_82_distance_5d_change` | `features/omni_proxy.py` | ML feature; no isolated backtest |
| `omni_82_slope_10d` | `features/omni_proxy.py` | ML feature; no isolated backtest |
| All 10 regime interaction features | `features/regime_interactions.py` | V3 ML inputs; IC from `feature_regime_performance` but no standalone backtest |
| `sector_leading_nd` | `backtest/conditions.py` | In registry but no known backtest run |
| `xly_vs_xlp` | `backtest/conditions.py` | In registry but no known backtest run |
| `iwm_vs_spy` | `backtest/conditions.py` | In registry but no known backtest run |
| `fomc_proximity` | `backtest/conditions.py` | In registry but no known backtest run |
| `opex_week` | `backtest/conditions.py` | In registry but no known backtest run |
| `triple_witching_week` | `backtest/conditions.py` | In registry but no known backtest run |
| `ema_lows_green_slope` | `backtest/conditions.py` | New; no known backtest run |
| `volume_climax_down` / `volume_climax_up` | `backtest/conditions.py` | In registry; no known backtest run |
| `exhaustion` signal type | `confluence/components/probability.py` | Handled in _signal_active() but no calibrated signal known to exist |
| `smart_gate` signal type | `confluence/components/probability.py` | Handled in _signal_active() but no calibrated signal known to exist |
| Feature health categories: `degrading`, `candidate_remove`, `weak` | `features/health.py` | Computed but no action taken automatically |
| Adaptive recommendations: all 6 types | `attribution/recommendations.py` | Logic ready; no promotions yet (system just built) |

---

## Appendix: Hidden / Implicit Decision Rules

These rules are not labeled as "signals" but silently gate or modify scoring.

| Rule | Location | Effect |
|---|---|---|
| **1.15× bull/bear weight asymmetry** | `alignment.py:38-43` | Consensus requires one side to outweigh the other by >15%. Below this, neutral is declared — prevents weak direction-calls |
| **Minimum 15 bars** | `feature_factory.py:MIN_BARS=15` | Any ticker with <15 bars returns None entirely — excluded from scoring |
| **SMA200 needs 200 bars** | `features/trend.py` | `distance_sma200` and `above_sma200` return None silently until 200 bars available |
| **Neutral direction halves conviction** | `conviction/engine.py:_NEUTRAL_MULT=0.50` | When no direction consensus, conviction score is multiplied by 0.50. A VERY_HIGH raw score becomes LOW if direction is neutral |
| **Pattern component: market-wide aggregates only** | `confluence/components/pattern.py:33` | `ticker IS NULL` filter — pattern component uses broad population statistics, not this specific ticker's history |
| **ML component: latest model version wins** | `confluence/components/ml.py:29` | `ORDER BY model_version DESC LIMIT 1` — silently picks newest model if multiple exist |
| **Probability component weight scales with sample size** | `confluence/components/probability.py:55` | `min(1.0, n_resolved/200)` — signals with n<200 have down-weighted evidence |
| **Feature IC: sign_stability weighting** | `confluence/components/feature_ic.py:70` | IC contribution = IC_abs × sign × sign_stability. Unreliable features (sign_stability < 0.5) have less than 50% of their face IC applied |
| **IC direction inversion** | `confluence/components/feature_ic.py:69` | Negative-IC features are contrarian. `ic × val > 0 ? bullish : bearish` means a high-RSI reading with negative IC is bearish |
| **No regime data = 10% fitness penalty** | `confluence/components/regime.py:90` | If regime unavailable, direction_fitness returns 0.90 (not 1.0) |
| **Risk penalty cap at 25pts** | `confluence/components/risk.py:_MAX_PENALTY=25` | Cannot deduct more than 25 points regardless of how many risk flags fire |
| **Score 0–100 is quality, not direction** | `confluence/score.py:docstring` | A score of 80 can be strongly bullish OR strongly bearish — direction is determined by alignment, not score |
| **Candlestick inside_day/outside_day hardcoded** | `backtest/conditions.py:224-231` | These two candlestick types are not in the detect_patterns() dispatch — they use raw OHLC comparisons directly in the eval_candle() function |
| **OMNI legacy vs true OMNI** | `omni_proxy.py:486-493` | `omni_cross_up_indices()` (legacy, close-based) is used for the `omni_cross_up` condition. `ema_lows_cross_up_indices()` is the true OMNI signal. These are aliased but conceptually different |
| **Jarvis inverts signal for Tier 4** | `feature_factory.py:113` | Stocks below $5 / low dollar volume: `jarvis = -(omni_82_above × 2 - 1)`. Being above OMNI becomes a negative signal for junk stocks |
| **Calendar data from market_calendar table** | `backtest/conditions.py:_calendar_cache` | FOMC, OpEx, and triple-witching conditions silently return all-False if table is empty |
| **Sector RS from sector_relative_strength table** | `backtest/conditions.py:_sector_ranks()` | sector_leading_nd, xly_vs_xlp conditions silently return all-False if table is empty |
| **Probability needs ≥2 promoted signals** | `confluence/components/probability.py:_MIN_SIGNALS=2` | If fewer than 2 calibrated signals pass the quality filter, the entire component is marked unavailable — does not fire |
| **Attribution RSI implementation split** | `features/momentum.py` vs `backtest/conditions.py` | RSI in features uses simple average seed; RSI in conditions uses Wilder recursive smoothing. Different values on same data until ~28+ bars |

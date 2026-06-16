# Pattern vs Probability Audit

**Generated:** 2026-06-15
**Finding:** 100% direction agreement between Pattern and Probability is mathematically guaranteed by design — both components can only emit +1 (bullish) or 0 (neutral), never -1 (bearish).

---

## 1. Symptom

From EDGE_HIERARCHY_REPORT, Redundancy Analysis:

| Component Pair | Agreement Rate |
|---|---|
| pattern × probability | **100.0%** |

This is not a numerical artifact. It is structural.

---

## 2. Root Cause: Both Signals Are Unidirectional (Bullish Only)

### 2a. Pattern Direction is Always Bullish

26 patterns exceed the hit rate threshold (`_HIT_THRESH = 0.55`). Every single one has a positive `avg_return`:

```
sector_leading_nd     hr=0.867  ar=+0.0091  dir=BULL
oscar_cross_up        hr=0.765  ar=+0.0054  dir=BULL
consecutive_down      hr=0.729  ar=+0.0098  dir=BULL   ← mean-reversion buy
oscar_cross_up        hr=0.727  ar=+0.0079  dir=BULL
consecutive_up        hr=0.716  ar=+0.0047  dir=BULL
consecutive_down      hr=0.703  ar=+0.0082  dir=BULL   ← mean-reversion buy
oscar_cross_up        hr=0.697  ar=+0.0086  dir=BULL
ema_lows_cross_up     hr=0.670  ar=+0.0066  dir=BULL
... (all 26 above-threshold patterns have ar > 0)
```

**Zero above-threshold patterns have avg_return < 0.** This means `bear_pat` is never incremented. Therefore:

```python
net_pat = bull_pat - bear_pat   # bear_pat is always 0
pat_dir = np.where(net_pat > 0, 1, np.where(net_pat < 0, -1, 0))
# → pat_dir ∈ {0, +1} only. Never -1.
```

### 2b. Probability Direction is Always Bullish

Both promoted signals have positive avg_return:

```
ml_rank_bucket/40-60: hit=0.553  avg_ret=+0.00363  n=94,741   → BULL when fires
ml_rank_bucket/60-80: hit=0.554  avg_ret=+0.00389  n=121,061  → BULL when fires
```

```python
# In score_batch_extended: prob direction logic
if ar > 0:  bull_pw += trig * abs(w)   # both signals land here
else:       bear_pw += trig * abs(w)   # bear_pw is always 0

# bull_pfr is always 1.0 when prob fires (no bear weight)
prob_dir = np.where((total_pw > 0) & (bull_pfr >= 0.60), 1, ...)
# → prob_dir ∈ {0, +1} only. Never -1.
```

### 2c. The Intersection Is Always +1 vs +1

The redundancy check computes agreement only when **both** components fire a directional signal:

```python
mask = both_avail & (pat_dir != 0) & (prob_dir != 0)
agreement = (pat_dir[mask] == prob_dir[mask]).mean()
```

Since pat_dir ∈ {+1}, prob_dir ∈ {+1} within the mask, agreement is always `1.0 == 1.0` → **100% by mathematical necessity**.

---

## 3. Secondary Finding: 20 Phantom Patterns

Of the 44 patterns in the DB, only 8 condition types can fire in the scoring engine (`_trigger_vec_local`):

**Condition types that fire:**
- `consecutive_down` (4 patterns)
- `consecutive_up` (4 patterns)
- `oversold_rsi` (2 patterns)
- `overbought_rsi` (1 pattern)
- `gap_down` (2 patterns)
- `near_52w_low` (1 pattern)
- `near_52w_high` (1 pattern)
- `high_volume` (1 pattern)

**Condition types in DB but never handled (return `false_s` = always False):**
- `oscar_cross_up` (6 patterns, hr=0.56–0.77)
- `ema_lows_cross_up` (6 patterns, hr=0.60–0.67)
- `hma_cross_up` (3 patterns, hr=0.61)
- `ema_lows_support` (2 patterns, hr=0.55–0.64)
- `ema_lows_green_slope` (1 pattern)
- `omni_cross_up` (1 pattern)
- `nr7`, `breakout_52w_high`, `volume_climax_down`, `fomc_proximity`, `opex_week`, `end_of_month`
- `sector_leading_nd` (2 patterns, hr=0.867 — highest in system)
- `xly_vs_xlp` (1 pattern)

**20+ phantom patterns** with some of the highest backtested hit rates (up to 0.87) that contribute zero to live scoring. `sector_leading_nd` at hr=0.867 is particularly notable.

---

## 4. Shared Source Analysis

| Signal | Source | Direction Possible | True Independence? |
|---|---|---|---|
| Pattern | Condition triggers (RSI, momentum, OMNI-based) | +1, 0 only | No — bullish only |
| Probability | ML rank buckets 40–80% | +1, 0 only | No — bullish only |
| ML rank | LightGBM model output | +1, -1, 0 | Yes — bidirectional |

Pattern and probability share a common driver: **positive recent momentum**. ML rank is driven by return features (return_1d, 3d, 5d, 10d, 20d, 60d), RSI, distance from SMAs — all of which also drive pattern conditions (consecutive_up/down, oversold_rsi) and probability (the higher ML rank, the more likely you fall in the 60–80% bucket).

The correlation is structural, not coincidental:
- Stocks in ML rank buckets 40–80% have above-average momentum by definition
- Above-average momentum stocks trigger `consecutive_up`, don't trigger `consecutive_down` (which fires as mean-reversion bullish anyway)
- The net of bullish-only patterns is therefore always bullish for above-average momentum stocks

---

## 5. Is This True Duplication?

Partially. The signals differ in:
- **Input data**: Pattern uses raw price series; probability uses ML model output (which processes 39 features cross-sectionally)
- **Mechanism**: Pattern uses rule-based triggers; probability uses ranked buckets

But both produce the same output domain {0, +1} and both track positive momentum/quality. In the alignment formula they count as 2 independent votes, but they provide ~1 effective independent vote.

---

## 6. Recommended Architecture Changes

### 6a. Add bearish patterns to balance the component

Current state: 0 above-threshold bearish patterns.

Candidates (from existing condition types with negative avg_return):
- `overbought_rsi` (hr < 0.55 currently — investigate threshold)
- `near_52w_high` (currently below threshold but may qualify with adjusted lookback)
- `gap_up` (not yet in DB, strong mean-reversion candidate)
- `high_volume on negative day` (exhaustion signal)

Until bearish patterns exist, the pattern component provides no bearish signal and artificially inflates the bullish alignment count.

### 6b. Add bearish probability signals

Current: only ml_rank_bucket 40–60 and 60–80 are promoted (both bullish).

The buckets 0–20 and 20–40 (low-rank stocks) likely have negative hit rates. Promote them with bearish direction. This would allow `prob_dir = -1` for low-rank stocks and create genuine bidirectionality.

### 6c. Implement the 20 phantom patterns

`sector_leading_nd` (hr=0.867) is the highest-performing signal in the system by hit rate. It currently never fires. Implementing it alone would meaningfully change the pattern component's signal quality.

### 6d. Merge pattern + probability into one "momentum bias" supplementary vote

Given they're structurally correlated and both bullish-only, treating them as 2 independent votes in the alignment formula overstates confidence. One option:

```
confluence alignment = ml_rank (1 vote) + feature_ic (1 vote) + regime (1 vote)
                      + momentum_bias (1 combined vote from pattern × probability)
```

This reduces the maximum aligned_count from 5 to 4, changes the conviction thresholds, but gives a more honest representation of signal independence.

---

## 7. Summary

| Question | Finding |
|---|---|
| Why 100% agreement? | Both signals can only emit +1 or 0; -1 is impossible for both |
| True duplication? | Partial — same output domain, correlated inputs, but different mechanisms |
| Shared source? | Both downstream of momentum/ML rank |
| Implementation bug? | No — the logic is correct; the data configuration is asymmetric |
| Phantom patterns? | Yes — 20+ conditions in DB that never fire, including highest-HR signal (0.867) |
| Independent votes counted? | System claims 2 (pattern + probability); effective contribution is ~1 |

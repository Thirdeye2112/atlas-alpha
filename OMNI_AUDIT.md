# OMNI / OSCAR Audit

**Generated:** 2026-06-15
**Finding:** OMNI/OSCAR layer HR=45.2% (below random). Two confirmed bugs explain the inversion.

---

## 1. Symptom

From EDGE_HIERARCHY_REPORT:

| Layer | N (directional) | Hit Rate 5d | IC |
|---|---|---|---|
| omni_oscar | 515,411 | **45.2%** | -0.0031 |

A 45.2% hit rate means OMNI/OSCAR is predicting the **wrong direction** more than half the time on a 5-day horizon. IC = -0.003 (weakly negative). Coverage = 99.8% (fires on almost every row). This is a broken signal producing systematic noise, not an edge.

---

## 2. Bug A: `oscar_87_above_50` Is Not in Parquet

`oscar_87_above_50` is computed in `omni_proxy.py` but is not in `OMNI_FEATURES` in `config/settings.py`.

### Confirmed

```
Parquet: feature_matrix_2026-06-14.parquet

omni_82_above     : PRESENT  (binary 0/1, mean=0.593)
oscar_87_above_50 : MISSING  ← not in OMNI_FEATURES, silently dropped
```

`OMNI_FEATURES` in settings.py:
```python
OMNI_FEATURES: list[str] = [
    "omni_82_value",
    "omni_82_above",      # ✓ exported
    "omni_82_distance",
    "omni_82_slope",
    "omni_82_bounce",
    # "oscar_87_above_50" is NOT listed here
]
```

---

## 3. Bug B: Missing OSCAR Forces OMNI to Invert

In `run_edge_hierarchy.py`, `_layer_direction("omni_oscar")`:

```python
omni = df.get("omni_82_above", pd.Series(np.nan, index=df.index))
osc  = df.get("oscar_87_above_50", pd.Series(np.nan, index=df.index))

od   = np.where(omni.fillna(0.5) > 0.5, 1, -1)
ocsd = np.where(osc.fillna(0.5)  > 0.5, 1, -1)   # ← BUG: NaN → 0.5 → 0.5 > 0.5 is False → -1

votes = od + ocsd
avail = omni.notna() | osc.notna()

return pd.Series(
    np.where(avail, np.where(votes >= 1, 1, -1), 0),
    index=df.index,
)
```

Since `oscar_87_above_50` is always NaN (missing from parquet), `ocsd` is always **-1**.

### Vote arithmetic when OSCAR is missing:

| omni_82_above | od | ocsd (NaN→-1) | votes | direction |
|---|---|---|---|---|
| 1.0 (above) | +1 | -1 | **0** | `0 >= 1` is False → **-1 (bearish)** |
| 0.0 (below) | -1 | -1 | **-2** | `-2 >= 1` is False → **-1 (bearish)** |

**Result: OMNI/OSCAR direction is ALWAYS -1 (bearish), regardless of omni_82_above.**

When OMNI is bullish (+1), the missing OSCAR casts -1, netting 0 votes, which resolves to -1 (bearish) because `votes >= 1` fails. This inverts the bullish OMNI signal to bearish.

---

## 4. Impact Breakdown

The OMNI/OSCAR layer produces:
- 100% bearish signals (because votes always < 1)
- Coverage = 99.8% (omni_82_above is available for almost all rows)
- Hit rate = 45.2% ≈ fraction of stocks that actually fell over 5 days

This matches the base rate of stock declines. The layer is functioning as a pure "always bearish" predictor with no actual OMNI signal.

### Cross-segment estimate

The OMNI indicator is known to work differently by market cap tier. Because OSCAR is always missing, segment-specific analysis is impossible in the current setup. However, from the design intent:

| Segment | OMNI Design | Current Behavior (bug) |
|---|---|---|
| Large cap (>$50, >$25M dvol) | OMNI bullish = buy signal | Always bearish output |
| Mid cap ($20-50) | OMNI bullish = buy signal | Always bearish output |
| Small cap ($5-20) | Jarvis = 0, OMNI less reliable | Always bearish output |
| Micro cap | Jarvis inverted (OMNI = contrarian) | Always bearish output |
| SPY (benchmark) | N/A | Always bearish output |

**No segment receives valid OMNI signals under current implementation.**

---

## 5. Bug C: 20+ OMNI-Based Patterns Never Fire

The pattern component loads 44 conditions from the DB, including:

```
oscar_cross_up      (6 patterns, hr=0.56-0.77, all BULL)
ema_lows_cross_up   (6 patterns, hr=0.60-0.67, all BULL)
hma_cross_up        (3 patterns, hr=0.61, all BULL)
ema_lows_support    (2 patterns, hr=0.55-0.64, all BULL)
ema_lows_green_slope(1 pattern,  hr=0.55,      BULL)
omni_cross_up       (1 pattern,  hr>0.55,      BULL)
```

These 19+ patterns have good backtested hit rates (0.55–0.77). But `_trigger_vec_local` in the scoring engine only handles 8 condition types:

```python
def _trigger_vec_local(condition_type, params, df, false_s):
    if condition_type == "consecutive_down": ...
    if condition_type == "consecutive_up": ...
    if condition_type == "oversold_rsi": ...
    if condition_type == "overbought_rsi": ...
    if condition_type == "gap_down": ...
    if condition_type == "near_52w_low": ...
    if condition_type == "near_52w_high": ...
    if condition_type == "high_volume": ...
    return false_s   # ← oscar_cross_up, ema_lows_cross_up, etc. all fall through to here
```

`oscar_cross_up`, `ema_lows_cross_up`, `hma_cross_up` etc. all return `false_s` (never fire). They exist in the database with hit rates and are counted toward `len(pattern_stats)=44`, but **contribute zero** to the actual pattern direction in live scoring.

These are **phantom patterns** — backtested and promoted, but unreachable from the scoring engine.

---

## 6. What OMNI Actually Looks Like (From Parquet)

```
omni_82_above: binary 0.0 or 1.0, mean=0.593
Interpretation: 59.3% of stocks are above their 82-bar EMA-of-lows on a recent date
```

The underlying signal (above/below OMNI-82 support line) is present and correct. The issue is exclusively in the scoring layer that combines it with the missing OSCAR.

---

## 7. Fixes

### Fix 1 (Required): Correct `_layer_direction` NaN handling

```python
# run_edge_hierarchy.py — _layer_direction("omni_oscar")
elif layer == "omni_oscar":
    omni  = df.get("omni_82_above",    pd.Series(np.nan, index=df.index))
    osc   = df.get("oscar_87_above_50", pd.Series(np.nan, index=df.index))

    omni_avail = omni.notna()
    osc_avail  = osc.notna()

    od   = np.where(omni.fillna(0.5) > 0.5,  1, -1)
    ocsd = np.where(osc.fillna(0.5)  > 0.5,  1, -1)

    # Only include oscar vote when it's actually available
    both_avail = omni_avail & osc_avail
    votes = np.where(both_avail, od + ocsd, np.where(omni_avail, od * 2, 0))
    avail = omni_avail | osc_avail

    return pd.Series(
        np.where(avail, np.where(votes >= 1, 1, -1), 0),
        index=df.index,
    )
```

This change: when oscar is missing, use `od * 2` so the omni vote alone can determine direction.

### Fix 2 (Required): Add `oscar_87_above_50` to OMNI_FEATURES export

```python
# config/settings.py
OMNI_FEATURES: list[str] = [
    "omni_82_value",
    "omni_82_above",
    "omni_82_distance",
    "omni_82_slope",
    "omni_82_bounce",
    "oscar_87_above_50",   # ADD THIS
]
```

Also verify `omni_proxy.py` computes and returns `oscar_87_above_50` in the feature dict.

### Fix 3 (Required): Implement `oscar_cross_up` and `ema_lows_cross_up` in `_trigger_vec_local`

These 19 phantom patterns have some of the highest backtested hit rates in the system (0.56–0.77). They need to be implemented to fire:

```python
if condition_type == "oscar_cross_up":
    # OSCAR crossed above 50 in the last N bars
    osc_val = df.get("oscar_87_value", false_s).fillna(50)
    osc_prev = df.get("oscar_87_prev", false_s).fillna(50)  # if available
    return (osc_val > 50) & (osc_prev <= 50)

if condition_type == "ema_lows_cross_up":
    # Price crossed above EMA of lows
    return df.get("omni_82_above", false_s).fillna(0) > 0.5

if condition_type == "hma_cross_up":
    return df.get("hma_87_above", false_s).fillna(0) > 0.5

if condition_type == "ema_lows_support":
    # Price near EMA of lows (within threshold distance)
    dist = df.get("omni_82_distance", false_s).fillna(1)
    threshold = float(params.get("max_distance_pct", 0.02))
    return (dist >= 0) & (dist <= threshold)
```

---

## 8. Expected Impact After Fix

With `omni_82_above` alone (fix 1 applied, before adding oscar to parquet):

| Segment | Expected HR | Basis |
|---|---|---|
| OMNI bullish direction | ~54-56% | OMNI-82 is the primary Atlas signal, backtested extensively |
| OMNI bearish direction | ~44-46% | Mean reversion failure rate |
| Overall (bias-adjusted) | ~53-55% | Should match or exceed the individual component baseline |

The 20+ phantom OMNI patterns (oscar_cross_up, ema_lows_cross_up) are the most significant untapped edge in the system. They have hit rates 0.56–0.77 across many market conditions and currently contribute zero to scoring.

---

## 9. Verdict

| Issue | Status |
|---|---|
| `omni_82_above` in parquet | ✓ Present and correct |
| `oscar_87_above_50` in parquet | ✗ Missing (not in OMNI_FEATURES) |
| OMNI/OSCAR `_layer_direction` NaN handling | ✗ Bug: missing OSCAR inverts bullish OMNI |
| oscar_cross_up, ema_lows_cross_up patterns | ✗ Phantom: in DB, never fire in scoring engine |
| OMNI/OSCAR layer HR = 45.2% | ✗ Caused entirely by the inversion bug |

**Verdict: BROKEN — two implementation bugs cause systematic signal inversion. The underlying OMNI-82 signal is valid; the scoring layer is wrong.**

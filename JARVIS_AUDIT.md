# Jarvis Audit

**Generated:** 2026-06-15
**Finding:** Jarvis produces zero directional rows in the Edge Hierarchy. Root cause confirmed.

---

## 1. Symptom

From EDGE_HIERARCHY_REPORT:

| Layer | N (directional) | Hit Rate 5d | Coverage |
|---|---|---|---|
| jarvis | **0** | n/a | n/a |

## 2. Root Cause: Not in Parquet Export

`jarvis_quality_adjusted` (and `quality_tier`) are computed in `feature_factory.py` but are **not included in `ALL_FEATURES`** in `config/settings.py`.

The parquet export pipeline (`exports/parquet_export.py`, `build_feature_matrix()`) explicitly filters EAV rows to `feature_names = settings.ALL_FEATURES`:

```python
# parquet_export.py line 93
filtered = features_long[features_long["feature_name"].isin(feature_names)].copy()
```

Since `jarvis_quality_adjusted` and `quality_tier` are not in `ALL_FEATURES`, they are silently dropped at export time. They are never written to any parquet file.

### Verified

```
Parquet: feature_matrix_2026-06-14.parquet (6,079 rows, 42 columns)

jarvis_quality_adjusted : MISSING from parquet
quality_tier            : MISSING from parquet
oscar_87_above_50       : MISSING from parquet   ← also affected
omni_82_above           : PRESENT (binary 0/1, mean=0.593)
```

### Feature computation exists

`feature_factory.py` lines 96–115 computes Jarvis correctly:

```python
if tier <= 2:
    features["jarvis_quality_adjusted"] = omni_above * 2.0 - 1.0   # 1.0 if green, -1.0 if not
elif tier == 3:
    features["jarvis_quality_adjusted"] = 0.0
else:
    features["jarvis_quality_adjusted"] = -(omni_above * 2.0 - 1.0)  # inverted for junk
```

The feature is written to `feature_snapshots` (EAV table) but the parquet builder drops it before writing to disk.

### `ALL_FEATURES` in settings.py

```python
PHASE1_FEATURES = [...]          # 25 features: returns, SMAs, RSI, MACD, etc.
REGIME_FEATURES = [...]          # 4 features: spy_above_sma50/200, market_trend, etc.
OMNI_FEATURES   = [...]          # 5 features: omni_82_value/above/distance/slope/bounce
MOMENTUM_V2_FEATURES = [...]     # 6 features: omni_82_distance_5d_change, etc.
ALL_FEATURES    = PHASE1_FEATURES + REGIME_FEATURES + OMNI_FEATURES + MOMENTUM_V2_FEATURES
```

`jarvis_quality_adjusted` and `quality_tier` are in **none** of these lists.

---

## 3. Secondary Issue: Feature Is Orphaned From ML Training Too

Because `jarvis_quality_adjusted` is not in `ALL_FEATURES`, it is also not in `TRAIN_FEATURES_V1`:

```python
TRAIN_FEATURES_V1 = ALL_FEATURES + ["data_quality_score"]
```

Jarvis is:
- Computed in `feature_factory.py` ✓
- Written to `feature_snapshots` EAV ✓
- Excluded from parquet ✗
- Excluded from ML training ✗
- Excluded from confluence scoring ✗
- Excluded from edge hierarchy ✗

The feature exists in the database only and is used by nothing downstream of the nightly pipeline.

---

## 4. Fix

**Option A (recommended): Add to a dedicated inference-only column list**

```python
# config/settings.py
INFERENCE_EXTRA_COLS: list[str] = [
    "jarvis_quality_adjusted",
    "quality_tier",
    "oscar_87_above_50",   # also missing (see OMNI_AUDIT.md)
]
```

Then modify `run_parquet_export()` or `build_feature_matrix()` to include these alongside `ALL_FEATURES` (not mixed in, to avoid changing ML training shape):

```python
# parquet_export.py — write all feature_names + extra inference cols
all_export_cols = feature_names + INFERENCE_EXTRA_COLS
filtered = features_long[features_long["feature_name"].isin(all_export_cols)].copy()
```

**Option B: Add directly to ALL_FEATURES (simpler but forces model retrain)**

```python
ALL_FEATURES = PHASE1_FEATURES + REGIME_FEATURES + OMNI_FEATURES + MOMENTUM_V2_FEATURES + [
    "jarvis_quality_adjusted",
    "quality_tier",
]
```

This would require retraining all walk-forward models since `TRAIN_FEATURES_V1` expands.

**Option C: Mark as side-channel metadata columns**

Similar to how `data_quality_score` is handled — injected outside the `feature_names` filter:

```python
# In build_feature_matrix(), after the pivot:
for col in QUALITY_SIDE_CHANNELS:
    wide[col] = wide["ticker"].map(...)
```

Jarvis could be materialized from the EAV and joined directly.

---

## 5. Impact of Fix

Once `jarvis_quality_adjusted` and `quality_tier` appear in the parquet, the edge hierarchy can evaluate the Jarvis signal properly. Based on its design:

- Tier 1+2 (large/mid cap): Jarvis = omni_82_above × 2 − 1 ∈ {-1.0, +1.0}
- Tier 3 (small cap): Jarvis = 0 (always neutral)
- Tier 4 (micro/junk): Jarvis = inverted OMNI

Expected behavior after fix: Jarvis coverage ~60% (Tier 1+2 rows), directional alignment with OMNI for those tiers. Tier 3 and 4 stocks will still produce 0 directional rows.

---

## 6. Status

| Issue | Status |
|---|---|
| Feature computed in feature_factory.py | ✓ Working |
| Feature written to feature_snapshots (EAV) | ✓ Working |
| Feature exported to parquet | ✗ BROKEN — not in ALL_FEATURES |
| Feature used in ML training | ✗ BROKEN — not in TRAIN_FEATURES_V1 |
| Feature used in confluence/conviction scoring | ✗ BROKEN — parquet is missing |
| Edge hierarchy Jarvis signal | ✗ DEAD — 0 rows, all NaN |

**Verdict: BROKEN — pipeline gap, not logic error. Fix is additive (no retrain required if Option A/C chosen).**

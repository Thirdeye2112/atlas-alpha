# Signal Dependency and Failure Audit

**Generated:** 2026-06-15
**Purpose:** Investigate surprising findings from EDGE_HIERARCHY_REPORT. Determine the true number of independent signal layers in Atlas.

> Supporting detail in: JARVIS_AUDIT.md, OMNI_AUDIT.md, PATTERN_PROBABILITY_AUDIT.md

---

## Executive Summary

Atlas presents as a 5-component confluence system (ML rank, pattern, probability, feature IC, regime). The audit reveals it is effectively a **2–3 component system** with two broken signals, one dead signal, and two structurally dependent signals being double-counted.

| Component | Status | Independent? | Bidirectional? | Issue |
|---|---|---|---|---|
| ML rank | Working | Yes | Yes | None |
| Feature IC | Working | Yes | Yes | None |
| Regime | Working | Marginal | Yes | Removing it improves HR (+0.1%); REWORK |
| Pattern | Broken | No | **No** | Bullish-only; 20 phantom patterns never fire |
| Probability | Broken | No | **No** | Bullish-only; mirrors ML rank bias |
| OMNI/OSCAR | Broken | — | — | Signal always bearish due to missing oscar column |
| Jarvis | Dead | — | — | Never reaches parquet; 0 rows evaluated |

---

## 1. Working Components

### 1.1 ML Rank
- **Status:** WORKING
- **Hit Rate (standalone):** 56.7%
- **IC:** 0.0089
- **Ablation impact:** -0.6% HR when removed (largest single contributor)
- **Bidirectional:** Yes (+1/-1/0 based on prob > 0.55 / < 0.45)
- **Independence:** Yes — primary model output, not derived from any other component
- **Notes:** The most impactful signal in the system. LightGBM model scoring all 39 features cross-sectionally across 1,326-ticker universe.

### 1.2 Feature IC
- **Status:** WORKING
- **Hit Rate (standalone):** 50.6%
- **IC:** 0.0090
- **Ablation impact:** -0.2% HR when removed
- **Bidirectional:** Yes — can invert signals when IC is negative (contrarian mode)
- **Independence:** Partially — uses `feature_regime_performance` table computed from historical IC, which itself depends on the same features as ML rank. However the IC-based direction can diverge from ML rank in specific regime conditions.
- **Notes:** Weakest of the working components by standalone HR but provides genuine orthogonal signal when regime-specific IC patterns diverge from model output.

### 1.3 Regime
- **Status:** WORKING (marginal)
- **Hit Rate (standalone):** 51.6%
- **IC:** n/a (no continuous strength measure)
- **Ablation impact:** +0.1% HR when removed (removing it slightly **improves** performance)
- **Bidirectional:** Yes (+1 for bull+above200, -1 for bear+below200)
- **Independence:** Yes — driven entirely by SPY behavior, independent of individual stock signals
- **Notes:** The ablation result (+0.1% improvement) suggests the regime component is adding noise to alignment rather than signal. It may be useful as a **filter** (scale position size by regime) rather than a full vote. Recommend REWORK: change from alignment vote to conviction multiplier.

---

## 2. Broken Components

### 2.1 Pattern
- **Status:** BROKEN — unidirectional; phantom patterns
- **Hit Rate (standalone):** 54.7%
- **Coverage:** 100%
- **Root Causes:**
  1. **All 26 above-threshold patterns are bullish** (avg_return > 0 for all). `pat_dir` can never be -1. The pattern component cannot issue a bearish signal.
  2. **20+ patterns in DB never fire** in the scoring engine. `_trigger_vec_local` only handles 8 condition types. The highest-performing signal in the system (`sector_leading_nd`, hr=0.867) is a phantom — it never fires.
- **Standalone HR is misleading:** The 54.7% comes from momentum continuation (stocks with positive patterns are mostly bullish), but it's not independent of ML rank.
- **Fix:**
  - Add bearish patterns (overbought_rsi at lower threshold, near_52w_high mean-reversion, gap_up exhaustion)
  - Implement the 20 phantom condition types in `_trigger_vec_local` — especially `sector_leading_nd`, `oscar_cross_up` (hr=0.77), `ema_lows_cross_up` (hr=0.67)

### 2.2 Probability
- **Status:** BROKEN — unidirectional
- **Hit Rate (standalone):** 55.3%
- **Coverage:** 42.1%
- **Root Cause:** Both promoted signals (`ml_rank_bucket/40-60` and `ml_rank_bucket/60-80`) have positive avg_return. `prob_dir` can only be +1 when it fires. No bearish probability signals have been promoted.
- **Structural dependency on ML rank:** The probability component fires when a stock's ML rank falls in the 40–80% percentile. This is not an independent signal — it is a re-encoding of ML rank using a different output form.
- **Fix:**
  - Promote low-rank buckets (0–20, 20–40) as bearish probability signals
  - This requires additional calibration data (currently n=94K and n=121K for the two bullish buckets)
  - Until then, probability is a one-sided bullish bias amplifier, not an independent vote

### 2.3 OMNI/OSCAR
- **Status:** BROKEN — two implementation bugs cause systematic inversion
- **Hit Rate (standalone):** 45.2% (below random; signals systematically inverted)
- **Root Causes:**
  1. `oscar_87_above_50` is not in `OMNI_FEATURES` → not exported to parquet → always NaN in scoring
  2. In `_layer_direction("omni_oscar")`: NaN OSCAR is filled as 0.5, `0.5 > 0.5` is False → ocsd = -1 (bearish). When OMNI is bullish (+1), votes = +1 + (−1) = 0 → resolves to -1 (bearish). **OMNI bullish signal is inverted to bearish by the missing OSCAR vote.**
- **Result:** OMNI/OSCAR direction = -1 for 99.8% of rows (always bearish)
- **HR=45.2%** is simply the base rate of stocks declining on a 5-day horizon
- **Fixes:** (a) Correct `_layer_direction` NaN handling — fall back to OMNI alone when OSCAR is missing; (b) Add `oscar_87_above_50` to `OMNI_FEATURES` in settings.py; (c) Implement phantom OMNI-based patterns

### 2.4 Jarvis
- **Status:** DEAD — feature never exported
- **Hit Rate:** 0 rows evaluated
- **Root Cause:** `jarvis_quality_adjusted` and `quality_tier` are computed in `feature_factory.py` and written to the `feature_snapshots` EAV table, but are not in `ALL_FEATURES` in `settings.py`. The parquet export filters on `ALL_FEATURES`, silently dropping Jarvis before it reaches any scoring or ML pipeline.
- **Fix:** Add to `settings.INFERENCE_EXTRA_COLS` and export alongside `ALL_FEATURES` in `parquet_export.py`.
- **Expected value:** Jarvis applies tier-adjusted OMNI signals. For Tier 1+2 (large/mid cap), Jarvis = OMNI (quality-confirmed). For Tier 4, Jarvis inverts OMNI (contrarian micro-cap logic). It is the primary quality gate in the Atlas original design.

---

## 3. Redundant Components

### Pattern × Probability
- **Agreement rate:** 100%
- **Reason:** Both can only emit +1 or 0. Neither can be -1. When they both fire, they always agree.
- **Independence:** False. They share the same directional domain and both track positive momentum/ML rank bias.
- **Effective vote count:** 2 is counted; ~1 independent signal is being provided

### ML Rank × Probability
- **Agreement rate:** 99.3% (from redundancy table)
- **Reason:** Probability is literally a re-encoding of ML rank (the 40–80% percentile bucket). ML rank → bullish → rank in upper half → probability fires bullish. The signals are nearly identical by construction.
- **This is the most critical redundancy:** The system spends 0.30 weight on ML rank and 0.20 weight on probability in the alignment formula — but probability adds no independent information. The 0.20 weight on probability is effectively a partial ML rank double-count.

### ML Rank × Pattern
- **Agreement rate:** 99.3%
- **Reason:** ML rank is driven by momentum features (returns, RSI, distances). High ML rank → positive momentum. Positive momentum → bullish pattern (consecutive_up, no bearish pattern). When both fire directionally, they almost always agree.

---

## 4. Independent Components

True signal independence requires:
1. Different data source (not derived from same inputs)
2. Bidirectional (can be bullish or bearish)
3. Non-trivial disagreement rate (fires in opposite directions sometimes)

| Component | Data Source | Bidirectional | Disagrees With ML Rank | Independent |
|---|---|---|---|---|
| ML rank | LightGBM (39 features) | Yes | — | Yes (primary) |
| Feature IC | feature_regime_performance (IC by regime) | Yes | Yes (when IC inverts) | Partially |
| Regime | SPY only | Yes | Yes (regime vs stock) | Yes |
| Pattern | Rule-based on price/volume | No (bullish only) | No (always agrees) | **No** |
| Probability | ML rank percentile buckets | No (bullish only) | No (mirrors ML rank) | **No** |

True independent signal count: **2–3** (ML rank, regime, feature IC — the last two with caveats).

---

## 5. True Independent Alignment Count

### Current claim: 5 independent alignment components

```
ml_rank (0.30) + pattern (0.20) + probability (0.20) + feature_ic (0.10) + regime (0.15)
Max aligned = 5
```

### Reality: 2–3 effective independent votes

The maximum useful alignment signal comes from:
1. **ML rank** — primary directional signal
2. **Feature IC** — regime-specific feature evidence
3. **Regime** — market context (marginal; may be better as multiplier)

Pattern and probability add bullish bias amplification when the model is already bullish, but no independent bearish signal. They do not improve bearish call quality.

### Revised alignment model (proposed)

```
Core vote (bidirectional):
  ml_rank    (weight 0.40) — primary model
  feature_ic (weight 0.30) — IC-based regime adjustment
  regime     (weight 0.30) — market context multiplier

Supplementary bullish bias (max 1 bonus):
  if (pattern fires OR probability fires) AND core direction = bullish:
    → add 0.10 to confidence (not a separate vote)
```

Under this model, max aligned_count = 3 (honest), and conviction thresholds would be recalibrated accordingly.

---

## 6. Recommended Architecture Changes

### Priority 1 — Fix broken signals (do not require model retrain)

| Action | Files | Impact |
|---|---|---|
| Add `jarvis_quality_adjusted`, `quality_tier` to parquet export | `config/settings.py`, `parquet_export.py` | Enables Jarvis in scoring |
| Add `oscar_87_above_50` to OMNI_FEATURES | `config/settings.py` | Enables OSCAR in parquet |
| Fix OMNI/OSCAR NaN handling in `_layer_direction` | `run_edge_hierarchy.py` | Restores correct OMNI signal direction |
| Implement 20 phantom patterns in `_trigger_vec_local` | `run_confluence_backtest.py`, `run_edge_hierarchy.py` | Unlocks 0.55–0.87 HR patterns |

### Priority 2 — Fix unidirectionality

| Action | Files | Impact |
|---|---|---|
| Promote low-rank probability buckets (0–20, 20–40) as bearish | `alpha_signal_calibrations` | Enables bearish probability signals |
| Add bearish patterns: `overbought_rsi` (tighter threshold), `near_52w_high`, `gap_up` | Pattern DB | Enables bearish pattern direction |

### Priority 3 — Architectural corrections

| Action | Impact |
|---|---|
| Change regime from alignment vote to conviction multiplier | Removes marginal component from alignment, uses it where it adds genuine value |
| Merge pattern + probability into single "momentum bias" supplementary signal | Removes double-counting; honest aligned_count max = 4 |
| Recalibrate conviction thresholds after fix | Current VERY_HIGH≥68 was calibrated on 5 components; with 3–4 true components, recalibrate |

---

## 7. True Independent Alignment — Backtest Results

Ran `scripts/run_true_alignment_backtest.py` over 529K rows (2015–2026).
3-component model uses only ML rank, feature IC, regime (weights 0.40/0.35/0.25).

### Overall comparison (5d horizon)

| Model | N (directional) | Hit Rate | Expectancy |
|---|---|---|---|
| Original 5-component | 505,590 | **54.5%** | +0.307% |
| True 3-component | 490,522 | 52.7% | +0.291% |

The 3-component model is worse overall — pattern and probability do add predictive value, just not as independent votes. They are capturing momentum continuation that the core model alone misses.

### By aligned_count

**Original (5-component scale):**

| Aligned | N | Hit Rate | Expectancy |
|---|---|---|---|
| 1/5 | 19,453 | 50.5% | +0.150% |
| 2/5 | 128,145 | 53.8% | +0.249% |
| 3/5 | 196,116 | 54.4% | +0.302% |
| 4/5 | 141,846 | 55.3% | +0.351% |
| 5/5 | 20,030 | **58.1%** | **+0.560%** |

**True Independent (3-component scale):**

| Aligned | N | Hit Rate | Expectancy |
|---|---|---|---|
| 1/3 | 199,971 | 50.0% | +0.267% |
| 2/3 | 235,972 | 54.2% | +0.281% |
| 3/3 | 54,579 | **56.5%** | **+0.426%** |

**Observation:** The true 3/3 group (54K rows, HR=56.5%) is smaller but cleaner than the original 5/5 group (20K rows, HR=58.1%). The original 5/5 group is a tight subset that benefits from the momentum bias of pattern+probability stacking on top of core alignment.

### Direction disagreement analysis

121,572 rows where original and true independent directions disagree.

| Model | HR on mismatch rows |
|---|---|
| Original (includes pattern+probability) | **55.0%** |
| True independent (3-component only) | 45.7% |

**Critical finding:** On the 121K rows where they disagree, the original 5-component model is right 55% of the time vs 45.7% for the core-only model. This confirms pattern and probability carry real predictive value — but they are NOT independent votes. They are momentum continuation signals that should be weighted as a bonus, not counted as separate alignment votes.

### Signal correlation (confirmed)

| Pair | Agreement rate |
|---|---|
| Pattern × Probability | **100.0%** |
| Pattern × ML rank | 99.3% |
| Probability × ML rank | 99.3% |

### Conclusion on Task 4

**True independent alignment count: 2–3 (not 5).**

The current formula counts 5 votes where there are effectively 2–3 sources of independent information. Pattern and probability are correlated with ML rank at 99.3% and with each other at 100%. They cannot be counted as independent votes.

However, they do carry **incremental predictive value** (55% HR on mismatch rows vs 45.7% for core-only). The correct treatment is to preserve them as a **confidence modifier** rather than as full alignment votes.

**Recommended formula:**
```
Core alignment: ml_rank (40%) + feature_ic (35%) + regime (25%)
Max aligned_count = 3

Momentum bonus: +0.10 to raw confidence score when (pattern OR probability) agrees with core direction
```

Under this model the 3/3 bucket (HR=56.5%, n=54K) becomes the effective "VERY_HIGH" conviction tier, with the momentum bonus providing an additional quality gate within that tier.

---

## 9. Summary Verdict

### Does Atlas have 5 independent signal layers?

**No. It has 2–3.**

| Component Group | Effective Count |
|---|---|
| ML rank (primary model) | 1 |
| Feature IC (regime IC) | 1 (partial) |
| Regime filter | 1 (better as multiplier) |
| Pattern + Probability (both bullish-only, correlated) | ~1 combined |
| OMNI/OSCAR | 0 (broken) |
| Jarvis | 0 (dead) |
| **Total effective independent votes** | **2–3** |

### What needs to happen before Atlas can claim 5 independent layers

1. Fix Jarvis pipeline (parquet export gap)
2. Fix OMNI/OSCAR scoring (NaN inversion bug)
3. Add bearish patterns with hr > 0.55 and avg_return < 0
4. Promote bearish probability buckets (0–20, 20–40 rank)
5. Implement 20 phantom patterns (especially sector_leading_nd, oscar_cross_up)
6. Verify feature IC can disagree with ML rank in a non-trivial fraction of rows

Until then, the system has strong performance in the bullish direction from a well-calibrated ML model, partially filtered by regime and feature IC, with pattern and probability adding redundant momentum confirmation that never issues a bearish counterweight.

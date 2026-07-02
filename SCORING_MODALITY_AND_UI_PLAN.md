# Atlas Alpha — Scoring Modality Audit + UI Cleanup Plan

**Date:** 2026-07-01
**Scope:** (1) verify every research modality is firing and actually contributing to the
Atlas Alpha score; (2) a per-tab UI cleanup plan to surface the pertinent details.

---

## Part 1 — Modality → Scoring audit

The overall score is computed in `artifacts/api-server/src/lib/scoring.ts` →
`calcAtlasScore()`, assembled in `analysisEngine.ts`. It is a weighted blend of **8
terms** (7 factor modalities + the V4 ML score), with regime/laggard/alignment modulators.

### A. Modalities that DO contribute to `overall` ✅

| # | Modality | Default weight | Notes |
|---|---|---|---|
| 1 | Trend (`trendAlignmentScore`) | 20% | ×regimeGate ×laggardDamp |
| 2 | Momentum | 22% | ×regimeGate |
| 3 | Volume | 15% | |
| 4 | Options | 9% | pinned |
| 5 | Relative Strength | 16% | ×laggardDamp |
| 6 | Market Regime | 4% | also gates trend/momentum |
| 7 | Exhaustion | 14% | pinned; carries several structural signals (below) |
| 8 | **V4 ML score** (`mlScore`) | **20% when present** | rank_percentile×100; the 7 factors scale to 80% |

Modulators: `regimeGate` (0.70/0.85/1.0), `laggardDamp` (0.55–1.0, discounts stale
trend/RS when momentum+volume don't confirm), `alignPenalty` (confidence only), IC gate
(caps confidence / flags contrarian tickers).

**Exhaustion folds in these structural signals:** distribution_top, capitulation,
reversal_bar, breakout, extended_decline, **double_top**, **parabolic_rise**. So *those
two chart-structure patterns* reach the score via exhaustion.

### B. ML channel health (rechecked today — improved vs the 2026-06-16 report)

- **Fresh:** `predictions` latest = **2026-07-01**, 37,170 rows. ✅ (June report: stale-ish 06-14)
- **Rank quantization largely fixed:** **51 distinct `rank_percentile`** on the latest
  date (June report: only **7**, 53% tied). Discrimination is now usable. ✅
- `mlScore = rank_percentile × 100`, fused at 20%. So the ML term is live and discriminating.
- Still open (from June, verify): `confidence` / `probability_positive` near-constant
  (calibration inactive); `combo_key` NULL. These don't break scoring (rank is the channel)
  but the CONF/PROB+ columns in the UI remain informational-only until calibration runs.

### C. Modalities that do NOT contribute to `overall` ❌ (display-only / research-only)

Verified: `analysisEngine.ts` references **none** of these when scoring, and the V4 model
feature set is continuous-TA only (rsi/regime/atr/mr_score family — **no candle/pattern/
news/omni** columns in `src/atlas_research/models/`).

| Modality | Where it lives | Surfaced in UI? | In score? |
|---|---|---|---|
| Candlestick patterns (19–24, `candlestick_events`) | research DB | PatternHitBadge, panels | ❌ (not in ML either) |
| Chart-structure engine (13 families: triangles, flags, wedges, H&S, cup&handle) | `ta/patterns.py` + deep-dive | Research/Intel panels | ❌ (only double-top & parabolic reach score via exhaustion) |
| Omni / Oscar / EMA-lows / HMA proprietary signals | `backtest/conditions.py` | IntelPanel | ❌ |
| `deep_dive_events` confluence layer | research DB | Research tab | ⚠️ only `mr_score` reaches score, via ML |
| News (`news_events`) | research DB | IntelPanel | ❌ |
| Intraday similarity / behavior | `intraday_*` | Research + Bot Lab panels | ❌ |

### D. Verdict + recommendation

**Not all modalities contribute to the score.** The 8 factor/ML terms do; the
candlestick / chart-pattern / omni / news / confluence modalities are **display-only**.

**This is arguably the CORRECT state given our foundation-first mandate** — and the
walk-forward evidence backs it: candlesticks alone are a coin flip (research iter 1-3 +
our `WALKFORWARD_RESULTS.md`), so bolting them onto the score as hand-weighted terms would
add noise. The right way to make a modality "contribute":

1. Test it through the Concept Lab / promotion pipeline (`probability/` engine) with
   walk-forward + costs — same bar we just cleared for the daily hypotheses.
2. Promote survivors **into the V4 feature set** (the single validated channel), and let
   the walk-forward IC decide its weight — **do not** add ad-hoc terms to `calcAtlasScore`.
3. Re-verify the ML fusion picks up the new features (predictions regenerate → `mlScore`).

**Concrete gap list to feed the research backlog (not to wire in blindly):**
- Candlestick modality → test *gated* forms (pattern × trend × support), not raw patterns.
- Chart-pattern engine (triangles/flags/wedges/H&S/cup) → wire into the conditions engine,
  reproduce Bulkowski stats, promote survivors to features.
- News → sentiment/attention-change features (needs the social/news feature build).
- Confidence calibration (`confidence`/`probability_positive` dead) → fix so the UI
  CONF/PROB+ columns become real, not informational.

### E. VALIDATION RESULTS (2026-07-01) — which modalities earned promotion

Ran walk-forward on `deep_dive_events` (production detections, 400-liquid basket, OOS
activation rule: a pattern is only "traded" in year Y if it worked through Y−1). Full
report: `atlas-research/reports/validity/MODALITY_WALKFORWARD.md`. Edges are 5-day, vs
the universe base that year, comparable to the daily survivors (bb_lower +0.42%, etc.).

**✅ PROMOTE — chart-STRUCTURE patterns carry real, consistent OOS edge:**
| pattern | dir | OOS edge (5d) | folds+ |
|---|---|---|---|
| bull_pennant | long | +0.79% | 9/9 |
| falling_wedge | long | +0.60% | 10/10 |
| bear_pennant | short | +0.52% | 10/10 |
| hs_top | short | +0.36% | 5/7 |
| hs_bottom | long | +0.29% | 4/5 |
| descending_channel_break | long | +0.22% | 5/5 |
| rising_wedge | short | +0.21% | 8/10 |

**🟡 CANDLESTICKS — only in an oversold context; the gate is the edge, not the candle:**
- Raw candlestick long (aggregate): **−0.03%, 4/10 folds** → coin flip, as expected.
- `candle × mr_oversold`: **+0.26%, 9/10 folds**; `× above200 × oversold`: **+0.36%, 9/10**.
- `candle × above_ema200` (trend-gate): **−0.06%** → trend-gating HURTS (buying candles into
  strength = the exhaustion trap we already found).
- Individually only bullish_harami/inverted_hammer/tweezer_top are mildly +; engulfing,
  piercing, shooting_star, tweezer_bottom are ≤0.

**❌ KEEP DISPLAY-ONLY:** raw candlesticks, trend-gated candles, bear_flag (−0.45%),
bullish_engulfing (−0.15%).

**Action (foundation-first — into the validated channel, not ad-hoc score terms):**
1. Add the 7 promoted structure patterns as V4 features (`pattern_fired` × direction).
2. Add one candlestick feature = **bullish-candle × oversold interaction** (not raw candles).
3. Regenerate predictions; the ML term (already 20% of `overall`, fresh, 51-rank) then
   carries these modalities into the score with walk-forward-set weight.
4. Leave `calcAtlasScore` factor terms untouched — no new hand-weighted terms.

---

## Part 2 — UI cleanup plan, by tab

Nav (`components/layout/AppLayout.tsx`): **Dashboard · Scanner · Lab (Backtest) · Bot Lab ·
Transcripts · Ref**. Also routed: **Research**, **Watchlist**. Pages are large monoliths
(Bot Lab **3,483** lines, Dashboard 1,758, BacktestLab 1,380, Scanner 1,308, Research
1,092) — the core UX problem is **density without hierarchy**: everything is on screen at
once, nothing is prioritized. Global theme first, then per-tab.

### Global (applies to all tabs)
- **One visual hierarchy:** a single card system, consistent heading sizes, 8px spacing
  grid. Today each page invents its own layout.
- **Score legibility:** the overall score + label + direction + confidence should render
  the same way everywhere (one `ScoreBadge` component) with color = direction, size =
  conviction. Reuse across Dashboard/Scanner/Watchlist/Bot Lab.
- **Progressive disclosure:** collapse secondary detail behind expanders; lead with the
  decision (score, entry/stop/target, why). Split the monolith pages into section
  components (esp. Bot Lab).
- **Stale/health honesty:** a small global freshness chip (predictions date, last scan,
  bot heartbeat) so the user always knows what's live vs stale.

### Dashboard (`pages/Dashboard.tsx`, 1758 lines)
Currently: chart + score gauges + conviction + intel + retracement + backtest strip all
stacked.
- **Lead with the verdict card:** ticker, overall score gauge, direction, confidence,
  time-horizon, expected move, entry/stop/target (SignalTargets) — above the fold, one row.
- **Factor breakdown as a compact bar strip** (the 8 terms with their weights) so the user
  sees *why* the score is what it is — and can see the ML term is contributing.
- **Move Conviction Alerts to a right rail** (it's the "you gotta buy this" signal — keep
  it visible but not shoving the chart down).
- **Collapse** Retracement / Backtest strip / Intel into tabs-within-the-panel; they're
  reference, not primary.
- **Narrative:** show the top 2 sentences, "expand" for the full narrative.

### Scanner (`pages/Scanner.tsx`, 1308 lines)
Currently: big sortable table + custom-scan tab + reversal-short table + chart preview.
- **Column diet:** default to Ticker · Score · Dir · Conf · RVOL · Catalysts · ML-rank.
  Everything else behind a "columns" toggle. Right now too many columns compete.
- **Catalyst chips** (already computed in `calcScannerResult`) rendered as colored pills,
  not text — fastest way to read "why is this here."
- **Sticky header + row hover chart preview** (ScannerChartPreview) instead of a separate
  preview pane.
- **Split long/short** into clearly labeled sections; the reversal-short table should be a
  toggle, not a parallel table.

### Research (`pages/Research.tsx`, 1092 lines)
Currently: model metrics + predictions table + runs + concept lab + health, all stacked.
- **Three clear sub-tabs:** *Predictions* (the table + ticker drawer), *Model* (metrics,
  top features, model selector), *Pipeline* (health, runs). Today they're one long scroll.
- **Surface feature importance** (TopFeaturesPanel) prominently — it's the answer to "what
  is the ML actually using," which ties directly to the Part-1 audit.
- **Freshness + failed-run banner** at top (the nightly run can fail; make it loud).

### Bot Lab (`pages/BotLab.tsx`, 3483 lines) ← biggest cleanup
Currently: config, positions, history, learning, sim-lab, AI-brain, intelligence,
attribution, meta-health — nine concerns in one file.
- **Split the file** into the existing sub-tab components (they already exist:
  ConfigTab / PositionsTab / HistoryTab / LearningTab / SimLabTab / AiBrainTab). The
  monolith is the main maintainability + load problem.
- **Lead tab = "Status"**: bot on/off + heartbeat, open P&L, today's trades, regime badge,
  one-line "what the bot is doing right now." Everything else behind tabs.
- **Positions table:** lead with P&L, entry trigger, exit reason, R-multiple; collapse the
  rest. Use the shared ScoreBadge.
- **Learning/attribution:** one headline metric each (per-setup expectancy, best/worst
  setup) with the deep tables behind "expand."

### Backtest Lab (`pages/BacktestLab.tsx`, 1380 lines)
Currently: cross-sectional IC, rolling IC, deciles, weight table, score timeline.
- **Lead with the verdict:** mean rank-IC + decile monotonicity chart (the two numbers
  that say "is the score predictive"). Everything else below.
- **Consolidate the IC views** (cross-sectional card, rolling chart, horizon bars) into one
  "IC" section with a horizon selector, instead of three separate blocks.

### Watchlist (`pages/Watchlist.tsx`, 673 lines) — already the leanest
- Add the shared **ScoreBadge + catalyst chips + freshness** per row so it matches Scanner.
- Alerts UI (bell) is fine; just align styling to the global card system.

### Transcripts / Ref — leave functional, apply global theme only.

### Suggested sequencing
1. Build shared primitives (**ScoreBadge**, **FactorBar**, **FreshnessChip**, card system).
2. Dashboard verdict-card refactor (highest-traffic tab).
3. Split **Bot Lab** monolith into its sub-tab components (biggest debt).
4. Scanner column-diet + catalyst chips.
5. Research 3-sub-tab split + feature-importance surfacing.
6. Backtest Lab consolidation; Watchlist parity pass.

_This is a plan only — no code changed. Part 1 is an audit of current behavior; Part 2 is
a proposed refactor to sequence next._

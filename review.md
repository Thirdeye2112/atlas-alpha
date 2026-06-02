# Atlas Bot Autonomous Intelligence — Code Review

**Date:** 2026-06-02  
**Commit:** 450ec57  
**Verdict: PASS** *(4 bugs found and fixed during review)*

---

## Scope

Files reviewed: `botIntelligence.ts`, `botScheduler.ts`, `paperTradingEngine.ts`, `bot.ts` routes, `BotLab.tsx`, `paperTrading.ts` schema, `index.ts`

---

## Bugs Fixed

### 1. Stop-multiplier math was inverted — **critical**
**File:** `artifacts/api-server/src/lib/paperTradingEngine.ts`

`stopDist = stopPrice - quotePrice` yields a negative number for long trades. Multiplying by `1.25×` made it *more* negative — tightening the stop instead of widening it. Every `breakout`, `gamma_squeeze`, and `short_squeeze` entry would have had a stop closer to price than intended, causing systematic premature stop-outs.

**Fix:** compute `riskDist = quotePrice - stopPrice` (always positive), apply multiplier, subtract from price. Target is also widened proportionally to preserve 3:1 R:R.

---

### 2. Scheduler DST detection was unreliable — **medium**
**File:** `artifacts/api-server/src/lib/botScheduler.ts`

Used `getTimezoneOffset()` heuristic which only works correctly when the host's own timezone happens to exhibit DST. On UTC hosts (which Replit runs on), ET DST detection was wrong for part of the year — market-hours gating could fire 1 hour early/late during EST→EDT transitions.

**Fix:** replaced with `new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", ... })` — IANA tz database always gives correct ET wall-clock time on any host.

---

### 3. Self-learning adaptation silently no-ops with empty config — **medium**
**File:** `artifacts/api-server/src/lib/botIntelligence.ts`

When `entryCriteria` is empty (default), `criteria.find(c => c.field === "score" && c.operator === "gte")` returns `undefined`. `criteria.map(...)` then returns the same empty array — adaptation is logged as successful but the config is unchanged.

**Fix:** if no existing `score gte` criterion is found, inject a new one rather than mapping over nothing.

---

### 4. Self-learning has a concurrency race — **low-medium**
**File:** `artifacts/api-server/src/lib/botIntelligence.ts`

The 5-min background loop and `POST /bot/self-learn` can both call `runSelfLearning()` simultaneously, reading the same current threshold and writing duplicate/conflicting log entries.

**Fix:** added a `selfLearningRunning` boolean mutex; concurrent callers return `null` immediately.

---

### 5. UI empty-state threshold mismatch — **cosmetic**
**File:** `artifacts/atlas-alpha/src/pages/BotLab.tsx`

Empty state said "≥30 closed trades" but backend triggers at `closed.length < 10`.

**Fix:** corrected to "≥10".

---

## Architecture Assessment

| Area | Status | Notes |
|---|---|---|
| Market regime gate | ✅ Sound | Reads 1-min market cache; regime + breadth + VIX combine correctly |
| Sim gate | ✅ Sound | 30-min cached aggregation; score-bucket + RSI-zone key is reasonable |
| Calibration gate | ✅ Sound | Correctly rejects `cold-start`; IC sign propagates to contrarian flag |
| Scanner categories | ✅ Sound | 7 categories, thresholds reasonable for their purpose |
| Stop/target widening | ✅ Fixed | Math now correct; 3:1 R:R preserved after widening |
| Self-learning | ✅ Fixed | Mutex + config-inject-or-update |
| Scheduler DST | ✅ Fixed | IANA tz via `Intl.DateTimeFormat` |
| Circular deps | ✅ Safe | Linear chain: `botIntelligence → paperTradingEngine → botScheduler → index` |
| Background loop | ✅ Good | Try/catch per step; fire-and-forget DB writes; 5-min interval appropriate |
| New API routes | ✅ Good | Consistent error handling, pino logging, no missing guards |
| BotLab.tsx | ✅ Good | Live countdown hook, query invalidation correct, category badges render cleanly |

---

## Intelligence Gates Summary

### Gate 1 — Market Regime
Reads `/api/market/overview` cache (1-min TTL). Blocks all new entries when `regime = risk_off` (VIX > 28 or breadth < 25%). Raises min score to 70 when breadth is weak (< 40%). Rationale: avoid deploying capital into deteriorating macro conditions.

### Gate 2 — Sim Validation
Queries `sim_trades` for 5D win rate in the same score-bucket × RSI-zone. Requires ≥ 55% historical hit rate. Cached 30 min. Rationale: historical sim results are the closest proxy for out-of-sample performance on novel setups.

### Gate 3 — Calibration Quality
Requires a `live-fit` or `stale-fit` calibration entry (not `cold-start`) with `P(positive 5D) ≥ 52%`. Blocks if IC is strongly contrarian and the trade direction is momentum. Rationale: logistic regression calibration is our best probability estimate; cold-start entries have no predictive value.

### Gate 4 — Scanner Categories
Classifies each candidate into up to N categories based on score, momentum, volume, ATR, and RSI. Position size multipliers: `gamma_squeeze/short_squeeze = 0.6×`, `mean_reversion = 0.75×`, `breakout/gap_setup = 0.85×`, `high_prob_long/institutional_accum = 1.0×`. Stop width is widened for high-volatility categories (gamma/squeeze: 1.5×, breakout: 1.25×).

### Gate 5 — Self-Learning Threshold
Compares last 30 closed paper trade win rate vs sim-expected win rate for the same score-bucket mix. If gap > 12% below expectation → raise score threshold +3 pts (max 82). If outperforming by > 8% with win rate > 62% → lower -2 pts (min 60). Logs every change to `bot_adaptation_log`. Runs hourly in background, and on-demand via `POST /api/bot/self-learn`.

---

## Known Limitation (Pre-existing, Out of Scope)

Bot control endpoints (`/bot/run`, `/bot/config`, `/bot/self-learn`) are unauthenticated. Acceptable for a paper-trading internal tool, but should be behind auth middleware before any real-money or multi-user integration.

---

## Typecheck Status

```
artifacts/api-server   ✅ 0 errors
artifacts/atlas-alpha  ✅ 0 errors
artifacts/mockup-sandbox ✅ 0 errors
scripts                ✅ 0 errors
```

---
name: Paper trading bot architecture
description: BotLab page design, API endpoints, DB schema, and AI analysis wiring for the paper trading bot feature
---

## Overview
Full AI paper trading bot built as the "Bot Lab" tab at `/bot`.

## DB Tables (lib/db/src/schema/paperTrading.ts)
- `bot_config` — single row (id=1 always), holds entry criteria (JSONB), exit rules, position sizing, enabled flag
- `paper_trades` — all paper trades (open + closed) with entry/exit price, score, P&L, exit reason

## API endpoints (artifacts/api-server/src/routes/bot.ts)
All at `/api/bot/*` — NOT in OpenAPI spec; frontend uses direct fetch calls.
- GET/PUT `/bot/config` — get or update the single config row
- POST `/bot/run` — manually trigger a bot cycle
- GET `/bot/status` — running state + open/closed counts + portfolio value
- GET `/bot/trades?status=open|closed|all` — trades enriched with live currentPrice/unrealizedPnlPct from scan job
- GET `/bot/stats` — win rate, avg P&L, byExitReason breakdown, portfolio value
- POST `/bot/trades/:id/close` — manual close with optional exitPrice body param
- POST `/bot/analyze` — trigger Claude AI analysis, returns `{ analysis: string }`

## Bot cycle logic (artifacts/api-server/src/lib/paperTradingEngine.ts)
1. Load config; return early if disabled or already running
2. Get analyses from `getOrStartScanJob().analyses`
3. For each open trade: check score_drop (score < threshold) / direction_flip / max_hold — close if triggered
4. Find new entries: filter analyses by entryCriteria, sort by score desc, open up to slotsAvailable
5. If ≥3 unanalyzed closed trades after cycle → fire-and-forget `generateAiAnalysis()`

## AI analysis
- Uses Anthropic SDK directly (not template) with `AI_INTEGRATIONS_ANTHROPIC_API_KEY` + `AI_INTEGRATIONS_ANTHROPIC_BASE_URL`
- Model: `claude-sonnet-4-6`
- Prompt includes: bot config, performance stats, last 30 closed trades row-by-row
- Asks for: what's working, exit threshold assessment, exit reason reliability, 2-3 param improvements

## Frontend (artifacts/atlas-alpha/src/pages/BotLab.tsx)
- 4 tabs: CONFIG | POSITIONS | HISTORY | AI BRAIN
- CONFIG: full filter builder (same CS_FIELDS/CS_OPS constants duplicated inline), exit rules, position sizing
- POSITIONS: live table of open trades with currentPrice/unrealizedPnl enriched server-side
- HISTORY: closed trades with sortable P&L, exit reason badges, score delta
- AI BRAIN: stats grid (8 cards) + exit reason breakdown + Claude analysis with "ANALYZE NOW" button

## Key design notes
- Bot config criteria stored as JSONB (same `CustomCriterion[]` shape as custom scanner)
- Filter evaluation logic (`applyCustomCriterion`) duplicated in paperTradingEngine.ts (cannot import from route files)
- `lib/db` must be rebuilt (`pnpm run typecheck:libs`) before api-server typecheck picks up new schema exports
- Frontend does NOT use codegen hooks — direct fetch with inline types

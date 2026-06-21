---
name: run-atlas-alpha
description: Run, start, build, test, or screenshot the Atlas Alpha app — Node/Express API server (port 8080) and Vite/React frontend (port 20959). Use for any request to launch the UI, test API endpoints, verify ML signal badge, or check dashboard behavior.
---

# Atlas Alpha — Run Skill

Node/Express API + Vite/React SPA. API at port 8080, UI at port 20959.
Paths relative to `C:\Atlas\atlas-alpha`.

## Build

```powershell
# API server
Set-Location C:\Atlas\atlas-alpha\artifacts\api-server
pnpm run build
# Output: artifacts/api-server/dist/index.mjs

# Frontend (production)
$env:PORT = "20959"; $env:BASE_PATH = "/"
Set-Location C:\Atlas\atlas-alpha\artifacts\atlas-alpha
pnpm run build
# Output: artifacts/atlas-alpha/dist/public/
```

## Run — Agent Path

```powershell
# Start API (background window)
Start-Process powershell -ArgumentList "-NoExit","-Command", `
  "`$env:PORT='8080'; `$env:DATABASE_URL='<set in .env, do not hardcode>'; `$env:DATABASE_URL_RESEARCH='<set in .env, do not hardcode>'; `$env:SESSION_SECRET='<set in .env, do not hardcode>'; Set-Location 'C:\Atlas\atlas-alpha\artifacts\api-server'; node --enable-source-maps ./dist/index.mjs" `
  -WindowStyle Normal
Start-Sleep -Seconds 5

# Smoke tests — verified 2026-06-10
Invoke-WebRequest "http://localhost:8080/api/research/signal/AAPL" -UseBasicParsing | ConvertFrom-Json | Select-Object available, ml_signal_strength, ml_direction, ml_rank_percentile
# available=True, ml_signal_strength=MODERATE, ml_direction=NEUTRAL, ml_rank_percentile=38.86

Invoke-WebRequest "http://localhost:8080/api/stock/AAPL" -UseBasicParsing | ConvertFrom-Json | Select-Object ticker, atlasScore

# Start frontend dev server
$env:PORT = "20959"; $env:BASE_PATH = "/"; $env:NODE_ENV = "development"
Set-Location C:\Atlas\atlas-alpha\artifacts\atlas-alpha
Start-Process powershell -ArgumentList "-NoExit","-Command", `
  "`$env:PORT='20959'; `$env:BASE_PATH='/'; `$env:NODE_ENV='development'; Set-Location 'C:\Atlas\atlas-alpha\artifacts\atlas-alpha'; pnpm run dev" `
  -WindowStyle Normal
# UI at http://localhost:20959
```

## Key Routes

| Endpoint | Description |
|----------|-------------|
| `GET /api/healthz` | Health check (not `/api/health` or `/healthz`) |
| `GET /api/stock/:ticker` | Full analysis with AtlasScore |
| `GET /api/research/signal/:ticker` | ML signal (available, strength, direction, rank) |
| `GET /api/research/signals?tickers=A,B,C` | Batch ML signals |
| `GET /api/research/metrics/latest` | Model registry metrics |
| `GET /api/research/predictions` | All current predictions |

## MLSignalBadge

Rendered in `Dashboard.tsx` directly below `<ScoreGauge>`. Calls `useMLSignal(ticker)` → `GET /api/research/signal/:ticker`. **Renders null when `available=false`** — no error state shown.

To verify it's working: open `http://localhost:20959/?ticker=AAPL`. A small ML Signal card should appear under the score gauge showing strength, direction, P(+5d) bar, rank percentile, expected 5d return, and confidence.

## Gotchas

- Health is at `/healthz`, returns `{"status":"ok"}`
- `PORT` and `BASE_PATH` env vars are **required** — Vite throws on startup without them
- API must be rebuilt (`pnpm run build`) after any route file change
- TSX generics need trailing comma: `<T,>` not `<T>` (esbuild/JSX ambiguity)
- `DATABASE_URL` = atlas_alpha DB; `DATABASE_URL_RESEARCH` = atlas_research DB

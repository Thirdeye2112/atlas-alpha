---
name: Local deployment & GitHub sync
description: Atlas Alpha runs locally on user's Windows laptop, not on Replit. Replit is code editor only. GitHub is the sync bridge.
---

# Local Deployment Setup

**Why:** User runs Atlas Alpha locally to avoid Replit resource costs.

**Architecture:**
- Replit = code editor only (stop workflows via the green ▶ button at top to save cycles)
- GitHub = `https://github.com/Thirdeye2112/Replit-Quant.git` (remote name: `subrepl-6zfw98p5`)
- Laptop = actual runtime (Node 24, PostgreSQL 18, pgAdmin4)

**Laptop path:** `C:\Users\napan\OneDrive\Documents\Replit\Quant-Signal-Platform`

**To push Replit → GitHub:**
```
git push https://Thirdeye2112:$GITHUB_TOKEN@github.com/Thirdeye2112/Replit-Quant.git main
```
(GITHUB_TOKEN is stored in Replit Secrets)

**To update laptop after push:**
```powershell
cd "C:\Users\napan\OneDrive\Documents\Replit\Quant-Signal-Platform"
git pull
pnpm --filter @workspace/api-server run build
```

**Startup script** (`start-atlas.ps1` in api-server folder):
```powershell
$env:DATABASE_URL = "postgresql://postgres:Postnat74%3F@localhost:5432/atlas_alpha"
$env:SESSION_SECRET = "..."
$env:PORT = "8080"
$env:ANTHROPIC_API_KEY = "..."
cd "C:\Users\napan\OneDrive\Documents\Replit\Quant-Signal-Platform\artifacts\api-server"
node --enable-source-maps .\dist\index.mjs
```

**Why:** `?` in Postgres password must be URL-encoded as `%3F`.

**How to apply:** Any session involving code changes that need to reach the user's laptop.

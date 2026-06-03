---
name: Windows local setup gotchas
description: Known issues and fixes when running Atlas Alpha locally on Windows with pnpm
---

## Key fixes required for Windows

**preinstall script**: Root `package.json` has a `sh -c '...'` preinstall that fails on Windows. Remove it entirely.

**drizzle.config.ts**: `path.join(__dirname, ...)` doesn't resolve correctly for drizzle-kit on Windows. Use `"./src/schema/index.ts"` (relative path) instead.

**API dev script**: `export NODE_ENV=development` is Unix-only. Remove it — just use `pnpm run build && pnpm run start`.

**API .env loading**: `node --env-file=.env` fails if the .env was created with `Out-File -Encoding utf8` (adds BOM). Instead set env vars directly in PowerShell before running: `$env:DATABASE_URL=...`.

**Native binaries**: The lockfile is generated on Linux. Windows needs platform-specific binaries installed manually:
- `pnpm add -D @rollup/rollup-win32-x64-msvc -w`
- `pnpm add -D lightningcss-win32-x64-msvc -w`
- `pnpm add -D @tailwindcss/oxide-win32-x64-msvc -w`

**psql password prompt**: psql's interactive password prompt doesn't work in PowerShell. Use `$env:PGPASSWORD="password"` before the psql command.

**psql JSON escaping**: Don't embed JSON in `-c` commands in PowerShell — quotes get mangled. Write SQL to a temp file with `@'...'@ | Out-File -Encoding ascii` and use `-f` instead.

**ticker_whitelist NOT NULL**: Local schema has NOT NULL on ticker_whitelist but Replit DB stores NULL. Use `''` (empty string) when inserting locally.

**vite.config.ts truncation**: When editing .ts files with Notepad, the file can get truncated. Always use "Save As → All Files → no .txt extension". For vite.config.ts, also remove the Replit-specific plugins (`cartographer`, `devBanner`) which aren't needed locally.

## Start commands (every session)

Window 1 (API):
```
cd "C:\Users\napan\OneDrive\Documents\Replit\Quant-Signal-Platform"
$env:DATABASE_URL="postgresql://postgres:Postnat74%3F@localhost:5432/atlas_alpha"
$env:SESSION_SECRET="atlas-local-secret-key"
$env:PORT="8080"
pnpm --filter @workspace/api-server run dev
```

Window 2 (Frontend):
```
cd "C:\Users\napan\OneDrive\Documents\Replit\Quant-Signal-Platform"
$env:PORT="3000"
$env:BASE_PATH="/"
pnpm --filter @workspace/atlas-alpha run dev
```

App at http://localhost:3000

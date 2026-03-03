# Qaff Studio — Production Audit Report

**Date:** 2026-02-21  
**Scope:** `install.sh`, `deploy.sh`, `ecosystem.config.cjs`  
**Target:** Ubuntu 24.04 clean server

---

## Bugs Found & Fixed

| # | Issue | Severity | Fix |
|---|-------|----------|-----|
| 1 | `set -euo pipefail` + apt grep pipe → script dies if grep finds 0 matches | 🔴 Critical | Removed `-e`, added explicit `die()` helper |
| 2 | `npm build 2>&1 \| tail -5` → build errors masked, exit code lost | 🔴 Critical | Run bare `npm run build`, check `$?` manually |
| 3 | `lsof` used in deploy but not installed in apt step | 🔴 Critical | Added `lsof` to apt-get install list |
| 4 | `pm2 startup` only printed, not executed | 🔴 Critical | Auto-executes the `sudo` command via `eval` |
| 5 | Bun PATH not sourced in current session before `tsx` install | 🟠 High | `export BUN_INSTALL / PATH` before all Bun checks |
| 6 | `sed -i "s\|cwd: '.*'\|..."` in deploy — broken because ecosystem uses `__dirname` | 🟠 High | Removed dangerous sed patch entirely |
| 7 | `openssl rand` fallback used `xxd -p` which may not be installed | 🟡 Medium | Replaced with `tr -dc 'a-f0-9'` (pure bash) |
| 8 | `npm install 2>&1 \| tail -3` → real errors swallowed | 🟡 Medium | Run bare `npm install`, die on failure |
| 9 | Port kill used only `kill -9` without SIGTERM first | 🟡 Medium | SIGTERM first, then SIGKILL after 1s |
| 10 | Health check — single attempt, may fail on slow startup | 🟡 Medium | Retry loop: 3 attempts × 3s |
| 11 | `lsof -ti` only — fails if lsof missing | 🟡 Medium | Fallback chain: `lsof` → `fuser` → `ss` |
| 12 | No explicit check that `.next/standalone/server.js` was created after build | 🟡 Medium | Added check after `npm run build` |
| 13 | SESSION_SECRET replacement only if placeholder — won't add if key missing entirely | 🟡 Medium | Also appends if key absent from `.env` |
| 14 | DATABASE_URL not verified in .env | 🟡 Medium | Injects `DATABASE_URL=file:./data/app.db` if missing |

---

## Final Script Behavior (Clean Ubuntu 24)

```
[1/9] Timezone → Africa/Cairo
[2/9] apt: curl wget unzip openssl build-essential sqlite3 ffmpeg lsof
[3/9] Node 20 via NodeSource (removes old node first if needed)
[4/9] Bun (PATH sourced in-session + persisted to .bashrc)
[5/9] PM2 + tsx globally; pm2 startup auto-executed
[6/9] .env: DATABASE_URL injected, SESSION_SECRET generated
[7/9] data/ dirs + /var/log/qaff (or fallback to data/logs)
[8/9] npm install → prisma generate → prisma db push → seed Admin password
[9/9] npm run build → verify .next/standalone/server.js exists
```

## ecosystem.config.cjs — No Hardcoded Paths

Uses `const PROJECT_DIR = __dirname` — works from **any deploy path**.

---

## Audit Result: ✅ PASS (after fixes)

# FinanceGR — Architecture, Testing & DevOps Guide

## 1. Local Quality Commands (Windows PowerShell & Linux)
- `npm run check` — Static integrity, JS/JSON syntax, inline handler audit, Service Worker precache check & security hygiene gate.
- `npm test` — Runs all 13 automated unit test suites (Frontend runtime, Accounting, Piraeus Bank Import, Cloudflare Worker RS256/FX, Cloud Functions `createRoom`/`manageMember`/`adminOverview`).
- `npm run test:all` — Runs both `check` and `test` in sequence.
- `npm run serve` — Starts a zero-dependency local static server at `http://127.0.0.1:4173`.

## 2. Optional Integration & E2E Suites
- **Firebase Emulator Rules Test:**
  ```powershell
  firebase emulators:exec --only database "npm run test:emulator"
  ```
- **Playwright Browser E2E Smoke Test (one-time install):**
  ```powershell
  npm install --save-dev @playwright/test
  npx playwright install chromium
  npm run test:e2e
  ```

## 3. GitHub Actions CI
Every push or pull request to `main`/`master` automatically executes `.github/workflows/ci.yml`:
1. `integrity-and-unit-tests`: Runs `npm run check` + `npm test` on Node 22.
2. `e2e-smoke`: Spins up Chromium via Playwright, serves the app locally, verifies tab navigation, transaction creation, 100% pass of the in-browser Self-Test, and hidden `admin.html` isolation.

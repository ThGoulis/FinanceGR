# FinanceGR — Architecture, Vite Build, Strict CSP & CI/CD

## Local Development & Build (Node 22+)
- `npm install` — Installs Vite 6 bundler.
- `npm run dev` — Starts Vite dev server on `http://127.0.0.1:4173` with instant HMR on `js/*.js`.
- `npm run build` — Produces minified, content-hashed multi-page production bundles in `dist/` (`index.html`, `admin.html`, `assets/*.js`, `assets/*.css`, source maps, and PWA files from `public/`).
- `npm run preview` (or `npm run serve`) — Serves the production `dist/` build locally on `http://127.0.0.1:4173`.

## Quality Gates & Testing
- `npm run check` — Runs `scripts/verify-integrity.cjs`: JSON/JS syntax, Strict CSP (`script-src` without `'unsafe-inline'`), zero inline `<script>` or `on*=` attributes, 100% delegated `data-*` action coverage in `js/events.js` & `js/admin-events.js`, RTDB security rules, and zero admin leaks.
- `npm test` — Runs all unit test suites (`tests/finance`, `tests/security`, `tests/market-data`, `tests/sync`, `tests/worker`, `tests/functions`, `tests/regression`).
- `npm run test:all` — Runs `npm run check && npm test`.
- `npm run test:e2e` — Runs Playwright browser smoke tests (`tests/e2e/smoke.spec.cjs`) against the built `dist/` bundle and asserts zero runtime or CSP errors.

## GitHub Actions Pipelines (`.github/workflows/`)
1. **`ci.yml`**: On push/PR — runs static gate, unit tests, `vite build`, and Playwright E2E smoke tests against `dist/`.
2. **`deploy-pages.yml`**: On push to `main` (or manual dispatch) — verifies tests, builds `dist/`, and deploys directly to GitHub Pages (`Settings → Pages → Source: GitHub Actions`).
3. **`health-monitor.yml`**: Scheduled daily cron (`07:00 UTC`) — probes live site availability, Cloudflare Worker RS256 auth guard (`401`), Frankfurter/ECB FX API, and Yahoo Finance (`VUAA.MI`).

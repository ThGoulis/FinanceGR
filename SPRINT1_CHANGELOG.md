# FinanceGR Sprint 1 — Change log

## Implemented

- DCA now creates a linked `saving` transaction in the `Επένδυση` category, updates portfolio units/invested/current values, and marks the transaction dirty for Cloud Sync. The contribution moves value from cash flow into the portfolio instead of creating artificial Net Worth.
- Cloud Sync connection, manual sync, session unlock, and automatic sync now check pull/push outcomes before showing success. Automatic sync will not push local data after a failed/locked/decryption-error pull.
- Local persistence writes the canonical `financeGR_v1_state` key once. The legacy key is removed only after the canonical write succeeds; on storage failure the app keeps the legacy copy and reports an unsaved/error state.
- Removed fixed USD/GBP/CHF conversion assumptions. Non-EUR quotes require a positive `priceEur` from the quotes Worker; otherwise the quote is rejected with a clear error rather than being valued using stale hard-coded rates.
- Added independent Node.js regression tests under `tests/` and an `npm test` script.
- Added a fail-closed Firebase Realtime Database rules baseline and a security review document.

## Validation performed

- JavaScript syntax validation: all files under `js/` pass `node --check`.
- Regression suite: `7/7` tests pass using `node --test tests/*.test.cjs`.
- Firebase rules JSON parses successfully.

## Important Firebase limitation

The supplied ZIP did not contain deployed Firebase Security Rules or Firebase Authentication configuration. The live Firebase project was not accessed or changed. The included `firebase/database.rules.json` denies all access by default; deploying it before adding Firebase Authentication and room membership authorization will disable the current unauthenticated Cloud Sync implementation. See `FIREBASE_SECURITY.md` before deployment.

<div align="center">

# FinanceGR

**Local-first personal finance, budgeting, and net worth dashboard built for Greek banking workflows.**

[Open Live App](https://thgoulis.github.io/FinanceGR/) · [Onboarding Guide](#-getting-started--onboarding) · [Privacy & Security](#-privacy--security) · [Local Development](#-local-development)

<br />

![FinanceGR CI](https://github.com/thgoulis/FinanceGR/actions/workflows/ci.yml/badge.svg)
![PWA Ready](https://img.shields.io/badge/PWA-Installable-0f766e?style=flat)
![Privacy](https://img.shields.io/badge/Data-Local--First%20%26%20E2EE-1e293b?style=flat)

</div>

---

## What is FinanceGR?

FinanceGR is a browser-based personal finance workspace that works immediately without mandatory registration. It turns bank and Revolut statements into an organized view of your cash flow, monthly budget, credit cards, loans, and investment portfolio while keeping your financial data on your own device by default.

---

## Getting Started & Onboarding

You can start using FinanceGR in a few minutes and build up your setup gradually without needing everything configured on day one:

### Step 1: Open the App & Choose Your Starting Mode
- Visit **[thgoulis.github.io/FinanceGR](https://thgoulis.github.io/FinanceGR/)** on desktop or mobile.
- Because the app is **local-first**, you can start immediately in your browser without creating an account. Your transactions, budget allocations, and settings are stored locally on your device (`localStorage`).
- To install it as an app on your phone or desktop, use your browser's **Install App / Add to Home Screen** action for quick access and offline caching via the Service Worker.

### Step 2: Import Bank & Revolut Statements (or Add Transactions Manually)
- Click **`🏦 Εισαγωγή Αρχείου`** in the sidebar (or from the dashboard/transactions actions) to import `.csv` or `.xlsx` exports from Greek banks or Revolut.
- Statement parsing runs locally in your browser:
  - Transactions are categorized automatically (including MCC-based categorization).
  - Self-transfers and credit card repayments are detected/deduplicated so your spending and net worth are not double-counted.
  - You can review imported rows, select multiple items for bulk actions (category assignment, shared vs. personal tagging, or deletion), and verify everything before committing.
- Prefer entering items one by one? You can also log income, expenses, savings, or withdrawals directly and adjust categories or shared flags anytime.

### Step 3: Set Up Your Monthly Budget & Payday Allocation
- Go to **`Προϋπολογισμός`** to structure how your monthly money is allocated across living costs, categories, savings, and investments.
- Use **`💸 Κατανομή Μισθού`** whenever payday arrives to plan and distribute incoming funds cleanly across your budget buckets and targets.
- Monitor real-time progress across the month as new transactions come in.

### Step 4: Add Investments, DCA & Loans / Liabilities
- Under **`Επενδύσεις`**, record your portfolio holdings (such as ETFs or stocks) and track recurring DCA contributions linked to your cash flow and valuation.
- Under **`Δάνεια`** (and credit card / installment flows), track active loans, credit card balances, and installments so your **Net Worth** on **`Επισκόπηση`** reflects both assets and liabilities accurately.

### Step 5: Optional Shared Budget & Multi-Device Sync (`Cloud Sync`)
- Stay on **local-only mode** if you only want personal tracking on a single device with zero cloud dependency or login required.
- If you want to sync across multiple devices or share a household budget with a partner or roommate:
  1. Open **`☁️ Σύνδεση Cloud`** and sign in when prompted. *(Note: Cloud Sync / login access is available upon approval — if you need access enabled for your account, please contact **tgoulis@gmail.com**.)*
  2. Create a **Cloud Sync Room** and set a strong room **PIN**.
  3. Share the room identifier and PIN **only** with the people who should access that shared budget.
  4. All room payloads are encrypted client-side (**AES-256-GCM**) with your PIN before being sent to Firebase Realtime Database.

### Step 6: Ongoing Habits & Best Practices
- **Import regularly** (e.g., weekly or at month-end) and clean up uncategorized or shared items right after import.
- **Export / back up your data** periodically if you plan to clear browser storage, switch browsers/devices, or test major changes.
- **Keep your PIN private** if using a shared Cloud Sync Room, and never share internal or administrative URLs with regular users.

---

## Core Capabilities at a Glance

- **Overview & Net Worth:** Unified snapshot of net worth, cash flow, reserves, and liabilities without double-counting transfers, card payments, or DCA entries.
- **Smart Statement Import:** Client-side `.csv`/`.xlsx` processing with MCC rules, reference handling, self-transfer detection, and bulk editing.
- **Budgeting & Payday Flow:** Monthly category tracking paired with guided payday allocation (`Κατανομή Μισθού`).
- **Wealth & Liabilities:** Portfolio & DCA tracking alongside loans, installments, and credit card workflows.
- **Encrypted Cloud Sync:** Optional PIN-protected **AES-256-GCM** sync rooms for multi-device use or shared budgets.

---

## Privacy & Security

| Component | Where Data Lives | Protection Mechanism |
| :--- | :--- | :--- |
| **Bank Statements (`.csv` / `.xlsx`)** | Local browser memory only | Parsed 100% client-side; raw files are never uploaded to any server. |
| **Default Storage** | Device `localStorage` | No registration required; data stays on your device unless you opt into Cloud Sync. |
| **Cloud Sync (Optional)** | Firebase Realtime Database | Client-side **AES-256-GCM** encryption derived from your room PIN. |
| **Live Market Quotes (Optional)** | Cloudflare Worker Proxy | Proxy enforcing Google RS256 JWT verification and CORS checks. |

---

## Local Development

### Tech Stack
- **Frontend:** Vanilla HTML, CSS, JavaScript, Progressive Web App (Service Worker)
- **Backend (Optional):** Firebase Auth, Realtime Database, Cloud Functions, Cloudflare Worker
- **Verification:** Node.js test runner, static integrity gates, Playwright E2E, Firebase Emulator tests

### Run Locally

```bash
git clone [https://github.com/thgoulis/FinanceGR.git](https://github.com/thgoulis/FinanceGR.git)
cd FinanceGR
npm install
npm run serve
```

> **Configuration:** Local-first usage works out of the box. Optional Cloud Sync and live market quote features require your own Firebase project and Cloudflare Worker setup (see `.env.example` and `functions/.env.example`).

### Tests & Integrity Gates

```bash
# Static security/integrity checks + unit test suites
npm run test:all

# End-to-end browser smoke test (Playwright)
npm run test:e2e

# Firebase RTDB security rules tests (requires Firebase Emulator)
npm run test:emulator
```

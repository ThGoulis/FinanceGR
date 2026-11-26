const test = require("node:test");
const assert = require("node:assert/strict");
const { loadFinanceGrRuntime } = require("../helpers/load-app.cjs");

test("Complete Accounting Integrity: CC statement import, CC payment period-expense dedup, installment auto-reduction, and portfolio asset delete with linked DCA", () => {
  const { ctx, getEl } = loadFinanceGrRuntime();
  ctx.data = ctx.createDefaultState();
  ctx.data.profile.initialSavings = 0;

  // Base salary €2000
  ctx.data.transactions.push({
    id: "sal-1", owner: "me", type: "income", category: "Μισθός", amount: 2000, date: "2026-11-01"
  });

  // 1. Create Credit Card with €500 interest-free installments (10 x €50/mo) and €0 revolving
  ctx.data.liabilities.push({
    id: "cc-1", name: "Piraeus Visa", type: "Credit Card",
    creditLimit: 3000, initialAmount: 3000, remainingBalance: 500,
    installmentBalance: 500, installmentMonthly: 50, installmentRemainingCount: 10,
    interestRate: 18
  });

  // 2. Credit Card Statement Import: €100 purchase + €20 refund -> card balance becomes 500 + 100 - 20 = 580
  getEl("bankCreditCardSelect").value = "cc-1";
  getEl("bankCreditCardUpdateBal").checked = true;
  ctx.bankPreviewRows = [
    { rowId: "r1", selected: true, date: "2026-11-05", description: "SKLAVENITIS", originalBankDesc: "SKLAVENITIS", type: "expense", category: "Τρόφιμα", isShared: false, amount: 100, source: "Πειραιώς", statusTag: "new", statusReason: "ok" },
    { rowId: "r2", selected: true, date: "2026-11-06", description: "REFUND", originalBankDesc: "REFUND", type: "income", category: "Επιστροφή Χρημάτων", isShared: false, amount: 20, source: "Πειραιώς", statusTag: "new", statusReason: "ok" }
  ];
  ctx.confirmBankImport(true);

  assert.equal(ctx.data.liabilities[0].remainingBalance, 580);
  // Net Worth = 2000 (cashFlow) - 580 (liability) = 1420 (zero double-counting!)
  let snap = ctx.computeNetWorthSnapshot("all", null, "2026-11-30");
  assert.equal(snap.cashFlow, 2000);
  assert.equal(snap.liabilitiesTotal, 580);
  assert.equal(snap.netWorth, 1420);

  // 3. Pay Credit Card: €130 principal (€80 revolving + €50 installment) + €5 interest = €135 total
  getEl("payLiabilityId").value = "cc-1";
  getEl("payLiabilityPrincipal").value = "130";
  getEl("payLiabilityInterest").value = "5";
  getEl("payLiabilityInstallmentPrincipal").value = "50";
  getEl("payLiabilityDate").value = "2026-11-20";
  getEl("payLiabilityDesc").value = "Πληρωμή Visa";
  ctx.executeLiabilityPayment();

  // Card balance = 580 - 130 = 450; installmentBalance = 500 - 50 = 450; installmentRemainingCount = 9
  assert.equal(ctx.data.liabilities[0].remainingBalance, 450);
  assert.equal(ctx.data.liabilities[0].installmentBalance, 450);
  assert.equal(ctx.data.liabilities[0].installmentRemainingCount, 9);

  // Net Worth drops ONLY by €5 interest: 1420 - 5 = 1415
  snap = ctx.computeNetWorthSnapshot("all", null, "2026-11-30");
  assert.equal(snap.netWorth, 1415);

  // Period Totals: €100 purchase + €5 interest = €105 expense (NOT €235!), creditCardRepayment = €130
  const period = ctx.getPeriodTotals("2026-11-01", "2026-11-30", "all");
  assert.equal(period.expense, 105);
  assert.equal(period.creditCardRepayment, 130);

  // Delete the card payment -> restores remainingBalance=580, installmentBalance=500, installmentRemainingCount=10
  const payTx = ctx.data.transactions.find(t => t.linkedLiabilityId === "cc-1");
  ctx.deleteTransaction(payTx.id);
  assert.equal(ctx.data.liabilities[0].remainingBalance, 580);
  assert.equal(ctx.data.liabilities[0].installmentBalance, 500);
  assert.equal(ctx.data.liabilities[0].installmentRemainingCount, 10);

  // 4. Portfolio Asset + DCA -> Delete Asset -> Linked DCA transactions deleted so Net Worth stays invariant!
  ctx.data.portfolioAssets.push({
    id: "etf-1", name: "VUAA", ticker: "VUAA.MI", type: "ETF",
    units: 10, invested: 1000, current: 1000, lastUnitPriceEur: 100
  });
  const nwBeforeDca = ctx.computeNetWorthSnapshot("all", null, "2026-11-30").netWorth; // 1420 + 1000 = 2420
  assert.equal(nwBeforeDca, 2420);

  ctx.addDcaToPortfolioAsset("etf-1", 300, { date: "2026-11-22" });
  assert.equal(ctx.computeNetWorthSnapshot("all", null, "2026-11-30").netWorth, 2420);

  // Now delete the portfolio asset -> linked €300 DCA tx is also deleted, so Net Worth drops ONLY by original €1000 asset (back to 1420), NOT by €1300!
  ctx.deletePortfolioAsset("etf-1");
  assert.equal(ctx.data.portfolioAssets.length, 0);
  assert.equal(ctx.data.transactions.filter(t => t.linkedPortfolioAssetId === "etf-1").length, 0);
  assert.equal(ctx.computeNetWorthSnapshot("all", null, "2026-11-30").netWorth, 1420);
});

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadFinanceGrRuntime } = require("../helpers/load-app.cjs");

test("Real liability payment, edit installment, delete restoration, credit card purchase edit/delete, and bank debt detection work consistently", () => {
  const { ctx, getEl } = loadFinanceGrRuntime();

  ctx.data = ctx.createDefaultState();
  ctx.data.liabilities.push(
    {
      id: "loan1", name: "Δάνειο Μοτοσυκλέτας", type: "Loan",
      initialAmount: 5000, remainingBalance: 5000, interestRate: 6, monthlyPayment: 200
    },
    {
      id: "card1", name: "Piraeus Visa", type: "Credit Card",
      creditLimit: 3000, initialAmount: 3000, remainingBalance: 0, installmentBalance: 0
    }
  );

  getEl("payLiabilityId").value = "loan1";
  getEl("payLiabilityPrincipal").value = "175";
  getEl("payLiabilityInterest").value = "25";
  getEl("payLiabilityDate").value = "2026-11-15";
  getEl("payLiabilityDesc").value = "Δόση Νοεμβρίου";
  ctx.executeLiabilityPayment();

  assert.equal(ctx.data.liabilities[0].remainingBalance, 4825);
  assert.equal(ctx.data.transactions.length, 1);
  const payTx = ctx.data.transactions[0];
  assert.equal(payTx.linkedLiabilityId, "loan1");
  assert.equal(payTx.liabilityPrincipal, 175);
  assert.equal(payTx.liabilityInterest, 25);

  getEl("editingTransactionId").value = payTx.id;
  getEl("txType").value = "expense";
  getEl("amount").value = "250";
  getEl("date").value = "2026-11-15";
  getEl("category").value = "Λογαριασμοί";
  getEl("txSource").value = "Πειραιώς";
  getEl("description").value = "Δόση Νοεμβρίου";
  getEl("unexpected").checked = false;
  getEl("txIsShared").checked = false;
  getEl("txCreditCardId").value = "";
  ctx.addTransaction(false);

  assert.equal(ctx.data.liabilities[0].remainingBalance, 4775);
  assert.equal(ctx.data.transactions[0].liabilityPrincipal, 225);

  ctx.deleteTransaction(payTx.id);
  assert.equal(ctx.data.liabilities[0].remainingBalance, 5000);

  // Credit card purchase via addTransaction -> increases card balance, then delete restores it
  getEl("editingTransactionId").value = "";
  getEl("txType").value = "expense";
  getEl("amount").value = "120";
  getEl("date").value = "2026-11-16";
  getEl("category").value = "Τρόφιμα";
  getEl("txSource").value = "";
  getEl("description").value = "Σκλαβενίτης";
  getEl("txCreditCardId").value = "card1";
  ctx.addTransaction(false);

  assert.equal(ctx.data.liabilities[1].remainingBalance, 120);
  const ccTxId = ctx.data.transactions[0].id;
  ctx.deleteTransaction(ccTxId);
  assert.equal(ctx.data.liabilities[1].remainingBalance, 0);

  const hitLoan = ctx.detectDebtOrInstallmentCharge("5029120147486 ΔΑΝΕΙΟ", "", "expense", 200);
  assert.ok(hitLoan && hitLoan.isDebt && hitLoan.kind === "loan");
  const hitKlarna = ctx.detectDebtOrInstallmentCharge("KLARNA ΑΤΟΚΕΣ ΔΟΣΕΙΣ", "", "expense", 45);
  assert.ok(hitKlarna && hitKlarna.isDebt && hitKlarna.kind === "installment");
  const hitMarket = ctx.detectDebtOrInstallmentCharge("ΣΚΛΑΒΕΝΙΤΗΣ SUPERMARKET", "", "expense", 60);
  assert.equal(hitMarket, null);
});

test("Deleting a loan created with loanIncludeInReserve reverses initialSavings offset accurately", () => {
  const { ctx, getEl } = loadFinanceGrRuntime();
  ctx.data = ctx.createDefaultState();
  ctx.data.profile.initialSavings = 1000;

  getEl("editingLoanId").value = "";
  getEl("loanName").value = "Δάνειο Αυτοκινήτου";
  getEl("loanType").value = "Loan";
  getEl("loanInitial").value = "5000";
  getEl("loanRemaining").value = "4000";
  getEl("loanInterestRate").value = "5.5";
  getEl("loanMonthlyPayment").value = "200";
  getEl("loanIncludeInReserve").checked = true;
  ctx.saveLoanLiabilityItem();

  assert.equal(ctx.data.profile.initialSavings, 5000);
  assert.equal(ctx.data.liabilities.length, 1);
  assert.equal(ctx.data.liabilities[0].reserveOffsetAmount, 4000);

  // Net worth remains 1000 (5000 reserve - 4000 loan)
  let snap = ctx.computeNetWorthSnapshot("all", null, "2026-11-30");
  assert.equal(snap.netWorth, 1000);

  // Deleting the loan must reverse the 4000 offset -> initialSavings returns to 1000, Net Worth stays 1000
  ctx.deleteLiabilityItem(ctx.data.liabilities[0].id);
  assert.equal(ctx.data.liabilities.length, 0);
  assert.equal(ctx.data.profile.initialSavings, 1000);
  snap = ctx.computeNetWorthSnapshot("all", null, "2026-11-30");
  assert.equal(snap.netWorth, 1000);
});

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadFinanceGrRuntime } = require("../helpers/load-app.cjs");

test("Real computeNetWorthSnapshot handles income, expense, DCA, loans, and credit card purchases without double-counting", () => {
  const { ctx } = loadFinanceGrRuntime();

  ctx.data = ctx.createDefaultState();
  ctx.data.profile.initialSavings = 0;

  ctx.data.transactions.push(
    { id: "tx1", owner: "me", type: "income", category: "Μισθός", amount: 2000, date: "2026-11-01" },
    { id: "tx2", owner: "me", type: "expense", category: "Τρόφιμα", amount: 400, date: "2026-11-02" }
  );
  let snap = ctx.computeNetWorthSnapshot("all", null, "2026-11-30");
  assert.equal(snap.netWorth, 1600);

  ctx.data.liabilities.push({
    id: "card1", name: "Piraeus Visa", type: "Credit Card",
    creditLimit: 3000, initialAmount: 3000, remainingBalance: 150, installmentBalance: 0
  });
  ctx.data.transactions.push({
    id: "tx3", owner: "me", type: "expense", category: "Διασκέδαση",
    amount: 150, date: "2026-11-05", paidByCreditCardId: "card1"
  });

  snap = ctx.computeNetWorthSnapshot("all", null, "2026-11-30");
  assert.equal(snap.liabilitiesTotal, 150);
  assert.equal(snap.cashFlow, 1600);
  assert.equal(snap.netWorth, 1450);

  const periodTotals = ctx.getPeriodTotals("2026-11-01", "2026-11-30", "all");
  assert.equal(periodTotals.expense, 550);

  ctx.data.liabilities[0].remainingBalance = 0;
  ctx.data.transactions.push({
    id: "tx4", owner: "me", type: "expense", category: "Λογαριασμοί",
    amount: 150, date: "2026-11-20", linkedLiabilityId: "card1",
    liabilityPrincipal: 150, liabilityInterest: 0
  });
  snap = ctx.computeNetWorthSnapshot("all", null, "2026-11-30");
  assert.equal(snap.liabilitiesTotal, 0);
  assert.equal(snap.cashFlow, 1450);
  assert.equal(snap.netWorth, 1450);
});

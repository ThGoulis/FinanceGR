const test = require("node:test");
const assert = require("node:assert/strict");
const { loadFinanceGrRuntime } = require("../helpers/load-app.cjs");

test("Real addDcaToPortfolioAsset rolls back on persist failure, creates linked tx, and reverses accurately on deleteTransaction", () => {
  const { ctx, localStorage } = loadFinanceGrRuntime();

  ctx.data = ctx.createDefaultState();
  ctx.data.portfolioAssets.push({
    id: "a1", name: "VUAA", ticker: "VUAA.MI", type: "ETF",
    units: 10, invested: 1000, current: 1000, lastUnitPriceEur: 100
  });

  const origSetItem = localStorage.setItem;
  localStorage.setItem = () => { throw new Error("QuotaExceededError"); };
  const failOk = ctx.addDcaToPortfolioAsset("a1", 200, { date: "2026-11-10" });
  assert.equal(failOk, false);
  assert.equal(ctx.data.portfolioAssets[0].invested, 1000);
  assert.equal(ctx.data.portfolioAssets[0].units, 10);
  assert.equal(ctx.data.transactions.length, 0);
  localStorage.setItem = origSetItem;

  const ok = ctx.addDcaToPortfolioAsset("a1", 200, { date: "2026-11-10" });
  assert.equal(ok, true);
  assert.equal(ctx.data.portfolioAssets[0].invested, 1200);
  assert.equal(ctx.data.portfolioAssets[0].units, 12);
  assert.equal(ctx.data.portfolioAssets[0].current, 1200);
  assert.equal(ctx.data.transactions.length, 1);
  const dcaTx = ctx.data.transactions[0];
  assert.equal(dcaTx.linkedPortfolioAssetId, "a1");
  assert.equal(dcaTx.dcaAddedUnits, 2);

  ctx.deleteTransaction(dcaTx.id);
  assert.equal(ctx.data.transactions.length, 0);
  assert.equal(ctx.data.portfolioAssets[0].invested, 1000);
  assert.equal(ctx.data.portfolioAssets[0].units, 10);
  assert.equal(ctx.data.portfolioAssets[0].current, 1000);
});

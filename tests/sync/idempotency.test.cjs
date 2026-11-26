const test = require("node:test");
const assert = require("node:assert/strict");
const { loadFinanceGrRuntime } = require("../helpers/load-app.cjs");

test("Real mergeEntitiesById & sanitizeImportedTransaction preserve tombstones, conflicts, and linked entity metadata", () => {
  const { ctx } = loadFinanceGrRuntime(["js/state.js", "js/bank-import.js", "js/settings-backup.js", "js/cloud-sync.js"]);

  const conflicts = [];
  const merged = ctx.mergeEntitiesById(
    [{ id: "g1", title: "Local", _updatedAt: 1000, version: 1 }, { id: "g2", title: "Deleted", _updatedAt: 1000 }],
    [{ id: "g1", title: "Remote", _updatedAt: 1500, version: 1 }, { id: "g2", title: "Deleted", _updatedAt: 1500 }],
    { g2: 2000 },
    true,
    conflicts
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].title, "Remote");
  assert.equal(conflicts.length, 1);

  const sanitized = ctx.sanitizeImportedTransaction({
    id: "tx-cc-1", type: "expense", category: "Τρόφιμα", amount: 55.25, date: "2026-11-12",
    description: "Market", paidByCreditCardId: "card1", linkedLiabilityId: "loan1",
    liabilityPrincipal: 40, liabilityInterest: 15.25, linkedPortfolioAssetId: "a1", dcaAddedUnits: 1.5
  });
  assert.equal(sanitized.paidByCreditCardId, "card1");
  assert.equal(sanitized.linkedLiabilityId, "loan1");
  assert.equal(sanitized.liabilityPrincipal, 40);
  assert.equal(sanitized.linkedPortfolioAssetId, "a1");
  assert.equal(sanitized.dcaAddedUnits, 1.5);
});

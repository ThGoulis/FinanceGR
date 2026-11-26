const test = require("node:test");
const assert = require("node:assert/strict");
const { loadFinanceGrRuntime } = require("../helpers/load-app.cjs");

test("Real persist() writes only STORAGE_KEY and removes LEGACY_STORAGE_KEY to prevent double quota usage", () => {
  const { ctx, localStorage } = loadFinanceGrRuntime(["js/state.js"]);

  localStorage.setItem("personalFinanceDashboard_v5", JSON.stringify({ profile: { userName: "Old" }, transactions: [] }));
  assert.notEqual(localStorage.getItem("personalFinanceDashboard_v5"), null);

  const ok = ctx.persist(true, true);
  assert.equal(ok, true);
  assert.notEqual(localStorage.getItem("financeGR_v1_state"), null);
  assert.equal(localStorage.getItem("personalFinanceDashboard_v5"), null);
});

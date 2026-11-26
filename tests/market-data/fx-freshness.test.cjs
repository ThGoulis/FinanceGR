const test = require("node:test");
const assert = require("node:assert/strict");
const { loadFinanceGrRuntime } = require("../helpers/load-app.cjs");

test("Real evaluateFxTimestampFreshness & normalizeQuoteFxContract reject missing/expired FX without hardcoded fallbacks", () => {
  const { ctx } = loadFinanceGrRuntime(["js/state.js", "js/wealth.js"]);

  const nowIso = new Date().toISOString();
  const tenHoursAgo = new Date(Date.now() - 10 * 3600 * 1000).toISOString();
  const thirtyHoursAgo = new Date(Date.now() - 30 * 3600 * 1000).toISOString();

  assert.equal(ctx.evaluateFxTimestampFreshness(nowIso).status, "fresh");
  assert.equal(ctx.evaluateFxTimestampFreshness(tenHoursAgo).status, "stale");
  assert.equal(ctx.evaluateFxTimestampFreshness(thirtyHoursAgo).status, "unavailable");

  const missingFx = ctx.normalizeQuoteFxContract({ price: 100, priceEur: 92, currency: "USD" }, 100, "USD");
  assert.equal(missingFx.ok, false);
  assert.equal(missingFx.status, "unavailable");

  const eurOk = ctx.normalizeQuoteFxContract({ price: 112.5, currency: "EUR" }, 112.5, "EUR");
  assert.equal(eurOk.ok, true);
  assert.equal(eurOk.priceEur, 112.5);
  assert.equal(eurOk.fxStatus, "fresh");
});

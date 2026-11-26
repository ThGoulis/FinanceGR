const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadFinanceGrRuntime } = require("../helpers/load-app.cjs");

test("Hidden admin isolation, Firebase config, Google Ticker Guard, and server-side admin verification", async () => {
  const root = path.join(__dirname, "..", "..");
  const { ctx } = loadFinanceGrRuntime(["js/state.js", "js/firebase-config.js", "js/firebase-auth.js", "js/wealth.js"]);

  // 1. Firebase config populated
  assert.equal(ctx.window.FINANCEGR_FIREBASE_CONFIG.projectId, "financegr-sync");
  assert.ok(ctx.window.FINANCEGR_FIREBASE_CONFIG.apiKey.startsWith("AIza"));

  // 2. Public index.html & service-worker.js expose ZERO admin links or panels
  const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const swJs = fs.readFileSync(path.join(root, "service-worker.js"), "utf8");
  assert.equal(indexHtml.includes('id="tab-admin"'), false);
  assert.equal(indexHtml.includes('data-tab="admin"'), false);
  assert.equal(indexHtml.includes("admin.html"), false);
  assert.equal(indexHtml.includes("runAndShowSelfTests"), false);
  assert.equal(indexHtml.includes("self-tests.js"), false);
  assert.equal(swJs.includes("admin.html"), false);
  assert.equal(swJs.includes("self-tests.js"), false);

  // 3. Standalone admin.html has noindex & starts locked
  const adminHtml = fs.readFileSync(path.join(root, "admin.html"), "utf8");
  assert.ok(adminHtml.includes('content="noindex, nofollow, noarchive"'));
  assert.ok(adminHtml.includes('id="adminConsoleApp" style="display:none;'));
  assert.ok(adminHtml.includes('onclick="runAdminSystemHealthCheck()"'));
  assert.ok(adminHtml.includes('src="js/self-tests.js"'));

  // 4. Server-side functions/index.js: no hardcoded personal email, uses lightweight roomIndex (never full rooms/), enforces isSystemAdmin
  const fnSrc = fs.readFileSync(path.join(root, "functions", "index.js"), "utf8");
  assert.ok(fnSrc.includes("exports.adminOverview"));
  assert.ok(fnSrc.includes("isSystemAdmin(decoded)"));
  assert.ok(fnSrc.includes('provider !== "google.com"'));
  assert.ok(fnSrc.includes("decoded.email_verified !== true"));
  assert.equal(fnSrc.includes("tgoulis@gmail.com"), false);
  assert.ok(fnSrc.includes('db.ref("roomIndex").once("value")'));
  assert.equal(fnSrc.includes('db.ref("rooms").once("value")'), false);

  // 4b. Cloudflare Worker enforces email_verified === true
  const workerSrc = fs.readFileSync(path.join(root, "worker", "quotes-worker.js"), "utf8");
  assert.ok(workerSrc.includes("payload.email_verified !== true"));

  // 5. Google Ticker Guard blocks unauthenticated & email-only users
  assert.equal(ctx.isGoogleAccountSignedIn(), false);
  await assert.rejects(() => ctx.fetchCloudflareWorkerQuote("VUAA.MI"), /Google/i);
  ctx._fbCurrentUser = { uid: "u1", email: "user@example.com", providerData: [{ providerId: "password" }] };
  assert.equal(ctx.isGoogleAccountSignedIn(), false);
  ctx._fbCurrentUser = { uid: "u2", email: "user@gmail.com", providerData: [{ providerId: "google.com" }] };
  assert.equal(ctx.isGoogleAccountSignedIn(), true);
});

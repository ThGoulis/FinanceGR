const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function base64Url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function createSignedJwt(payloadObj, { kid = "test-kid-1", privateKey }) {
  const header = { alg: "RS256", typ: "JWT", kid };
  const h64 = base64Url(JSON.stringify(header));
  const p64 = base64Url(JSON.stringify(payloadObj));
  const data = new TextEncoder().encode(`${h64}.${p64}`);
  const sig = await globalThis.crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, data);
  return `${h64}.${p64}.${base64Url(new Uint8Array(sig))}`;
}

function loadWorkerWithMockFetch(mockFetch) {
  const srcPath = path.join(__dirname, "..", "..", "worker", "quotes-worker.js");
  const raw = fs.readFileSync(srcPath, "utf8");
  const transformed = raw.replace(/export\s+default\s+\{/, "const __workerExport = {") + "\n__workerExport;";
  const sandbox = {
    console,
    Date,
    Math,
    JSON,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Set,
    Map,
    RegExp,
    Error,
    URL,
    Uint8Array,
    TextEncoder,
    TextDecoder,
    AbortController,
    Headers,
    Request,
    Response,
    setTimeout,
    clearTimeout,
    atob: (s) => Buffer.from(s, "base64").toString("binary"),
    btoa: (s) => Buffer.from(s, "binary").toString("base64"),
    crypto: globalThis.crypto,
    fetch: mockFetch
  };
  return vm.runInNewContext(transformed, sandbox, { filename: "worker/quotes-worker.js" });
}

test("Cloudflare Worker enforces CORS, RS256 Google JWT, email_verified, symbol validation, and EUR/USD FX conversion", async () => {
  const keyPair = await globalThis.crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"]
  );
  const pubJwk = await globalThis.crypto.subtle.exportKey("jwk", keyPair.publicKey);
  pubJwk.kid = "test-kid-1";
  pubJwk.use = "sig";
  pubJwk.alg = "RS256";

  const mockFetch = async (url) => {
    const u = String(url);
    if (u.includes("securetoken@system.gserviceaccount.com")) {
      return new Response(JSON.stringify({ keys: [pubJwk] }), { status: 200 });
    }
    if (u.includes("query1.finance.yahoo.com") && u.includes("VUAA.MI")) {
      return new Response(JSON.stringify({
        chart: { result: [{ meta: { symbol: "VUAA.MI", shortName: "Vanguard S&P 500", exchangeName: "MIL", regularMarketPrice: 112.5, previousClose: 111.0, currency: "EUR", regularMarketTime: Math.floor(Date.now() / 1000) } }] }
      }), { status: 200 });
    }
    if (u.includes("query1.finance.yahoo.com") && u.includes("AAPL")) {
      return new Response(JSON.stringify({
        chart: { result: [{ meta: { symbol: "AAPL", shortName: "Apple Inc.", exchangeName: "NMS", regularMarketPrice: 200, previousClose: 198, currency: "USD", regularMarketTime: Math.floor(Date.now() / 1000) } }] }
      }), { status: 200 });
    }
    if (u.includes("api.frankfurter")) {
      return new Response(JSON.stringify({
        amount: 1, base: "EUR", date: new Date().toISOString().slice(0, 10),
        rates: { USD: 1.10, GBP: 0.85, CHF: 0.95 }
      }), { status: 200 });
    }
    return new Response("Not Found", { status: 404 });
  };

  const worker = loadWorkerWithMockFetch(mockFetch);

  // 1. OPTIONS preflight allows Authorization header
  const optRes = await worker.fetch(new Request("https://financegr-quotes.tgoulis.workers.dev/?symbol=VUAA.MI", { method: "OPTIONS", headers: { Origin: "https://thgoulis.github.io" } }), {}, {});
  assert.equal(optRes.status, 204);
  assert.ok(optRes.headers.get("Access-Control-Allow-Headers").includes("Authorization"));

  // 2. Missing token -> 401
  const noAuthRes = await worker.fetch(new Request("https://financegr-quotes.tgoulis.workers.dev/?symbol=VUAA.MI"), {}, {});
  assert.equal(noAuthRes.status, 401);

  const nowSec = Math.floor(Date.now() / 1000);

  // 3. Password provider -> 403
  const pwToken = await createSignedJwt({
    aud: "financegr-sync", iss: "https://securetoken.google.com/financegr-sync",
    sub: "u1", exp: nowSec + 3600, email: "a@b.com", email_verified: true,
    firebase: { sign_in_provider: "password" }
  }, { privateKey: keyPair.privateKey });
  const pwRes = await worker.fetch(new Request("https://financegr-quotes.tgoulis.workers.dev/?symbol=VUAA.MI", { headers: { Authorization: `Bearer ${pwToken}` } }), {}, {});
  assert.equal(pwRes.status, 403);

  // 4. Unverified Google email -> 403
  const unvToken = await createSignedJwt({
    aud: "financegr-sync", iss: "https://securetoken.google.com/financegr-sync",
    sub: "u2", exp: nowSec + 3600, email: "u@gmail.com", email_verified: false,
    firebase: { sign_in_provider: "google.com" }
  }, { privateKey: keyPair.privateKey });
  const unvRes = await worker.fetch(new Request("https://financegr-quotes.tgoulis.workers.dev/?symbol=VUAA.MI", { headers: { Authorization: `Bearer ${unvToken}` } }), {}, {});
  assert.equal(unvRes.status, 403);

  // 5. Valid verified Google JWT -> EUR quote succeeds
  const validToken = await createSignedJwt({
    aud: "financegr-sync", iss: "https://securetoken.google.com/financegr-sync",
    sub: "u3", exp: nowSec + 3600, email: "ok@gmail.com", email_verified: true,
    firebase: { sign_in_provider: "google.com" }
  }, { privateKey: keyPair.privateKey });

  const eurRes = await worker.fetch(new Request("https://financegr-quotes.tgoulis.workers.dev/?symbol=VUAA.MI", { headers: { Authorization: `Bearer ${validToken}` } }), {}, {});
  assert.equal(eurRes.status, 200);
  const eurJson = await eurRes.json();
  assert.equal(eurJson.success, true);
  assert.equal(eurJson.priceEur, 112.5);

  // 6. Valid Google JWT -> USD quote converts via Frankfurter FX (200 / 1.10)
  const usdRes = await worker.fetch(new Request("https://financegr-quotes.tgoulis.workers.dev/?symbol=AAPL", { headers: { Authorization: `Bearer ${validToken}` } }), {}, {});
  assert.equal(usdRes.status, 200);
  const usdJson = await usdRes.json();
  assert.equal(usdJson.success, true);
  assert.ok(Math.abs(usdJson.priceEur - (200 / 1.10)) < 0.01);

  // 7. Invalid symbol -> 400
  const badSymRes = await worker.fetch(new Request("https://financegr-quotes.tgoulis.workers.dev/?symbol=BAD%20SYMBOL!", { headers: { Authorization: `Bearer ${validToken}` } }), {}, {});
  assert.equal(badSymRes.status, 400);

  // 8. Per-user rate limiter blocks excess requests with 429 (dedicated user sub for isolated window)
  const rlToken = await createSignedJwt({
    aud: "financegr-sync", iss: "https://securetoken.google.com/financegr-sync",
    sub: "u-ratelimit-isolated", exp: nowSec + 3600, email: "rl@gmail.com", email_verified: true,
    firebase: { sign_in_provider: "google.com" }
  }, { privateKey: keyPair.privateKey });
  const rlRes1 = await worker.fetch(new Request("https://financegr-quotes.tgoulis.workers.dev/?symbol=VUAA.MI", { headers: { Authorization: `Bearer ${rlToken}` } }), { RATE_LIMIT_PER_MINUTE: "1" }, {});
  assert.equal(rlRes1.status, 200);
  const rlRes2 = await worker.fetch(new Request("https://financegr-quotes.tgoulis.workers.dev/?symbol=VUAA.MI", { headers: { Authorization: `Bearer ${rlToken}` } }), { RATE_LIMIT_PER_MINUTE: "1" }, {});
  assert.equal(rlRes2.status, 429);
});


#!/usr/bin/env node
/**
 * FinanceGR Static Integrity, Strict CSP, Event Delegation & Security Quality Gate
 * Run via: npm run check
 */
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const errors = [];

function check(label, ok, detail = "") {
  if (ok) {
    console.log(`  [PASS] ${label}`);
  } else {
    console.error(`  [FAIL] ${label}${detail ? ` -> ${detail}` : ""}`);
    errors.push(`${label}${detail ? `: ${detail}` : ""}`);
  }
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".git", ".firebase", "dist", "playwright-report", "test-results"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

console.log("\n=== FinanceGR Static Integrity, Strict CSP & Security Gate ===\n");

const allFiles = walk(ROOT);
const relSet = new Set(allFiles.map(f => path.relative(ROOT, f).replace(/\\/g, "/")));

// 1. JSON syntax validation
let badJson = [];
for (const rel of relSet) {
  if (rel.endsWith(".json") || rel === ".firebaserc") {
    try {
      JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
    } catch (e) {
      badJson.push(`${rel} (${e.message})`);
    }
  }
}
check("All JSON & config files valid", badJson.length === 0, badJson.join(", "));

// 2. JS syntax check (js/*.js, functions/*.js, scripts/*.cjs, public/service-worker.js)
let badJs = [];
for (const rel of relSet) {
  if (
    ((rel.startsWith("js/") || rel.startsWith("functions/") || rel.startsWith("scripts/")) && (rel.endsWith(".js") || rel.endsWith(".cjs"))) ||
    rel === "public/service-worker.js"
  ) {
    try {
      const code = fs.readFileSync(path.join(ROOT, rel), "utf8");
      new vm.Script(code, { filename: rel });
    } catch (e) {
      badJs.push(`${rel} (${e.message})`);
    }
  }
}
check("All JavaScript/CJS files parse cleanly", badJs.length === 0, badJs.join(", "));

// 3. Vite & PWA core files check
const requiredFiles = [
  "vite.config.mjs",
  "src/main.js",
  "src/admin-main.js",
  "src/admin.css",
  "js/events.js",
  "js/admin-events.js",
  "public/manifest.json",
  "public/service-worker.js",
  "public/icons/icon-180.png",
  "public/icons/icon-192.png",
  "public/icons/icon-512.png",
  "public/icons/admin-favicon.svg"
];
const missingCore = requiredFiles.filter(r => !relSet.has(r));
check("All Vite, ES module entrypoints & public PWA assets exist", missingCore.length === 0, missingCore.join(", "));

// 4. Local asset & Service Worker precache check
const indexHtml = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const adminHtml = fs.readFileSync(path.join(ROOT, "admin.html"), "utf8");
const swJs = fs.readFileSync(path.join(ROOT, "public/service-worker.js"), "utf8");

function checkLocalHtmlRefs(htmlContent, pageName) {
  const localRefs = [...htmlContent.matchAll(/(?:src|href)="([^"]+)"/g)].map(m => m[1]);
  return localRefs.filter(r => {
    if (r === "./" || r.startsWith("http://") || r.startsWith("https://") || r.startsWith("data:") || r.startsWith("#") || r.startsWith("mailto:")) return false;
    const clean = r.replace(/^\.\//, "");
    return !relSet.has(clean) && !relSet.has(`public/${clean}`);
  });
}
const missingIdxRefs = checkLocalHtmlRefs(indexHtml, "index.html");
const missingAdmRefs = checkLocalHtmlRefs(adminHtml, "admin.html");
check("All index.html & admin.html local asset references resolve", missingIdxRefs.length === 0 && missingAdmRefs.length === 0, [...missingIdxRefs, ...missingAdmRefs].join(", "));

const swUrls = [...swJs.matchAll(/["'](\.\/[^"']+)["']/g)].map(m => m[1]);
const missingSw = swUrls.filter(u => {
  if (u === "./" || u === "./index.html") return false;
  const clean = u.replace(/^\.\//, "");
  return !relSet.has(clean) && !relSet.has(`public/${clean}`);
});
check("All public/service-worker.js precache entries exist", missingSw.length === 0, missingSw.join(", "));

// 5. STRICT CSP & ZERO INLINE HANDLERS / INLINE SCRIPTS AUDIT
const scriptSrcIdx = (indexHtml.match(/script-src\s+([^;"]+)/) || [])[1] || "";
const scriptSrcAdm = (adminHtml.match(/script-src\s+([^;"]+)/) || [])[1] || "";
check(
  "Strict CSP: ZERO 'unsafe-inline' in script-src (index.html & admin.html)",
  Boolean(scriptSrcIdx && scriptSrcAdm) && !scriptSrcIdx.includes("unsafe-inline") && !scriptSrcAdm.includes("unsafe-inline")
);

const inlineScriptRe = /<script(?![^>]*\bsrc=)[^>]*>/i;
check(
  "Strict CSP: ZERO inline <script> blocks in index.html & admin.html",
  !inlineScriptRe.test(indexHtml) && !inlineScriptRe.test(adminHtml)
);

const inlineEvRe = /\bon(click|change|input|submit|dragover|dragleave|drop|keydown|keyup|focus|blur)="[^"]*"/i;
const filesWithInlineHandlers = [];
for (const rel of ["index.html", "admin.html", ...[...relSet].filter(r => r.startsWith("js/") && r.endsWith(".js"))]) {
  const txt = fs.readFileSync(path.join(ROOT, rel), "utf8");
  if (inlineEvRe.test(txt)) filesWithInlineHandlers.push(rel);
}
check("Strict CSP: ZERO inline on*= event handlers across HTML & js/*.js", filesWithInlineHandlers.length === 0, filesWithInlineHandlers.join(", "));

// 6. Delegated Event Action Resolution Audit (main app & admin console)
const eventsJs = fs.readFileSync(path.join(ROOT, "js/events.js"), "utf8");
const adminEventsJs = fs.readFileSync(path.join(ROOT, "js/admin-events.js"), "utf8");

function extractRegisteredActions(src) {
  return new Set([...src.matchAll(/^\s{4}([A-Za-z0-9_]+)\s*:/gm)].map(m => m[1]));
}
const regMainActions = extractRegisteredActions(eventsJs);
const regAdminActions = extractRegisteredActions(adminEventsJs);

const dataActionRe = /\bdata-(?:click|change|input|submit|keydown|dragover|dragleave|drop|backdrop-close)="([^"]+)"/g;
const missingMainActions = new Set();
for (const rel of ["index.html", ...[...relSet].filter(r => r.startsWith("js/") && r.endsWith(".js") && !["js/admin.js", "js/admin-events.js", "js/self-tests.js"].includes(r))]) {
  const txt = fs.readFileSync(path.join(ROOT, rel), "utf8");
  for (const m of txt.matchAll(dataActionRe)) {
    if (!regMainActions.has(m[1])) missingMainActions.add(`${m[1]} (${rel})`);
  }
}
check("All main app data-* delegated actions are registered in js/events.js", missingMainActions.size === 0, [...missingMainActions].join(", "));

const missingAdminActions = new Set();
for (const rel of ["admin.html", "js/admin.js"]) {
  const txt = fs.readFileSync(path.join(ROOT, rel), "utf8");
  for (const m of txt.matchAll(dataActionRe)) {
    if (!regAdminActions.has(m[1])) missingAdminActions.add(`${m[1]} (${rel})`);
  }
}
check("All admin console data-* delegated actions are registered in js/admin-events.js", missingAdminActions.size === 0, [...missingAdminActions].join(", "));

// 7. Security & Architecture Hygiene Checks
const fnJs = fs.readFileSync(path.join(ROOT, "functions/index.js"), "utf8");
const workerJs = fs.readFileSync(path.join(ROOT, "worker/quotes-worker.js"), "utf8");
const rules = JSON.parse(fs.readFileSync(path.join(ROOT, "firebase/database.rules.json"), "utf8"));

check(
  "No admin.html, tab-admin, admin-main.js or Self-Test leaks in public index.html",
  !indexHtml.includes("admin.html") && !indexHtml.includes('id="tab-admin"') && !indexHtml.includes("admin-main.js") && !indexHtml.includes("runAndShowSelfTests")
);
check("No admin.html in public/service-worker.js precache", !swJs.includes("admin.html"));
check("No hardcoded personal admin email in functions/index.js", !fnJs.includes("tgoulis@gmail.com"));
check("adminOverview uses lightweight roomIndex (never full rooms/)", fnJs.includes('db.ref("roomIndex").once("value")') && !fnJs.includes('db.ref("rooms").once("value")'));
check(
  "RTDB rules lock down roomIndex, adminAuditLog, adminTelemetry & userEntitlements writes",
  rules?.rules?.roomIndex?.[".read"] === false &&
    rules?.rules?.roomIndex?.[".write"] === false &&
    rules?.rules?.adminAuditLog?.[".read"] === false &&
    rules?.rules?.adminAuditLog?.[".write"] === false &&
    rules?.rules?.adminTelemetry?.[".read"] === false &&
    rules?.rules?.adminTelemetry?.[".write"] === false &&
    rules?.rules?.userEntitlements?.$uid?.[".write"] === false
);
check("Cloudflare Worker enforces Google RS256 + email_verified", workerJs.includes("verifyFirebaseGoogleToken") && workerJs.includes("payload.email_verified !== true"));
check(".gitignore protects functions/.env & dist/", fs.existsSync(path.join(ROOT, ".gitignore")) && fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8").includes("functions/.env") && fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8").includes("dist/"));

console.log("");
if (errors.length > 0) {
  console.error(`❌ Integrity check failed with ${errors.length} error(s).`);
  process.exit(1);
}
console.log("✅ All static integrity, Strict CSP, Event Delegation & security gates passed!");

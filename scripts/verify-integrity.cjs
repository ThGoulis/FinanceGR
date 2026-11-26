#!/usr/bin/env node
/**
 * FinanceGR Static Integrity, Syntax & Security Quality Gate
 * Run via: npm run check
 */
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const errors = [];
const warnings = [];

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
    if (["node_modules", ".git", ".firebase", "playwright-report", "test-results"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

console.log("\n=== FinanceGR Static Integrity & Security Gate ===\n");

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

// 2. JS syntax check (js/*.js, functions/*.js)
let badJs = [];
for (const rel of relSet) {
  if ((rel.startsWith("js/") || rel.startsWith("functions/") || rel.startsWith("scripts/")) && (rel.endsWith(".js") || rel.endsWith(".cjs"))) {
    try {
      const code = fs.readFileSync(path.join(ROOT, rel), "utf8");
      new vm.Script(code, { filename: rel });
    } catch (e) {
      badJs.push(`${rel} (${e.message})`);
    }
  }
}
check("All JavaScript files parse cleanly", badJs.length === 0, badJs.join(", "));

// 3. Local asset & Service Worker precache check
const indexHtml = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const swJs = fs.readFileSync(path.join(ROOT, "service-worker.js"), "utf8");

const localRefs = [...indexHtml.matchAll(/(?:src|href)="([^"]+)"/g)].map(m => m[1]);
const missingHtmlAssets = localRefs.filter(r =>
  !r.startsWith("http://") && !r.startsWith("https://") && !r.startsWith("data:") && !r.startsWith("#") && !r.startsWith("mailto:") &&
  !relSet.has(r.replace(/^\.\//, ""))
);
check("All index.html local assets exist", missingHtmlAssets.length === 0, missingHtmlAssets.join(", "));

const swUrls = [...swJs.matchAll(/["'](\.\/[^"']+)["']/g)].map(m => m[1]);
const missingSw = swUrls.filter(u => u !== "./" && !relSet.has(u.replace(/^\.\//, "")));
check("All service-worker.js precache entries exist", missingSw.length === 0, missingSw.join(", "));

// 4. Inline handler binding audit (index.html & admin.html)
const mainJsConcat = [...relSet]
  .filter(r => r.startsWith("js/") && r.endsWith(".js") && r !== "js/admin.js" && r !== "js/self-tests.js")
  .sort()
  .map(r => fs.readFileSync(path.join(ROOT, r), "utf8"))
  .join("\n");

const definedMain = new Set([
  ...[...mainJsConcat.matchAll(/(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/g)].map(m => m[1]),
  ...[...mainJsConcat.matchAll(/(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?(?:\(|function)/g)].map(m => m[1])
]);
const builtins = new Set(["if", "Number", "String", "Boolean", "Array", "Object", "Math", "Date", "console", "alert", "confirm", "event", "preventDefault"]);

const badMainHandlers = [];
for (const m of indexHtml.matchAll(/on(?:click|change|input|submit|dragover|dragleave|drop)="([^"]+)"/g)) {
  for (const c of m[1].matchAll(/\b([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g)) {
    if (!builtins.has(c[1]) && !definedMain.has(c[1])) {
      badMainHandlers.push(`${c[1]} in "${m[1].slice(0, 60)}"`);
    }
  }
}
check("All index.html inline handlers resolve to defined JS functions", badMainHandlers.length === 0, badMainHandlers.join("; "));

const adminHtml = fs.readFileSync(path.join(ROOT, "admin.html"), "utf8");
const adminJs = fs.readFileSync(path.join(ROOT, "js/admin.js"), "utf8");
const definedAdmin = new Set([...adminJs.matchAll(/(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/g)].map(m => m[1]));
const badAdminHandlers = [];
for (const m of adminHtml.matchAll(/on(?:click|change|input|submit)="([^"]+)"/g)) {
  for (const c of m[1].matchAll(/\b([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g)) {
    if (!builtins.has(c[1]) && !definedAdmin.has(c[1])) {
      badAdminHandlers.push(c[1]);
    }
  }
}
check("All admin.html inline handlers resolve to js/admin.js", badAdminHandlers.length === 0, badAdminHandlers.join(", "));

// 5. Security & Architecture Hygiene Checks
const fnJs = fs.readFileSync(path.join(ROOT, "functions/index.js"), "utf8");
const workerJs = fs.readFileSync(path.join(ROOT, "worker/quotes-worker.js"), "utf8");
const rules = JSON.parse(fs.readFileSync(path.join(ROOT, "firebase/database.rules.json"), "utf8"));

check("No admin.html, tab-admin or Self-Test button leaks in public index.html", !indexHtml.includes("admin.html") && !indexHtml.includes('id="tab-admin"') && !indexHtml.includes("runAndShowSelfTests"));
check("No admin.html in service-worker.js precache", !swJs.includes("admin.html"));
check("No hardcoded personal admin email in functions/index.js", !fnJs.includes("tgoulis@gmail.com"));
check("adminOverview uses lightweight roomIndex (never full rooms/)", fnJs.includes('db.ref("roomIndex").once("value")') && !fnJs.includes('db.ref("rooms").once("value")'));
check("RTDB rules lock down roomIndex, adminAuditLog & adminTelemetry (Admin SDK only)", rules?.rules?.roomIndex?.[".read"] === false && rules?.rules?.roomIndex?.[".write"] === false && rules?.rules?.adminAuditLog?.[".read"] === false && rules?.rules?.adminAuditLog?.[".write"] === false && rules?.rules?.adminTelemetry?.[".read"] === false && rules?.rules?.adminTelemetry?.[".write"] === false);
check("Cloudflare Worker enforces Google RS256 + email_verified", workerJs.includes("verifyFirebaseGoogleToken") && workerJs.includes("payload.email_verified !== true"));
check(".gitignore protects functions/.env", fs.existsSync(path.join(ROOT, ".gitignore")) && fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8").includes("functions/.env"));

console.log("");
if (errors.length > 0) {
  console.error(`❌ Integrity check failed with ${errors.length} error(s).`);
  process.exit(1);
}
console.log("✅ All static integrity, syntax & security gates passed!");

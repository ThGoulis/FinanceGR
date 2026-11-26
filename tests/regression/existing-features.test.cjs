const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("Core application, Vite bundler config, Strict CSP event delegation, and PWA files are present", () => {
  const root = path.join(__dirname, "..", "..");
  for (const rel of [
    "index.html",
    "admin.html",
    "styles.css",
    "vite.config.mjs",
    "src/main.js",
    "src/admin-main.js",
    "src/admin.css",
    "public/manifest.json",
    "public/service-worker.js",
    "js/state.js",
    "js/events.js",
    "js/admin-events.js",
    "js/wealth.js",
    "js/cloud-sync.js"
  ]) {
    assert.equal(fs.existsSync(path.join(root, rel)), true, `Missing ${rel}`);
  }
});

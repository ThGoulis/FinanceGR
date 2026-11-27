const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("Core application and PWA files are present in bundle", () => {
  const root = path.join(__dirname, "..", "..");
  for (const rel of ["index.html", "styles.css", "manifest.json", "service-worker.js", "js/state.js", "js/wealth.js", "js/cloud-sync.js"]) {
    assert.equal(fs.existsSync(path.join(root, rel)), true, `Missing ${rel}`);
  }
});

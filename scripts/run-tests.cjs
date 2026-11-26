#!/usr/bin/env node
/**
 * Cross-platform unit test runner (works identically on Windows PowerShell & Linux CI).
 * Runs all tests/**.test.cjs EXCEPT emulator/ and e2e/ suites.
 */
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const testsRoot = path.join(__dirname, "..", "tests");
const files = [];

function collect(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["emulator", "e2e", "helpers"].includes(entry.name)) continue;
      collect(full);
    } else if (entry.name.endsWith(".test.cjs")) {
      files.push(full);
    }
  }
}

collect(testsRoot);
files.sort();

if (files.length === 0) {
  console.error("No test files found.");
  process.exit(1);
}

console.log(`Running ${files.length} unit test suites...\n`);
const res = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
process.exit(res.status ?? 1);

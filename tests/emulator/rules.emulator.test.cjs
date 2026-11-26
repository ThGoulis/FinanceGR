/**
 * Live Firebase RTDB Emulator Security Rules Test
 * Run locally via: firebase emulators:exec --only database "npm run test:emulator"
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const EMU_HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST || "127.0.0.1:9000";
const NS = process.env.FIREBASE_EMULATOR_NS || "financegr-sync-default-rtdb";
const BASE = `http://${EMU_HOST}`;

test("RTDB Emulator denies unauthenticated reads/writes to rooms, userRooms, and roomIndex", async () => {
  const targets = [
    `${BASE}/rooms/FG-EMU-TEST.json?ns=${NS}`,
    `${BASE}/userRooms/uid1.json?ns=${NS}`,
    `${BASE}/roomIndex.json?ns=${NS}`
  ];

  for (const url of targets) {
    const r = await fetch(url);
    assert.equal(r.status, 401, `Expected 401 for unauthenticated GET ${url}, got ${r.status}`);
    const w = await fetch(url, { method: "PUT", body: JSON.stringify({ hack: true }) });
    assert.equal(w.status, 401, `Expected 401 for unauthenticated PUT ${url}, got ${w.status}`);
  }
});

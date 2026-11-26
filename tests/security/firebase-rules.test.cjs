const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("Firebase database rules block client writes to room root, metadata & members and restrict editors to data nodes", () => {
  const rulesPath = path.join(__dirname, "..", "..", "firebase", "database.rules.json");
  const rules = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
  const roomRules = rules.rules.rooms["$roomId"];

  assert.equal(rules.rules[".read"], false);
  assert.equal(rules.rules[".write"], false);
  assert.equal(roomRules[".write"], false);
  assert.equal(roomRules.metadata[".write"], false);
  assert.equal(roomRules.members[".write"], false);
  assert.ok(roomRules[".read"].includes("auth != null"));
  assert.ok(roomRules.sharedState[".write"].includes("editor"));
  assert.ok(roomRules.txs["$txId"][".write"].includes("editor"));
  assert.equal(rules.rules.userRooms["$uid"][".write"], false);
  assert.equal(rules.rules.roomIndex[".read"], false);
  assert.equal(rules.rules.roomIndex[".write"], false);
  assert.equal(rules.rules.adminAuditLog[".read"], false);
  assert.equal(rules.rules.adminAuditLog[".write"], false);
  assert.equal(rules.rules.adminTelemetry[".read"], false);
  assert.equal(rules.rules.adminTelemetry[".write"], false);
  assert.equal(rules.rules.userEntitlements.$uid[".read"], "auth != null && auth.uid === $uid");
  assert.equal(rules.rules.userEntitlements.$uid[".write"], false);
});

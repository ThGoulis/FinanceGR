const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");

function createMockRtdb() {
  const tree = {};
  const reads = [];

  function getPath(p) {
    if (!p) return tree;
    const parts = p.split("/").filter(Boolean);
    let cur = tree;
    for (const k of parts) {
      if (!cur || typeof cur !== "object" || !(k in cur)) return undefined;
      cur = cur[k];
    }
    return cur;
  }

  function setPath(p, val) {
    const parts = p.split("/").filter(Boolean);
    let cur = tree;
    for (let i = 0; i < parts.length - 1; i++) {
      const k = parts[i];
      if (!cur[k] || typeof cur[k] !== "object") cur[k] = {};
      cur = cur[k];
    }
    const last = parts[parts.length - 1];
    if (val === null || val === undefined) delete cur[last];
    else cur[last] = JSON.parse(JSON.stringify(val));
  }

  function makeRef(basePath = "") {
    return {
      child(sub) {
        return makeRef([basePath, sub].filter(Boolean).join("/"));
      },
      async once() {
        reads.push(basePath);
        const v = getPath(basePath);
        return {
          exists: () => v !== undefined && v !== null,
          val: () => (v === undefined ? null : JSON.parse(JSON.stringify(v)))
        };
      },
      async update(map) {
        for (const [k, v] of Object.entries(map)) {
          const full = [basePath, k].filter(Boolean).join("/");
          setPath(full, v);
        }
      }
    };
  }

  return { tree, reads, ref: (p = "") => makeRef(p) };
}

function makeRes() {
  const out = { statusCode: 200, headers: {}, body: null };
  return {
    out,
    set(k, v) { out.headers[k] = v; return this; },
    status(c) { out.statusCode = c; return this; },
    json(obj) { out.body = obj; return this; },
    send(v) { out.body = v; return this; }
  };
}

test("Cloud Functions: createRoom, manageMember, listMyRooms, and adminOverview enforce roles, last-owner guard, and roomIndex isolation", async () => {
  const db = createMockRtdb();
  const deletedAuthUids = [];
  const tokenMap = {
    "tok-admin": { uid: "uid-admin", email: "admin@test.gr", email_verified: true, firebase: { sign_in_provider: "google.com" } },
    "tok-owner": { uid: "uid-owner", email: "owner@test.gr", email_verified: true, firebase: { sign_in_provider: "google.com" } },
    "tok-other": { uid: "uid-other", email: "other@test.gr", email_verified: true, firebase: { sign_in_provider: "google.com" } },
    "tok-pw": { uid: "uid-pw", email: "admin@test.gr", email_verified: true, firebase: { sign_in_provider: "password" } }
  };
  const usersByEmail = {
    "other@test.gr": { uid: "uid-other", email: "other@test.gr" },
    "owner@test.gr": { uid: "uid-owner", email: "owner@test.gr" }
  };

  const mockAdmin = {
    apps: [],
    initializeApp() { this.apps.push({}); },
    auth() {
      return {
        async verifyIdToken(tok) {
          if (!tokenMap[tok]) throw new Error("Invalid token");
          return tokenMap[tok];
        },
        async getUserByEmail(email) {
          if (!usersByEmail[email]) throw new Error("User not found");
          return usersByEmail[email];
        },
        async deleteUser(uid) {
          deletedAuthUids.push(uid);
        }
      };
    },
    database() { return db; }
  };

  process.env.FINANCEGR_ADMIN_EMAILS = "admin@test.gr";
  const origLoad = Module._load;
  Module._load = function (req, parent, isMain) {
    if (req === "firebase-admin") return mockAdmin;
    if (req === "firebase-functions/v2/https") return { onRequest: (fn) => fn };
    if (req === "firebase-functions/v2") return { setGlobalOptions: () => {} };
    return origLoad.apply(this, arguments);
  };

  let fns;
  try {
    const fnFile = path.join(__dirname, "..", "..", "functions", "index.js");
    delete require.cache[require.resolve(fnFile)];
    fns = require(fnFile);
  } finally {
    Module._load = origLoad;
  }

  // 1. createRoom creates metadata, members, userRooms, AND roomIndex
  let res = makeRes();
  await fns.createRoom({ method: "POST", headers: { authorization: "Bearer tok-owner" }, body: { roomId: "FG-TEST-01" } }, res);
  assert.equal(res.out.statusCode, 201);
  assert.equal(db.tree.roomIndex["FG-TEST-01"].ownerUid, "uid-owner");
  assert.equal(db.tree.roomIndex["FG-TEST-01"].members["uid-owner"].role, "owner");

  // 2. Non-member cannot claim existing room -> 409
  res = makeRes();
  await fns.createRoom({ method: "POST", headers: { authorization: "Bearer tok-other" }, body: { roomId: "FG-TEST-01" } }, res);
  assert.equal(res.out.statusCode, 409);

  // 3. Owner invites other@test.gr as editor -> reflected in rooms & roomIndex
  res = makeRes();
  await fns.manageMember({ method: "POST", headers: { authorization: "Bearer tok-owner" }, body: { roomId: "FG-TEST-01", action: "add", targetEmail: "other@test.gr", role: "editor" } }, res);
  assert.equal(res.out.statusCode, 200);
  assert.equal(db.tree.roomIndex["FG-TEST-01"].members["uid-other"].role, "editor");

  // 4. Last owner cannot be removed -> 400
  res = makeRes();
  await fns.manageMember({ method: "POST", headers: { authorization: "Bearer tok-owner" }, body: { roomId: "FG-TEST-01", action: "remove", targetUid: "uid-owner" } }, res);
  assert.equal(res.out.statusCode, 400);

  // 5. Non-admin & password-provider blocked from adminOverview -> 403
  res = makeRes();
  await fns.adminOverview({ method: "POST", headers: { authorization: "Bearer tok-owner" }, body: {} }, res);
  assert.equal(res.out.statusCode, 403);
  res = makeRes();
  await fns.adminOverview({ method: "POST", headers: { authorization: "Bearer tok-pw" }, body: {} }, res);
  assert.equal(res.out.statusCode, 403);

  // 6. Verified Google Admin succeeds and ONLY reads roomIndex (never rooms)
  db.reads.length = 0;
  res = makeRes();
  await fns.adminOverview({ method: "POST", headers: { authorization: "Bearer tok-admin" }, body: {} }, res);
  assert.equal(res.out.statusCode, 200);
  assert.equal(res.out.body.summary.totalRooms, 1);
  assert.equal(res.out.body.summary.totalMembers, 2);
  assert.ok(db.reads.includes("roomIndex"));
  assert.equal(db.reads.includes("rooms"), false);
  assert.ok(Array.isArray(res.out.body.usersQuota) && res.out.body.usersQuota.length === 2);
  assert.ok(Array.isArray(res.out.body.auditLogs) && res.out.body.auditLogs.length >= 3);

  // 7. Per-user room quota (FINANCEGR_MAX_ROOMS_PER_USER=1) blocks 2nd room for non-admin
  process.env.FINANCEGR_MAX_ROOMS_PER_USER = "1";
  res = makeRes();
  await fns.createRoom({ method: "POST", headers: { authorization: "Bearer tok-owner" }, body: { roomId: "FG-TEST-02" } }, res);
  assert.equal(res.out.statusCode, 429);
  delete process.env.FINANCEGR_MAX_ROOMS_PER_USER;

  // 8. Admin can deleteRoom cleanly (purges rooms, roomIndex, and userRooms pointers)
  res = makeRes();
  await fns.deleteRoom({ method: "POST", headers: { authorization: "Bearer tok-admin" }, body: { roomId: "FG-TEST-01" } }, res);
  assert.equal(res.out.statusCode, 200);
  assert.equal(db.tree.rooms["FG-TEST-01"], undefined);
  assert.equal(db.tree.roomIndex["FG-TEST-01"], undefined);
  assert.equal(db.tree.userRooms["uid-owner"]["FG-TEST-01"], undefined);

  // 9. Zero-Knowledge logTelemetry: analytics counters & sanitized parser_error (strips PII)
  res = makeRes();
  await fns.logTelemetry({ method: "POST", headers: { "x-forwarded-for": "10.0.0.1" }, body: { kind: "analytics", event: "bank_import_success" } }, res);
  assert.equal(res.out.statusCode, 200);

  res = makeRes();
  await fns.logTelemetry({ method: "POST", headers: { "x-forwarded-for": "10.0.0.1" }, body: { kind: "analytics", event: "invalid_event_name" } }, res);
  assert.equal(res.out.statusCode, 400);

  res = makeRes();
  await fns.logTelemetry({
    method: "POST",
    headers: { "x-forwarded-for": "10.0.0.1" },
    body: {
      kind: "parser_error",
      bankSource: "Πειραιώς",
      fileExt: "xlsx",
      errorCode: "ZERO_ROWS_DETECTED",
      rowCountBucket: "1-50",
      appVersion: "v31",
      secretAmount: 99999,
      userEmail: "leak@test.gr"
    }
  }, res);
  assert.equal(res.out.statusCode, 200);
  const storedErr = Object.values(db.tree.adminTelemetry.parserErrors)[0];
  assert.equal(storedErr.bankSource, "Πειραιώς");
  assert.equal(storedErr.errorCode, "ZERO_ROWS_DETECTED");
  assert.equal(storedErr.secretAmount, undefined);
  assert.equal(storedErr.userEmail, undefined);

  // 10. Admin overview returns analytics totals & parserErrors; clearTelemetry purges parserErrors (admin-only)
  res = makeRes();
  await fns.adminOverview({ method: "POST", headers: { authorization: "Bearer tok-admin" }, body: {} }, res);
  assert.equal(res.out.statusCode, 200);
  assert.equal(res.out.body.analytics.totals.bank_import_success, 1);
  assert.equal(res.out.body.parserErrors.length, 1);
  assert.equal(res.out.body.infra.region, "europe-west1");
  assert.equal(res.out.body.infra.maxInstances, 2);
  assert.ok(res.out.body.infra.rtdbMetadataBytes.total > 0);
  assert.equal(res.out.body.infra.blazeFreeTier.functionsInvocationsPerMonth, 2000000);

  res = makeRes();
  await fns.clearTelemetry({ method: "POST", headers: { authorization: "Bearer tok-owner" }, body: { target: "parserErrors" } }, res);
  assert.equal(res.out.statusCode, 403);

  res = makeRes();
  await fns.clearTelemetry({ method: "POST", headers: { authorization: "Bearer tok-admin" }, body: { target: "parserErrors" } }, res);
  assert.equal(res.out.statusCode, 200);
  assert.equal(db.tree.adminTelemetry.parserErrors, undefined);

  // 11. Server-side Entitlements: getMyEntitlements (default free) & setUserPlan (admin-only -> pro)
  res = makeRes();
  await fns.getMyEntitlements({ method: "POST", headers: { authorization: "Bearer tok-owner" }, body: {} }, res);
  assert.equal(res.out.statusCode, 200);
  assert.equal(res.out.body.entitlement.plan, "free");

  res = makeRes();
  await fns.setUserPlan({ method: "POST", headers: { authorization: "Bearer tok-owner" }, body: { targetUid: "uid-owner", plan: "pro" } }, res);
  assert.equal(res.out.statusCode, 403);

  res = makeRes();
  await fns.setUserPlan({ method: "POST", headers: { authorization: "Bearer tok-admin" }, body: { targetUid: "uid-owner", plan: "pro" } }, res);
  assert.equal(res.out.statusCode, 200);
  assert.equal(res.out.body.entitlement.plan, "pro");
  assert.equal(res.out.body.entitlement.maxRooms, 20);

  // 12. GDPR Art. 17 Self-Service deleteMyAccount: purges sole room, promotes successor in shared room, deletes Auth user
  res = makeRes();
  await fns.createRoom({ method: "POST", headers: { authorization: "Bearer tok-owner" }, body: { roomId: "FG-SOLO-01" } }, res);
  assert.equal(res.out.statusCode, 201);

  res = makeRes();
  await fns.createRoom({ method: "POST", headers: { authorization: "Bearer tok-owner" }, body: { roomId: "FG-SHARED-01" } }, res);
  assert.equal(res.out.statusCode, 201);
  res = makeRes();
  await fns.manageMember({ method: "POST", headers: { authorization: "Bearer tok-owner" }, body: { roomId: "FG-SHARED-01", action: "add", targetEmail: "other@test.gr", role: "editor" } }, res);
  assert.equal(res.out.statusCode, 200);

  // Missing confirmation string -> 400
  res = makeRes();
  await fns.deleteMyAccount({ method: "POST", headers: { authorization: "Bearer tok-owner" }, body: { confirm: "NO" } }, res);
  assert.equal(res.out.statusCode, 400);

  // Confirmed GDPR deletion -> sole room purged, shared room transferred to uid-other, userRooms/userEntitlements & Auth deleted
  res = makeRes();
  await fns.deleteMyAccount({ method: "POST", headers: { authorization: "Bearer tok-owner" }, body: { confirm: "DELETE_MY_ACCOUNT" } }, res);
  assert.equal(res.out.statusCode, 200);
  assert.equal(res.out.body.purgedRooms, 1);
  assert.equal(res.out.body.leftSharedRooms, 1);
  assert.equal(db.tree.rooms["FG-SOLO-01"], undefined);
  assert.equal(db.tree.roomIndex["FG-SOLO-01"], undefined);
  assert.equal(db.tree.rooms["FG-SHARED-01"].members["uid-owner"], undefined);
  assert.equal(db.tree.rooms["FG-SHARED-01"].members["uid-other"].role, "owner");
  assert.equal(db.tree.userRooms["uid-owner"], undefined);
  assert.equal(db.tree.userEntitlements["uid-owner"], undefined);
  assert.ok(deletedAuthUids.includes("uid-owner"));
});




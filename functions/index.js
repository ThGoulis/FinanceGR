/**
 * FinanceGR — Trusted Room & Membership Management (Cloud Functions 2nd Gen)
 * Region: europe-west1 | maxInstances: 2 (cost-safe for personal/family Blaze plan)
 */
const { onRequest } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const admin = require("firebase-admin");

setGlobalOptions({
  region: "europe-west1",
  maxInstances: 2,
  memory: "256MiB",
  timeoutSeconds: 15
});

if (!admin.apps.length) {
  admin.initializeApp();
}

const ALLOWED_ORIGINS = new Set([
  "https://thgoulis.github.io",
  "http://localhost:3000",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "http://127.0.0.1:8080",
  "http://127.0.0.1:4173",
  "http://localhost:4173"
]);

const ROOM_ID_REGEX = /^[A-Z0-9][A-Z0-9_-]{3,48}$/;
const ALLOWED_ROLES = new Set(["owner", "editor", "viewer"]);

function getAdminEmailSet() {
  return new Set(
    String(process.env.FINANCEGR_ADMIN_EMAILS || "")
      .split(",")
      .map(s => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

function getBetaAllowedEmailSet() {
  return new Set(
    String(process.env.FINANCEGR_ALLOWED_EMAILS || "")
      .split(",")
      .map(s => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

function isUserAllowedForCloudRooms(decoded) {
  if (!decoded) return false;
  if (isSystemAdmin(decoded)) return true;
  const allowSet = getBetaAllowedEmailSet();
  if (allowSet.size === 0) return true; // Open to all authenticated users unless allowlist is configured
  const email = String(decoded.email || "").trim().toLowerCase();
  return Boolean(email && decoded.email_verified === true && allowSet.has(email));
}

function getMaxRoomsPerUser() {
  const n = Number(process.env.FINANCEGR_MAX_ROOMS_PER_USER || 5);
  return Number.isFinite(n) && n >= 1 ? Math.min(50, Math.floor(n)) : 5;
}

function isSystemAdmin(decoded) {
  if (!decoded) return false;
  const provider = String(decoded?.firebase?.sign_in_provider || "");
  if (provider !== "google.com") return false;
  if (decoded.email_verified !== true) return false;
  if (decoded.admin === true) return true;
  const email = String(decoded.email || "").trim().toLowerCase();
  return Boolean(email && getAdminEmailSet().has(email));
}

function applyCors(req, res) {
  const origin = req.headers.origin || "";
  if (ALLOWED_ORIGINS.has(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
  } else {
    res.set("Access-Control-Allow-Origin", "https://thgoulis.github.io");
  }
  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

async function verifyCaller(req) {
  const authHeader = String(req.headers.authorization || "");
  if (!authHeader.startsWith("Bearer ")) {
    const err = new Error("Missing Authorization Bearer token");
    err.status = 401;
    throw err;
  }
  const idToken = authHeader.slice(7).trim();
  if (!idToken) {
    const err = new Error("Empty Firebase ID token");
    err.status = 401;
    throw err;
  }
  try {
    return await admin.auth().verifyIdToken(idToken, true);
  } catch (e) {
    const err = new Error("Invalid or expired Firebase ID token");
    err.status = 401;
    throw err;
  }
}

function normalizeRoomId(raw) {
  return String(raw || "").trim().toUpperCase();
}

const ALLOWED_ANALYTICS_EVENTS = new Set([
  "session_start",
  "onboarding_completed",
  "demo_loaded",
  "bank_import_success",
  "cloud_sync_connected"
]);

const ALLOWED_BANK_SOURCES = new Set([
  "Πειραιώς",
  "Εθνική",
  "Alpha Bank",
  "Eurobank",
  "Revolut",
  "Viva Wallet",
  "Τράπεζα",
  "Unknown"
]);

const ALLOWED_FILE_EXTS = new Set(["xlsx", "xls", "csv", "other"]);
const ALLOWED_PARSER_ERROR_CODES = new Set([
  "FILE_TOO_LARGE",
  "PARSE_EXCEPTION",
  "ZERO_ROWS_DETECTED",
  "COLUMN_MAP_FALLBACK"
]);
const ALLOWED_ROW_BUCKETS = new Set(["0", "1-50", "51-200", "200+"]);

const _telemetryRateMap = new Map();
function checkTelemetryRateLimit(req) {
  const fwd = String(req.headers["x-forwarded-for"] || req.ip || "unknown").split(",")[0].trim();
  const now = Date.now();
  const windowMs = 60 * 1000;
  const maxPerMin = Number(process.env.FINANCEGR_TELEMETRY_RPM || 25);
  const limit = Number.isFinite(maxPerMin) && maxPerMin >= 1 ? Math.floor(maxPerMin) : 25;

  const entry = _telemetryRateMap.get(fwd);
  if (!entry || (now - entry.windowStart) >= windowMs) {
    if (_telemetryRateMap.size > 500) {
      for (const [k, v] of _telemetryRateMap.entries()) {
        if ((now - v.windowStart) >= windowMs) _telemetryRateMap.delete(k);
      }
    }
    _telemetryRateMap.set(fwd, { windowStart: now, count: 1 });
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count += 1;
  return true;
}

async function recordAuditEvent(db, { action, severity = "info", actorUid = "", actorEmail = "", roomId = "", statusCode = 200, detail = "" }) {
  try {
    const now = Date.now();
    const id = `evt_${now}_${Math.random().toString(36).slice(2, 8)}`;
    const entry = {
      id,
      ts: now,
      action: String(action || "unknown").slice(0, 60),
      severity: ["info", "warn", "security"].includes(severity) ? severity : "info",
      actorUid: String(actorUid || "").slice(0, 80),
      actorEmail: String(actorEmail || "").slice(0, 120),
      roomId: String(roomId || "").slice(0, 60),
      statusCode: Number(statusCode) || 200,
      detail: String(detail || "").slice(0, 180)
    };
    const updates = {};
    updates[`adminAuditLog/${id}`] = entry;

    // Keep rolling window bounded to latest 120 entries
    const snap = await db.ref("adminAuditLog").once("value");
    const val = snap.val() || {};
    const keys = Object.keys(val);
    if (keys.length >= 120) {
      const sorted = keys
        .map(k => ({ k, ts: Number(val[k]?.ts) || 0 }))
        .sort((a, b) => a.ts - b.ts);
      const excess = keys.length - 119;
      for (let i = 0; i < excess; i++) {
        updates[`adminAuditLog/${sorted[i].k}`] = null;
      }
    }
    await db.ref().update(updates);
  } catch (e) {
    console.warn("Audit log write skipped:", e?.message || e);
  }
}

function buildUsersQuotaFromRooms(rooms, maxRoomsPerUser, nowMs = Date.now()) {
  const userMap = new Map();
  for (const r of rooms) {
    const updatedAt = Number(r.updatedAt) || Number(r.createdAt) || 0;
    const members = r.members && typeof r.members === "object" ? r.members : {};
    for (const [uid, info] of Object.entries(members)) {
      if (!userMap.has(uid)) {
        userMap.set(uid, {
          uid,
          email: String(info?.email || ""),
          roomsCount: 0,
          ownedRoomsCount: 0,
          maxRooms: maxRoomsPerUser,
          lastActivityAt: 0,
          rooms: []
        });
      }
      const u = userMap.get(uid);
      if (!u.email && info?.email) u.email = String(info.email);
      u.roomsCount += 1;
      if (String(info?.role || "").toLowerCase() === "owner") u.ownedRoomsCount += 1;
      const activityTs = Math.max(updatedAt, Number(info?.joinedAt) || 0);
      if (activityTs > u.lastActivityAt) u.lastActivityAt = activityTs;
      u.rooms.push(r.roomId);
    }
  }

  const dayMs = 24 * 60 * 60 * 1000;
  return Array.from(userMap.values())
    .map(u => {
      const inactiveDays = u.lastActivityAt > 0
        ? Math.max(0, Math.floor((nowMs - u.lastActivityAt) / dayMs))
        : 0;
      let status = "active";
      if (u.roomsCount >= u.maxRooms) status = "at_quota";
      else if (inactiveDays >= 60) status = "inactive_60d";
      else if (inactiveDays >= 30) status = "inactive_30d";
      return { ...u, inactiveDays, status };
    })
    .sort((a, b) => (b.roomsCount - a.roomsCount) || (b.lastActivityAt - a.lastActivityAt));
}


/**
 * POST /createRoom
 * Body: { roomId: "FG-XXXX-XXXX" }
 * Creates a new room atomically if it does not already exist and assigns caller as owner.
 */
exports.createRoom = onRequest(async (req, res) => {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const decoded = await verifyCaller(req);
    if (!isUserAllowedForCloudRooms(decoded)) {
      await recordAuditEvent(admin.database(), {
        action: "beta_allowlist_denied",
        severity: "security",
        actorUid: decoded.uid,
        actorEmail: decoded.email || "",
        roomId: normalizeRoomId(req.body?.roomId),
        statusCode: 403,
        detail: "Αποκλεισμός δημιουργίας room (εκτός Beta Allowlist)"
      });
      return res.status(403).json({ ok: false, error: "Η δημιουργία δωματίου Cloud Sync είναι περιορισμένη σε προσκεκλημένους χρήστες (Beta Allowlist)." });
    }

    const uid = decoded.uid;
    const email = decoded.email || "";
    const roomId = normalizeRoomId(req.body?.roomId);

    if (!ROOM_ID_REGEX.test(roomId)) {
      return res.status(400).json({ ok: false, error: "Μη έγκυρος κωδικός δωματίου (4-48 χαρακτήρες A-Z, 0-9, -, _)." });
    }

    const db = admin.database();
    const roomRef = db.ref(`rooms/${roomId}`);
    const existingSnap = await roomRef.child("metadata").once("value");

    if (existingSnap.exists()) {
      const memberSnap = await roomRef.child(`members/${uid}`).once("value");
      if (memberSnap.exists()) {
        return res.status(200).json({
          ok: true,
          alreadyMember: true,
          roomId,
          role: memberSnap.val().role || "viewer"
        });
      }
      return res.status(409).json({
        ok: false,
        error: "Αυτός ο κωδικός δωματίου υπάρχει ήδη. Ζήτησε πρόσκληση από τον Owner ή διάλεξε νέο κωδικό."
      });
    }

    // Enforce per-user room quota (prevents database spam / abuse)
    if (!isSystemAdmin(decoded)) {
      const userRoomsSnap = await db.ref(`userRooms/${uid}`).once("value");
      const currentRoomsCount = userRoomsSnap.exists() ? Object.keys(userRoomsSnap.val() || {}).length : 0;
      const maxRooms = getMaxRoomsPerUser();
      if (currentRoomsCount >= maxRooms) {
        await recordAuditEvent(db, {
          action: "room_quota_exceeded",
          severity: "warn",
          actorUid: uid,
          actorEmail: email,
          roomId,
          statusCode: 429,
          detail: `Όριο δωματίων (${currentRoomsCount}/${maxRooms})`
        });
        return res.status(429).json({
          ok: false,
          error: `Έχεις φτάσει το μέγιστο όριο (${maxRooms}) δωματίων ανά λογαριασμό. Διέγραψε ή αποσυνδέσου από παλαιότερο δωμάτιο.`
        });
      }
    }

    const now = Date.now();
    const updates = {};
    updates[`rooms/${roomId}/metadata`] = {
      ownerUid: uid,
      createdAt: now,
      schemaVersion: 2
    };
    updates[`rooms/${roomId}/members/${uid}`] = {
      role: "owner",
      joinedAt: now,
      email
    };
    updates[`userRooms/${uid}/${roomId}`] = {
      role: "owner",
      joinedAt: now
    };
    updates[`roomIndex/${roomId}`] = {
      ownerUid: uid,
      createdAt: now,
      updatedAt: now,
      schemaVersion: 2,
      members: {
        [uid]: {
          role: "owner",
          joinedAt: now,
          email
        }
      }
    };

    await db.ref().update(updates);
    await recordAuditEvent(db, {
      action: "room_created",
      severity: "info",
      actorUid: uid,
      actorEmail: email,
      roomId,
      statusCode: 201,
      detail: "Δημιουργία νέου κρυπτογραφημένου δωματίου"
    });
    return res.status(201).json({ ok: true, roomId, role: "owner", createdAt: now });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ ok: false, error: err.message || "Internal error" });
  }
});

/**
 * POST /manageMember
 * Body: { roomId, action: "add" | "updateRole" | "remove", targetEmail?, targetUid?, role?: "editor"|"viewer"|"owner" }
 * Only an existing room owner can add, change role, or remove members.
 */
exports.manageMember = onRequest(async (req, res) => {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const decoded = await verifyCaller(req);
    const callerUid = decoded.uid;
    const roomId = normalizeRoomId(req.body?.roomId);
    const action = String(req.body?.action || "").trim();

    if (!ROOM_ID_REGEX.test(roomId)) {
      return res.status(400).json({ ok: false, error: "Μη έγκυρο roomId." });
    }
    if (!["add", "updateRole", "remove"].includes(action)) {
      return res.status(400).json({ ok: false, error: "Μη έγκυρη ενέργεια (add, updateRole, remove)." });
    }

    const db = admin.database();
    const callerMemberSnap = await db.ref(`rooms/${roomId}/members/${callerUid}`).once("value");
    const isRoomOwner = callerMemberSnap.exists() && callerMemberSnap.val().role === "owner";
    if (!isRoomOwner && !isSystemAdmin(decoded)) {
      await recordAuditEvent(db, {
        action: "manage_member_denied",
        severity: "security",
        actorUid: callerUid,
        actorEmail: decoded.email || "",
        roomId,
        statusCode: 403,
        detail: `Ανεπαρκή δικαιώματα για ενέργεια ${action}`
      });
      return res.status(403).json({ ok: false, error: "Μόνο ο Owner του δωματίου ή ο εξουσιοδοτημένος Admin μπορεί να διαχειρίζεται μέλη." });
    }

    let targetUid = String(req.body?.targetUid || "").trim();
    let targetEmail = String(req.body?.targetEmail || "").trim().toLowerCase();

    if (!targetUid && targetEmail) {
      try {
        const userRecord = await admin.auth().getUserByEmail(targetEmail);
        targetUid = userRecord.uid;
        targetEmail = userRecord.email || targetEmail;
      } catch {
        return res.status(404).json({
          ok: false,
          error: "Δεν βρέθηκε λογαριασμός με αυτό το email. Ο χρήστης πρέπει να συνδεθεί μία φορά στο FinanceGR πρώτα."
        });
      }
    }

    if (!targetUid) {
      return res.status(400).json({ ok: false, error: "Απαιτείται targetEmail ή targetUid." });
    }

    const allMembersSnap = await db.ref(`rooms/${roomId}/members`).once("value");
    const allMembers = allMembersSnap.val() || {};
    const ownerCount = Object.values(allMembers).filter(m => m && m.role === "owner").length;

    const updates = {};
    if (action === "remove") {
      if (allMembers[targetUid]?.role === "owner" && ownerCount <= 1) {
        return res.status(400).json({ ok: false, error: "Δεν μπορείς να αφαιρέσεις τον μοναδικό Owner του δωματίου." });
      }
      const removeNow = Date.now();
      updates[`rooms/${roomId}/members/${targetUid}`] = null;
      updates[`userRooms/${targetUid}/${roomId}`] = null;
      updates[`roomIndex/${roomId}/members/${targetUid}`] = null;
      updates[`roomIndex/${roomId}/updatedAt`] = removeNow;
      await db.ref().update(updates);
      await recordAuditEvent(db, {
        action: "member_removed",
        severity: "warn",
        actorUid: callerUid,
        actorEmail: decoded.email || "",
        roomId,
        statusCode: 200,
        detail: `Αφαίρεση μέλους ${targetEmail || targetUid}`
      });
      return res.status(200).json({ ok: true, action: "remove", roomId, targetUid });
    }

    const role = String(req.body?.role || "editor").trim().toLowerCase();
    if (!ALLOWED_ROLES.has(role)) {
      return res.status(400).json({ ok: false, error: "Μη έγκυρος ρόλος (owner, editor, viewer)." });
    }
    if (allMembers[targetUid]?.role === "owner" && role !== "owner" && ownerCount <= 1) {
      return res.status(400).json({ ok: false, error: "Πρέπει να παραμείνει τουλάχιστον ένας Owner στο δωμάτιο." });
    }

    const now = Date.now();
    const memberRecord = {
      role,
      joinedAt: allMembers[targetUid]?.joinedAt || now,
      email: targetEmail || allMembers[targetUid]?.email || ""
    };
    updates[`rooms/${roomId}/members/${targetUid}`] = memberRecord;
    updates[`userRooms/${targetUid}/${roomId}`] = {
      role,
      joinedAt: memberRecord.joinedAt
    };
    updates[`roomIndex/${roomId}/members/${targetUid}`] = memberRecord;
    updates[`roomIndex/${roomId}/updatedAt`] = now;
    await db.ref().update(updates);
    await recordAuditEvent(db, {
      action: action === "add" ? "member_added" : "member_role_updated",
      severity: "info",
      actorUid: callerUid,
      actorEmail: decoded.email || "",
      roomId,
      statusCode: 200,
      detail: `${memberRecord.email || targetUid} -> ${role}`
    });
    return res.status(200).json({ ok: true, action, roomId, targetUid, email: targetEmail, role });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ ok: false, error: err.message || "Internal error" });
  }
});

/**
 * POST /listMyRooms
 * Returns the rooms where the authenticated user is a registered member.
 */
exports.listMyRooms = onRequest(async (req, res) => {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const decoded = await verifyCaller(req);
    const snap = await admin.database().ref(`userRooms/${decoded.uid}`).once("value");
    const val = snap.val() || {};
    const rooms = Object.entries(val).map(([roomId, info]) => ({
      roomId,
      role: info?.role || "viewer",
      joinedAt: info?.joinedAt || 0
    }));
    return res.status(200).json({ ok: true, uid: decoded.uid, rooms });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ ok: false, error: err.message || "Internal error" });
  }
});

/**
 * POST /adminOverview
 * Strictly restricted to verified System Admin (Google Sign-In + email_verified + allowlist/custom claim).
 * Returns ONLY room metadata and membership lists (NEVER encrypted sharedState or txs — zero-knowledge preserved).
 */
exports.adminOverview = onRequest(async (req, res) => {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const decoded = await verifyCaller(req);
    if (!isSystemAdmin(decoded)) {
      await recordAuditEvent(admin.database(), {
        action: "admin_access_denied",
        severity: "security",
        actorUid: decoded.uid,
        actorEmail: decoded.email || "",
        statusCode: 403,
        detail: "Μη εξουσιοδοτημένη απόπειρα εισόδου στο Admin Console"
      });
      return res.status(403).json({ ok: false, error: "Μη εξουσιοδοτημένη πρόσβαση διαχειριστή." });
    }

    const db = admin.database();
    // Read ONLY lightweight roomIndex (metadata + memberships) — never load encrypted rooms/ payloads
    const indexSnap = await db.ref("roomIndex").once("value");
    const indexVal = indexSnap.val() || {};
    const rooms = [];
    let totalMembers = 0;

    for (const [roomId, idxObj] of Object.entries(indexVal)) {
      if (!idxObj || typeof idxObj !== "object") continue;
      const rawMembers = idxObj.members && typeof idxObj.members === "object" ? idxObj.members : {};
      const members = {};
      for (const [uid, info] of Object.entries(rawMembers)) {
        if (info && typeof info === "object" && typeof info.role === "string") {
          members[uid] = {
            role: String(info.role).toLowerCase(),
            email: String(info.email || ""),
            joinedAt: Number(info.joinedAt) || 0
          };
          totalMembers++;
        }
      }
      rooms.push({
        roomId,
        isLegacy: false,
        ownerUid: String(idxObj.ownerUid || ""),
        createdAt: Number(idxObj.createdAt) || 0,
        updatedAt: Number(idxObj.updatedAt) || Number(idxObj.createdAt) || 0,
        schemaVersion: Number(idxObj.schemaVersion) || 2,
        txCount: null,
        members
      });
    }

    rooms.sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));

    const maxRoomsPerUser = getMaxRoomsPerUser();
    const usersQuota = buildUsersQuotaFromRooms(rooms, maxRoomsPerUser);

    // Read lightweight audit log & anonymous telemetry nodes (never encrypted rooms/)
    const [auditSnap, telemetrySnap] = await Promise.all([
      db.ref("adminAuditLog").once("value"),
      db.ref("adminTelemetry").once("value")
    ]);

    const auditVal = auditSnap.val() || {};
    const auditLogs = Object.values(auditVal)
      .filter(e => e && typeof e === "object")
      .sort((a, b) => (Number(b.ts) || 0) - (Number(a.ts) || 0))
      .slice(0, 100);

    const teleVal = telemetrySnap.val() || {};
    const rawParserErrors = teleVal.parserErrors && typeof teleVal.parserErrors === "object" ? teleVal.parserErrors : {};
    const parserErrors = Object.values(rawParserErrors)
      .filter(e => e && typeof e === "object")
      .sort((a, b) => (Number(b.ts) || 0) - (Number(a.ts) || 0))
      .slice(0, 80);

    const rawDaily = teleVal.analytics && teleVal.analytics.daily && typeof teleVal.analytics.daily === "object"
      ? teleVal.analytics.daily
      : {};
    const dailyKeys = Object.keys(rawDaily).sort().slice(-14).reverse();
    const analyticsTotals = {
      session_start: 0,
      onboarding_completed: 0,
      demo_loaded: 0,
      bank_import_success: 0,
      cloud_sync_connected: 0
    };
    const analyticsDaily = dailyKeys.map(day => {
      const row = rawDaily[day] || {};
      const item = {
        day,
        session_start: Number(row.session_start) || 0,
        onboarding_completed: Number(row.onboarding_completed) || 0,
        demo_loaded: Number(row.demo_loaded) || 0,
        bank_import_success: Number(row.bank_import_success) || 0,
        cloud_sync_connected: Number(row.cloud_sync_connected) || 0
      };
      for (const k of Object.keys(analyticsTotals)) {
        analyticsTotals[k] += item[k];
      }
      return item;
    });

    const securityAlertsCount = auditLogs.filter(e => e.severity === "security" || e.statusCode === 403 || e.statusCode === 429).length;
    const inactiveUsersCount = usersQuota.filter(u => u.inactiveDays >= 30).length;

    const byteLen = (obj) => {
      try { return Buffer.byteLength(JSON.stringify(obj || {}), "utf8"); }
      catch { return 0; }
    };
    const roomIndexBytes = byteLen(indexVal);
    const auditBytes = byteLen(auditVal);
    const telemetryBytes = byteLen(teleVal);
    const betaAllowSet = getBetaAllowedEmailSet();
    const adminSet = getAdminEmailSet();

    return res.status(200).json({
      ok: true,
      admin: {
        uid: decoded.uid,
        email: decoded.email || ""
      },
      summary: {
        totalRooms: rooms.length,
        authRooms: rooms.filter(r => !r.isLegacy).length,
        legacyRooms: rooms.filter(r => r.isLegacy).length,
        totalMembers,
        uniqueUsers: usersQuota.length,
        maxRoomsPerUser,
        inactiveUsersCount,
        securityAlertsCount,
        parserErrorsCount: parserErrors.length
      },
      infra: {
        projectId: String(process.env.GCLOUD_PROJECT || "financegr-sync"),
        region: "europe-west1",
        runtime: process.version || "v22",
        plan: "Blaze (Pay-as-you-go + Free Tier)",
        maxInstances: 2,
        memory: "256MiB",
        timeoutSeconds: 15,
        maxRoomsPerUser,
        betaAllowlistActive: betaAllowSet.size > 0,
        betaAllowlistCount: betaAllowSet.size,
        adminEmailsCount: adminSet.size,
        rtdbMetadataBytes: {
          roomIndex: roomIndexBytes,
          auditLog: auditBytes,
          telemetry: telemetryBytes,
          total: roomIndexBytes + auditBytes + telemetryBytes
        },
        blazeFreeTier: {
          functionsInvocationsPerMonth: 2000000,
          rtdbStorageGb: 1,
          rtdbBandwidthGbPerMonth: 10,
          authGoogleMau: 50000
        },
        serverTimestamp: Date.now()
      },
      rooms,
      usersQuota,
      auditLogs,
      parserErrors,
      analytics: {
        windowDays: 14,
        totals: analyticsTotals,
        daily: analyticsDaily
      }
    });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ ok: false, error: err.message || "Internal error" });
  }
});

/**
 * POST /deleteRoom
 * Body: { roomId }
 * Allows System Admin (or the Room Owner) to permanently purge a room and its index/member pointers.
 */
exports.deleteRoom = onRequest(async (req, res) => {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const decoded = await verifyCaller(req);
    const callerUid = decoded.uid;
    const roomId = normalizeRoomId(req.body?.roomId);
    if (!ROOM_ID_REGEX.test(roomId)) {
      return res.status(400).json({ ok: false, error: "Μη έγκυρος κωδικός δωματίου." });
    }

    const db = admin.database();
    const callerMemberSnap = await db.ref(`rooms/${roomId}/members/${callerUid}`).once("value");
    const isRoomOwner = callerMemberSnap.exists() && callerMemberSnap.val()?.role === "owner";
    if (!isRoomOwner && !isSystemAdmin(decoded)) {
      await recordAuditEvent(db, {
        action: "delete_room_denied",
        severity: "security",
        actorUid: callerUid,
        actorEmail: decoded.email || "",
        roomId,
        statusCode: 403,
        detail: "Μη εξουσιοδοτημένη απόπειρα διαγραφής δωματίου"
      });
      return res.status(403).json({ ok: false, error: "Μόνο ο διαχειριστής συστήματος ή ο Owner μπορεί να διαγράψει δωμάτιο." });
    }

    const idxMembersSnap = await db.ref(`roomIndex/${roomId}/members`).once("value");
    const roomMembersSnap = await db.ref(`rooms/${roomId}/members`).once("value");
    const memberUids = new Set([
      ...Object.keys(idxMembersSnap.val() || {}),
      ...Object.keys(roomMembersSnap.val() || {}),
      callerUid
    ]);

    const updates = {};
    updates[`rooms/${roomId}`] = null;
    updates[`roomIndex/${roomId}`] = null;
    for (const mUid of memberUids) {
      if (mUid) updates[`userRooms/${mUid}/${roomId}`] = null;
    }

    await db.ref().update(updates);
    await recordAuditEvent(db, {
      action: "room_deleted",
      severity: "warn",
      actorUid: callerUid,
      actorEmail: decoded.email || "",
      roomId,
      statusCode: 200,
      detail: `Οριστική διαγραφή δωματίου (${memberUids.size} μέλη)`
    });
    return res.status(200).json({ ok: true, deletedRoomId: roomId, cleanedMembers: memberUids.size });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ ok: false, error: err.message || "Internal error" });
  }
});

/**
 * POST /logTelemetry
 * Strictly zero-knowledge, zero-PII endpoint for:
 *  1) Aggregate daily product analytics counters (kind: "analytics")
 *  2) Anonymous bank parser error codes (kind: "parser_error")
 * Rejects free-text fields and never stores amounts, descriptions, filenames, or user identifiers.
 */
exports.logTelemetry = onRequest(async (req, res) => {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  if (!checkTelemetryRateLimit(req)) {
    return res.status(429).json({ ok: false, error: "Rate limit exceeded" });
  }

  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const kind = String(body.kind || "").trim();
    const db = admin.database();

    if (kind === "analytics") {
      const eventName = String(body.event || "").trim();
      if (!ALLOWED_ANALYTICS_EVENTS.has(eventName)) {
        return res.status(400).json({ ok: false, error: "Invalid analytics event" });
      }
      const dayKey = new Date().toISOString().slice(0, 10);
      const refPath = `adminTelemetry/analytics/daily/${dayKey}/${eventName}`;
      const snap = await db.ref(refPath).once("value");
      const currentVal = Number(snap.val()) || 0;
      const updates = {};
      updates[refPath] = currentVal + 1;
      await db.ref().update(updates);
      return res.status(200).json({ ok: true, kind: "analytics", day: dayKey, event: eventName });
    }

    if (kind === "parser_error") {
      const bankSource = ALLOWED_BANK_SOURCES.has(body.bankSource) ? body.bankSource : "Unknown";
      const fileExt = ALLOWED_FILE_EXTS.has(String(body.fileExt || "").toLowerCase())
        ? String(body.fileExt).toLowerCase()
        : "other";
      const errorCode = ALLOWED_PARSER_ERROR_CODES.has(body.errorCode) ? body.errorCode : "PARSE_EXCEPTION";
      const rowCountBucket = ALLOWED_ROW_BUCKETS.has(body.rowCountBucket) ? body.rowCountBucket : "0";
      const appVersion = String(body.appVersion || "unknown").replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 24) || "unknown";

      const now = Date.now();
      const id = `perr_${now}_${Math.random().toString(36).slice(2, 8)}`;
      const updates = {};
      updates[`adminTelemetry/parserErrors/${id}`] = {
        id,
        ts: now,
        bankSource,
        fileExt,
        errorCode,
        rowCountBucket,
        appVersion
      };

      const snap = await db.ref("adminTelemetry/parserErrors").once("value");
      const val = snap.val() || {};
      const keys = Object.keys(val);
      if (keys.length >= 100) {
        const sorted = keys
          .map(k => ({ k, ts: Number(val[k]?.ts) || 0 }))
          .sort((a, b) => a.ts - b.ts);
        const excess = keys.length - 99;
        for (let i = 0; i < excess; i++) {
          updates[`adminTelemetry/parserErrors/${sorted[i].k}`] = null;
        }
      }

      await db.ref().update(updates);
      return res.status(200).json({ ok: true, kind: "parser_error", id });
    }

    return res.status(400).json({ ok: false, error: "Invalid telemetry kind (analytics | parser_error)" });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || "Internal error" });
  }
});

/**
 * POST /clearTelemetry
 * Body: { target: "parserErrors" | "auditLog" }
 * Admin-only maintenance action to clear resolved parser error logs.
 */
exports.clearTelemetry = onRequest(async (req, res) => {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const decoded = await verifyCaller(req);
    if (!isSystemAdmin(decoded)) {
      return res.status(403).json({ ok: false, error: "Μη εξουσιοδοτημένη πρόσβαση διαχειριστή." });
    }
    const target = String(req.body?.target || "").trim();
    const db = admin.database();
    if (target === "parserErrors") {
      await db.ref().update({ "adminTelemetry/parserErrors": null });
      await recordAuditEvent(db, {
        action: "parser_errors_cleared",
        severity: "info",
        actorUid: decoded.uid,
        actorEmail: decoded.email || "",
        statusCode: 200,
        detail: "Εκκαθάριση ανώνυμων σφαλμάτων parser"
      });
      return res.status(200).json({ ok: true, cleared: "parserErrors" });
    }
    return res.status(400).json({ ok: false, error: "Μη έγκυρος στόχος εκκαθάρισης." });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ ok: false, error: err.message || "Internal error" });
  }
});

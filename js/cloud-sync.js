const SYNC_STATES = Object.freeze({
  IDLE: "idle",
  SYNCING: "syncing",
  SYNCED: "synced",
  PENDING: "pending",
  CONFLICT: "conflict",
  FAILED: "failed",
  LOCKED: "locked"
});

let lastSyncStateMeta = {
  state: "idle",
  conflicts: [],
  lastError: "",
  updatedAt: 0,
  authUid: ""
};

const _usedIvHexSet = new Set();

function setCloudSyncLifecycleState(nextState, extra = {}) {
  const valid = Object.values(SYNC_STATES);
  const normalized = valid.includes(nextState) ? nextState : "idle";
  cloudSyncStatus = normalized;
  lastSyncStateMeta = {
    ...lastSyncStateMeta,
    state: normalized,
    conflicts: Array.isArray(extra.conflicts) ? extra.conflicts : lastSyncStateMeta.conflicts,
    lastError: extra.lastError !== undefined ? String(extra.lastError || "") : lastSyncStateMeta.lastError,
    updatedAt: Date.now(),
    authUid: extra.authUid !== undefined ? String(extra.authUid || "") : lastSyncStateMeta.authUid
  };
  if (typeof updateBackupStatusUI === "function") {
    updateBackupStatusUI();
  }
}

function getCloudAuthContext() {
  const cfg = data.settings?.cloudSync || {};
  const token = String(cfg.authIdToken || cfg.firebaseIdToken || "").trim();
  const uid = String(cfg.authUid || cfg.firebaseUid || "").trim();
  return {
    authenticated: Boolean(token || uid),
    uid,
    token,
    role: String(cfg.membershipRole || "owner").toLowerCase()
  };
}

/* ==========================================================================
   3. LEGACY-COMPATIBLE AES-256-GCM & FIREBASE LIVE CLOUD SYNC
   ========================================================================== */
const cachedRoomKeyMap = new Map();

function bytesToBase64(bytes) {
  let bin = "";
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin);
}

function base64ToBytes(b64) {
  const clean = String(b64 || "").trim().replace(/-/g, "+").replace(/_/g, "/");
  const pad = clean.length % 4;
  const padded = pad ? clean + "=".repeat(4 - pad) : clean;
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodePacketBytes(val) {
  if (val instanceof Uint8Array) return val;
  if (Array.isArray(val)) return new Uint8Array(val);
  const s = String(val || "").trim();
  if (!s) return new Uint8Array(0);
  if (/^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0 && (s.length === 24 || s.length === 32)) {
    const out = new Uint8Array(s.length / 2);
    for (let i = 0; i < s.length; i += 2) out[i / 2] = parseInt(s.slice(i, i + 2), 16);
    return out;
  }
  return base64ToBytes(s);
}

async function sha256Hex(str) {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function getCryptoRecipes(roomCode, pin) {
  const rawCode = String(roomCode || "").trim();
  const cleanCode = rawCode.toUpperCase();
  const lowerCode = rawCode.toLowerCase();
  const noDashCode = cleanCode.replace(/[^A-Z0-9]/g, "");
  const cleanPin = String(pin || "").trim();

  const recipes = [
    { id: "orig_salt_v1_sha256", type: "pbkdf2_sha256_salt", pass: cleanPin, saltSeed: `FinanceGR-Salt-v1:${cleanCode}` },
    { id: "orig_salt_v1_sha256_raw", type: "pbkdf2_sha256_salt", pass: cleanPin, saltSeed: `FinanceGR-Salt-v1:${rawCode}` },
    { id: "orig_salt_v1_sha256_lower", type: "pbkdf2_sha256_salt", pass: cleanPin, saltSeed: `FinanceGR-Salt-v1:${lowerCode}` },
    { id: "orig_salt_v1_sha256_nodash", type: "pbkdf2_sha256_salt", pass: cleanPin, saltSeed: `FinanceGR-Salt-v1:${noDashCode}` },
    { id: "pin_salt_prefix_code", type: "pbkdf2", pass: cleanPin, salt: `financegr-salt:${cleanCode}` },
    { id: "pin_salt_prefix_raw", type: "pbkdf2", pass: cleanPin, salt: `financegr-salt:${rawCode}` },
    { id: "pin_salt_code", type: "pbkdf2", pass: cleanPin, salt: cleanCode },
    { id: "code_pin_salt_prefix", type: "pbkdf2", pass: `${cleanCode}:${cleanPin}`, salt: "financegr-sync-salt" },
    { id: "sha256_code_pin", type: "sha256_raw", seed: `${cleanCode}:${cleanPin}` },
    { id: "sha256_orig_room", type: "sha256_raw", seed: `FinanceGR-Room-v1:${cleanCode}:${cleanPin}` }
  ];

  const preferredId = data.settings?.cloudSync?.resolvedRecipeId;
  if (preferredId) {
    const idx = recipes.findIndex(r => r.id === preferredId);
    if (idx > 0) {
      const [match] = recipes.splice(idx, 1);
      recipes.unshift(match);
    }
  }
  return recipes;
}

async function deriveKeyForRecipe(recipe) {
  const cacheId = [
    recipe.id || recipe.type,
    recipe.pass || recipe.seed || "",
    recipe.salt || recipe.saltSeed || "",
    recipe.saltBytes ? bytesToBase64(recipe.saltBytes) : "",
    recipe.iterations || ""
  ].join("|");
  if (cachedRoomKeyMap.has(cacheId)) {
    return cachedRoomKeyMap.get(cacheId);
  }

  const enc = new TextEncoder();
  let derived;
  if (recipe.type === "sha256_raw") {
    const hashBuf = await crypto.subtle.digest("SHA-256", enc.encode(recipe.seed));
    derived = await crypto.subtle.importKey(
      "raw",
      hashBuf,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  } else if (recipe.type === "pbkdf2_sha256_salt") {
    const saltDigest = await crypto.subtle.digest("SHA-256", enc.encode(recipe.saltSeed));
    const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(recipe.pass), "PBKDF2", false, ["deriveKey"]);
    derived = await crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: saltDigest,
        iterations: 100000,
        hash: "SHA-256"
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  } else {
    const baseKey = await crypto.subtle.importKey(
      "raw",
      enc.encode(recipe.pass),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    const saltBytes = recipe.saltBytes || enc.encode(recipe.salt || "");
    derived = await crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: saltBytes,
        iterations: recipe.iterations || 100000,
        hash: "SHA-256"
      },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  cachedRoomKeyMap.set(cacheId, derived);
  return derived;
}

async function getRoomHash(roomCode, pin) {
  const normRoom = String(roomCode || "").trim().toUpperCase();
  const normPin = String(pin || "").trim();
  return sha256Hex(`FinanceGR-Room-v1:${normRoom}:${normPin}`);
}

async function getCandidateRoomPaths(roomCode, pin) {
  const cleanCode = String(roomCode || "").trim().toUpperCase();
  const rawCode = String(roomCode || "").trim();
  const lowerCode = rawCode.toLowerCase();
  const noDashCode = cleanCode.replace(/[^A-Z0-9]/g, "");
  const cleanPin = String(pin || "").trim();
  const cached = data.settings?.cloudSync?.resolvedRoomPath;

  const seeds = [
    `FinanceGR-Room-v1:${cleanCode}:${cleanPin}`,
    `FinanceGR-Room-v1:${rawCode}:${cleanPin}`,
    `FinanceGR-Room-v1:${noDashCode}:${cleanPin}`,
    `${cleanCode}:${cleanPin}`,
    `${cleanCode}::${cleanPin}`,
    `${cleanCode}|${cleanPin}`,
    `${cleanCode}-${cleanPin}`,
    `${cleanCode}_${cleanPin}`,
    `financegr-room:${cleanCode}:${cleanPin}`,
    `financegr:${cleanCode}:${cleanPin}`,
    cleanCode,
    `${noDashCode}:${cleanPin}`,
    `${lowerCode}:${cleanPin}`
  ];

  const hashes = await Promise.all(seeds.map(s => sha256Hex(s)));
  const unique = [];
  if (cached) unique.push(cached);
  for (const h of hashes) {
    if (!unique.includes(h)) unique.push(h);
  }
  return unique;
}

function isEncryptedPacket(obj) {
  if (!obj || typeof obj !== "object") return false;
  const ivVal = obj.iv || obj.nonce;
  const ctVal = obj.ct || obj.ciphertext || obj.data || obj.payload;
  return Boolean(ivVal && ctVal);
}

async function encryptRoomPayload(payloadObj, roomCode, pin) {
  const recipes = getCryptoRecipes(roomCode, pin);
  const key = await deriveKeyForRecipe(recipes[0]);
  let iv = crypto.getRandomValues(new Uint8Array(12));
  let ivHex = Array.from(iv).map(b => b.toString(16).padStart(2, "0")).join("");
  if (_usedIvHexSet.has(ivHex)) {
    iv = crypto.getRandomValues(new Uint8Array(12));
    ivHex = Array.from(iv).map(b => b.toString(16).padStart(2, "0")).join("");
  }
  _usedIvHexSet.add(ivHex);
  if (_usedIvHexSet.size > 4096) {
    _usedIvHexSet.clear();
  }
  const enc = new TextEncoder();
  const cipherBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(JSON.stringify(payloadObj))
  );
  return {
    v: 2,
    alg: "AES-256-GCM",
    iv: bytesToBase64(iv),
    ct: bytesToBase64(new Uint8Array(cipherBuf))
  };
}

async function decryptRoomPayload(packet, roomCode, pin) {
  const ivRaw = packet.iv || packet.nonce;
  const ctRaw = packet.ct || packet.ciphertext || packet.data || packet.payload;
  const ivBytes = decodePacketBytes(ivRaw);
  const ctBytes = decodePacketBytes(ctRaw);
  const dec = new TextDecoder();

  const recipes = getCryptoRecipes(roomCode, pin);
  if (packet.salt || packet.s) {
    recipes.unshift({
      id: "packet_salt",
      type: "pbkdf2",
      pass: String(pin || "").trim(),
      saltBytes: decodePacketBytes(packet.salt || packet.s)
    });
  }

  for (const recipe of recipes) {
    try {
      const key = await deriveKeyForRecipe(recipe);
      const plainBuf = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: ivBytes },
        key,
        ctBytes
      );
      const parsed = JSON.parse(dec.decode(plainBuf));
      if (data.settings?.cloudSync && recipe.id !== "packet_salt") {
        data.settings.cloudSync.resolvedRecipeId = recipe.id;
      }
      return parsed;
    } catch {
      // Try next recipe
    }
  }
  throw new Error("DECRYPT_FAILED");
}

let generatedSyncRoomCode = "";

async function getRoomMarkerPath(roomCode) {
  return sha256Hex(`FinanceGR-RoomId-v2:${String(roomCode || "").trim().toUpperCase()}`);
}

async function roomMarkerExists(roomCode) {
  try {
    const res = await fetch(`${FIREBASE_RTDB_URL}/rooms/${await getRoomMarkerPath(roomCode)}.json`);
    if (!res.ok) return null;
    const v = await res.json();
    return Boolean(v && typeof v === "object");
  } catch {
    return null;
  }
}

async function registerRoomMarker(roomCode) {
  try {
    await fetch(`${FIREBASE_RTDB_URL}/rooms/${await getRoomMarkerPath(roomCode)}.json`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ marker: 1, v: 2, createdAt: Date.now() })
    });
  } catch {
    // Best effort
  }
}

function generateNewSyncRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const part = () => {
    const a = new Uint32Array(4);
    crypto.getRandomValues(a);
    return Array.from(a, v => chars[v % chars.length]).join("");
  };
  const inp = document.getElementById("syncRoomCodeInput");
  const code = `FG-${part()}-${part()}`;
  if (inp) inp.value = code;
  generatedSyncRoomCode = code;
}

function updateSyncPinStrengthHint() {
  const pin = (document.getElementById("syncRoomPinInput")?.value || "").trim();
  const hint = document.getElementById("syncPinStrengthHint");
  if (!hint) return;
  if (!pin) {
    hint.textContent = "";
    return;
  }
  const weakList = ["1234", "0000", "1111", "12345", "123456", "password", "qwerty"];
  if (pin.length < 6) {
    hint.style.color = "var(--danger)";
    hint.textContent = "❌ Πολύ σύντομο (απαιτούνται τουλάχιστον 6 χαρακτήρες)";
  } else if (weakList.includes(pin.toLowerCase()) || pin.length < 8) {
    hint.style.color = "var(--warn)";
    hint.textContent = "⚠️ Μέτριο PIN — προτείνονται 8+ τυχαία ψηφία/χαρακτήρες για μέγιστη ασφάλεια";
  } else {
    hint.style.color = "var(--accent)";
    hint.textContent = "🛡️ Ισχυρό PIN κρυπτογράφησης AES-256";
  }
}

function toggleSyncPinVisibility(inputId, btn) {
  const inp = document.getElementById(inputId);
  if (!inp) return;
  const isPass = inp.type === "password";
  inp.type = isPass ? "text" : "password";
  if (btn) btn.textContent = isPass ? "🙈" : "👁️";
}

function onSyncModeSelectChange() {
  const mode = document.getElementById("syncRoomModeSelect")?.value || "solo";
  const wrap = document.getElementById("syncPrivacyScopeWrap");
  if (wrap) wrap.style.display = mode === "couple" ? "block" : "none";
}

function openCloudSyncModal() {
  const cfg = data.settings?.cloudSync || {};
  const discView = document.getElementById("cloudSyncDisconnectedView");
  const connView = document.getElementById("cloudSyncConnectedView");
  const activePin = getActiveCloudPin();

  if (cfg.enabled && cfg.roomCode) {
    if (discView) discView.style.display = "none";
    if (connView) connView.style.display = "block";
    const modeLabel = cfg.mode === "couple"
      ? `👫 Ζευγάρι (${cfg.privacyScope === "sharedOnly" ? "Μόνο Κοινά" : "Πλήρες Νοικοκυριό"})`
      : "👤 Προσωπικό (Laptop ↔ Κινητό)";
    setTextSafe("connectedRoomInfoText", `Δωμάτιο: ${cfg.roomCode} • ${modeLabel}`);
    const lastStr = cfg.lastSyncedAt ? new Date(cfg.lastSyncedAt).toLocaleTimeString("el-GR") : "Μόλις τώρα";
    const pendingTag = cfg.pendingPush ? " • ⏳ Εκκρεμεί αποστολή αλλαγών" : "";
    setTextSafe("connectedRoomStatusDetail", `Συναλλαγές: ${data.transactions.length} • Τελευταίος συγχρονισμός: ${lastStr}${pendingTag}`);

    const lockedBox = document.getElementById("sessionLockedPinBox");
    const pinGroup = document.getElementById("connectedPinGroup");
    if (cfg.sessionOnlyPin && !activePin) {
      if (lockedBox) lockedBox.style.display = "block";
      if (pinGroup) pinGroup.style.display = "none";
    } else {
      if (lockedBox) lockedBox.style.display = "none";
      if (pinGroup) pinGroup.style.display = "block";
      const pinDisp = document.getElementById("connectedRoomPinDisplay");
      if (pinDisp) {
        pinDisp.value = activePin;
        pinDisp.type = "password";
      }
    }
    if (typeof updateFirebaseAuthUI === "function") {
      updateFirebaseAuthUI();
    }
  } else {
    if (discView) discView.style.display = "block";
    if (connView) connView.style.display = "none";
    const codeInp = document.getElementById("syncRoomCodeInput");
    if (codeInp && !codeInp.value) generateNewSyncRoomCode();
    updateSyncPinStrengthHint();
    onSyncModeSelectChange();
  }

  document.getElementById("cloudSyncModal").style.display = "flex";
}

function closeCloudSyncModal() {
  document.getElementById("cloudSyncModal").style.display = "none";
}

async function unlockSessionCloudPin() {
  const pin = (document.getElementById("unlockSessionPinInput")?.value || "").trim();
  if (pin.length < 4) {
    showModal("Εισήγαγε το PIN του δωματίου.");
    return;
  }
  data.settings.cloudSync.pin = pin;
  data.settings.cloudSync.roomPin = pin;
  try {
    sessionStorage.setItem(SESSION_PIN_KEY, pin);
  } catch {
    // Ignore
  }
  const outcome = await pullCloudSyncNow(false);
  if (outcome === "decrypt_error") {
    data.settings.cloudSync.pin = "";
    data.settings.cloudSync.roomPin = "";
    try { sessionStorage.removeItem(SESSION_PIN_KEY); } catch {}
    showModal("Το PIN που πληκτρολόγησες δεν μπόρεσε να ξεκλειδώσει το δωμάτιο.", false, null, "Λάθος PIN");
    return;
  }
  if (data.settings.cloudSync.pendingPush) {
    await pushCloudSyncNow(true);
  }
  openCloudSyncModal();
  render();
  showToast("🔓 Το δωμάτιο ξεκλειδώθηκε!");
}

async function connectCloudSyncRoom(forceCreateNew = false) {
  if (!window.crypto || !window.crypto.subtle) {
    showModal("Ο συγχρονισμός κρυπτογράφησης απαιτεί ασφαλή σύνδεση HTTPS. Άνοιξε την εφαρμογή από τον επίσημο σύνδεσμο https://thgoulis.github.io/FinanceGR/.");
    return;
  }

  const codeInp = document.getElementById("syncRoomCodeInput");
  const pinInp = document.getElementById("syncRoomPinInput");
  const modeSel = document.getElementById("syncRoomModeSelect");
  const scopeSel = document.getElementById("syncPrivacyScopeSelect");
  const sessionOnly = Boolean(document.getElementById("syncSessionOnlyPinToggle")?.checked);

  const rawRoomCode = (codeInp?.value || "")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\s+/g, "")
    .trim();
  const roomCode = rawRoomCode.toUpperCase();
  const pin = (pinInp?.value || "").trim();
  const mode = modeSel?.value || "solo";
  const privacyScope = scopeSel?.value || "fullHousehold";

  if (codeInp && codeInp.value !== roomCode) {
    codeInp.value = roomCode;
  }

  if (roomCode.length < 4) {
    showModal("Πληκτρολόγησε έναν έγκυρο Κωδικό Δωματίου (τουλάχιστον 4 χαρακτήρες) ή πάτησε «🎲 Νέος».");
    return;
  }
  if (pin.length < 6) {
    showModal("Το PIN κρυπτογράφησης πρέπει να έχει τουλάχιστον 6 χαρακτήρες.");
    return;
  }

  const authConfigured = typeof isFirebaseAuthConfigured === "function" && isFirebaseAuthConfigured();
  const fbUser = typeof getCurrentFirebaseUser === "function" ? getCurrentFirebaseUser() : null;
  if (authConfigured && !fbUser) {
    showModal("Συνδέσου πρώτα με Google ή Email/Κωδικό στο επάνω μέρος του παραθύρου πριν συνδέσεις δωμάτιο Cloud Sync.");
    return;
  }

  const prevCfg = deepClone(data.settings.cloudSync || {});
  const useAuthMode = Boolean(authConfigured && fbUser);

  data.settings.cloudSync = {
    enabled: true,
    roomCode,
    rawRoomCode: roomCode,
    pin,
    roomPin: pin,
    sessionOnlyPin: sessionOnly,
    mode,
    privacyScope,
    authMode: useAuthMode ? "firebase_auth" : "legacy",
    authUid: fbUser ? fbUser.uid : "",
    authEmail: fbUser ? (fbUser.email || "") : "",
    membershipRole: "owner",
    resolvedRoomPath: useAuthMode ? roomCode : "",
    resolvedRecipeId: "orig_salt_v1_sha256",
    resolvedSaltPrefix: "",
    lastSyncedAt: 0,
    pendingPush: false
  };

  if (sessionOnly) {
    try { sessionStorage.setItem(SESSION_PIN_KEY, pin); } catch {}
  }

  const abortConnect = (msg, title = "Cloud Sync") => {
    data.settings.cloudSync = prevCfg;
    persist(true, true);
    showModal(msg, false, null, title);
  };

  if (useAuthMode) {
    showToast("🔐 Επαλήθευση δωματίου μέσω Firebase Auth...");
    let pullOutcome = await pullCloudSyncNow(false);

    if (pullOutcome === "decrypt_error") {
      abortConnect("Το δωμάτιο βρέθηκε, αλλά το PIN κρυπτογράφησης δεν είναι σωστό.", "Λάθος PIN");
      return;
    }

    if (pullOutcome === "not_found" || pullOutcome === "permission_denied") {
      if (!forceCreateNew) {
        data.settings.cloudSync = prevCfg;
        persist(true, true);
        showModal(
          `Θα δημιουργηθεί νέο προστατευμένο δωμάτιο «${roomCode}» με Owner τον λογαριασμό σου (${fbUser.email || fbUser.uid}).\n\n⚠️ Το PIN κρυπτογράφησης (AES-256) δεν αποθηκεύεται στο Firebase και δεν μπορεί να γίνει reset.\n\nΠάτησε «Εντάξει» για δημιουργία.`,
          true,
          (ok) => { if (ok) connectCloudSyncRoom(true); },
          "Νέο Ασφαλές Δωμάτιο Cloud"
        );
        return;
      }

      try {
        const created = await callFinanceGrCloudFunction("createRoom", { roomId: roomCode });
        data.settings.cloudSync.membershipRole = created.role || "owner";
        data.settings.cloudSync.resolvedRoomPath = roomCode;
        if (created.alreadyMember) {
          pullOutcome = await pullCloudSyncNow(false);
          if (pullOutcome === "decrypt_error") {
            abortConnect("Είσαι ήδη μέλος στο δωμάτιο, αλλά το PIN δεν ταιριάζει.", "Λάθος PIN");
            return;
          }
        }
      } catch (err) {
        abortConnect(`Αποτυχία δημιουργίας/πρόσβασης δωματίου: ${err?.message || "Σφάλμα Cloud Function"}`, "Firebase Auth / Room");
        return;
      }
    } else if (pullOutcome !== "synced") {
      abortConnect("Δεν ήταν δυνατή η επικοινωνία με το Firebase Cloud. Έλεγξε τη σύνδεσή σου.");
      return;
    }

    fullSyncNeeded = true;
    const pushedOk = await pushCloudSyncNow(true);
    if (!pushedOk) {
      abortConnect("Το δωμάτιο συνδέθηκε, αλλά απέτυχε η αποστολή δεδομένων. Έλεγξε τα δικαιώματα (Owner/Editor) και τους κανόνες Firebase.");
      return;
    }
    persist(true, true);
    openCloudSyncModal();
    if (typeof updateFirebaseAuthUI === "function") updateFirebaseAuthUI();
    render();
    if (typeof trackZeroKnowledgeEvent === "function") trackZeroKnowledgeEvent("cloud_sync_connected");
    showToast("✅ Ασφαλής συγχρονισμός Cloud (Firebase Auth + AES-256) ενεργοποιήθηκε!");
    return;
  }

  showToast("🔄 Αναζήτηση & συγχρονισμός δωματίου...");
  const pullOutcome = await pullCloudSyncNow(false);

  if (pullOutcome === "decrypt_error") {
    abortConnect("Το δωμάτιο βρέθηκε στο cloud, αλλά το PIN που εισήγαγες δεν μπόρεσε να αποκρυπτογραφήσει τα δεδομένα. Έλεγξε το PIN και προσπάθησε ξανά.", "Λάθος PIN");
    return;
  }

  if (pullOutcome !== "synced" && pullOutcome !== "not_found") {
    abortConnect("Δεν ήταν δυνατή η επικοινωνία με το Cloud. Έλεγξε τη σύνδεσή σου και δοκίμασε ξανά.");
    return;
  }

  if (pullOutcome === "not_found") {
    const exists = await roomMarkerExists(roomCode);
    if (exists === null) {
      abortConnect("Δεν μπόρεσα να επαληθεύσω αν ο κωδικός δωματίου υπάρχει ήδη. Έλεγξε τη σύνδεσή σου και δοκίμασε ξανά.");
      return;
    }
    if (exists) {
      abortConnect(
        "Το δωμάτιο με αυτόν τον κωδικό υπάρχει, αλλά το PIN δεν είναι σωστό. Το PIN δεν μπορεί να αλλάξει ή να γίνει reset και δεν δημιουργείται νέο δωμάτιο.",
        "Λάθος PIN"
      );
      return;
    }
    if (generatedSyncRoomCode !== roomCode) {
      abortConnect(
        `Δεν βρέθηκε δωμάτιο με κωδικό «${roomCode}» και αυτό το PIN. Έλεγξε τον κωδικό και το PIN. Νέα δωμάτια δημιουργούνται μόνο με το κουμπί «🎲 Νέος».`,
        "Δεν βρέθηκε δωμάτιο"
      );
      return;
    }
    if (!forceCreateNew) {
      data.settings.cloudSync = prevCfg;
      persist(true, true);
      showModal(
        `Θα δημιουργηθεί νέο δωμάτιο «${roomCode}».\n\n⚠️ Το PIN δεν μπορεί να ανακτηθεί, να αλλάξει ή να γίνει reset από κανέναν. Αν το χάσεις, το δωμάτιο και τα δεδομένα του χάνονται.\n\nΠάτησε «Εντάξει» για δημιουργία.`,
        true,
        (ok) => { if (ok) connectCloudSyncRoom(true); },
        "Νέο Δωμάτιο Cloud"
      );
      return;
    }
  }

  if (pullOutcome === "synced" && (await roomMarkerExists(roomCode)) === false) {
    await registerRoomMarker(roomCode);
  }

  fullSyncNeeded = true;
  const pushedOk = await pushCloudSyncNow(true);
  if (pushedOk && pullOutcome === "not_found") {
    await registerRoomMarker(roomCode);
  }
  persist(true, true);
  openCloudSyncModal();
  render();
  showToast(pullOutcome === "synced" ? "✅ Τα δεδομένα συγχρονίστηκαν με το Cloud!" : "✅ Το δωμάτιο συγχρονισμού συνδέθηκε!");
}

function disconnectCloudSyncRoom() {
  showModal("Αποσύνδεση από το Cloud Sync Room; Τα τοπικά σου δεδομένα θα παραμείνουν στη συσκευή.", true, (ok) => {
    if (!ok) return;
    data.settings.cloudSync.enabled = false;
    data.settings.cloudSync.resolvedRoomPath = "";
    data.settings.cloudSync.sessionOnlyPin = false;
    data.settings.cloudSync.pendingPush = false;
    dirtyTxIds.clear();
    fullSyncNeeded = false;
    try { sessionStorage.removeItem(SESSION_PIN_KEY); } catch {}
    cloudSyncStatus = "idle";
    persist(true, true);
    openCloudSyncModal();
    showToast("Αποσυνδέθηκες από το Cloud Sync.");
  }, "Αποσύνδεση Cloud");
}

async function manualSyncNow() {
  showToast("🔄 Πλήρης συγχρονισμός σε εξέλιξη...");
  const res = await pullCloudSyncNow(false);
  if (res === "decrypt_error") {
    showModal("Αδυναμία αποκρυπτογράφησης με το αποθηκευμένο PIN.");
    return;
  }
  fullSyncNeeded = true;
  await pushCloudSyncNow(true);
  openCloudSyncModal();
  render();
  showToast("✅ Ο συγχρονισμός ολοκληρώθηκε!");
}

function mergeEntitiesById(localArr, remoteArr, deletedMap, preferRemote, conflictCollector = null) {
  const del = deletedMap || {};
  const map = new Map();
  const byIdLocal = new Map();
  const byIdRemote = new Map();
  (Array.isArray(localArr) ? localArr : []).forEach(item => {
    if (item && item.id && !del[item.id]) byIdLocal.set(item.id, item);
  });
  (Array.isArray(remoteArr) ? remoteArr : []).forEach(item => {
    if (item && item.id && !del[item.id]) byIdRemote.set(item.id, item);
  });

  const allIds = new Set([...byIdLocal.keys(), ...byIdRemote.keys()]);
  for (const id of allIds) {
    const loc = byIdLocal.get(id);
    const rem = byIdRemote.get(id);
    if (loc && !rem) {
      map.set(id, loc);
      continue;
    }
    if (rem && !loc) {
      map.set(id, rem);
      continue;
    }
    const lTs = Number(loc._updatedAt || loc.updatedAt || 0);
    const rTs = Number(rem._updatedAt || rem.updatedAt || 0);
    const lVer = Number(loc.version || 1);
    const rVer = Number(rem.version || 1);
    const sameContent = JSON.stringify(loc) === JSON.stringify(rem);
    if (!sameContent && lTs > 0 && rTs > 0 && Math.abs(rTs - lTs) < 2000 && lVer === rVer) {
      if (Array.isArray(conflictCollector)) {
        conflictCollector.push({
          id,
          localTs: lTs,
          remoteTs: rTs,
          version: rVer,
          resolution: (rTs > lTs || preferRemote) ? "remote_won" : "local_kept"
        });
      }
    }
    if (rTs > lTs) {
      map.set(id, rem);
    } else if (lTs > rTs) {
      map.set(id, loc);
    } else {
      map.set(id, preferRemote ? rem : loc);
    }
  }
  return Array.from(map.values());
}

async function applyRemoteRoomSnapshot(remoteRoom, matchedPath) {
  if (!remoteRoom || typeof remoteRoom !== "object") return "not_found";
  const cfg = data.settings.cloudSync;
  const activePin = getActiveCloudPin();
  const myDeviceId = data.settings.deviceId;
  const isCouple = cfg.mode === "couple";
  let changed = false;
  let decryptedCount = 0;
  let decryptErrors = 0;

  const currentFbUser = typeof getCurrentFirebaseUser === "function" ? getCurrentFirebaseUser() : null;
  if (remoteRoom.members && typeof remoteRoom.members === "object") {
    cfg.roomMembers = remoteRoom.members;
    if (currentFbUser && remoteRoom.members[currentFbUser.uid]?.role) {
      cfg.membershipRole = String(remoteRoom.members[currentFbUser.uid].role).toLowerCase();
    }
  }

  const encryptedProfilesMap = (remoteRoom.deviceProfiles && typeof remoteRoom.deviceProfiles === "object")
    ? remoteRoom.deviceProfiles
    : (remoteRoom.members && typeof remoteRoom.members === "object" ? remoteRoom.members : null);

  if (encryptedProfilesMap) {
    const myNameNorm = (data.profile.userName || "Εγώ").trim().toLowerCase();
    for (const [devId, env] of Object.entries(encryptedProfilesMap)) {
      if (!isEncryptedPacket(env)) continue;
      try {
        const memberInfo = await decryptRoomPayload(env, cfg.roomCode, activePin);
        if (memberInfo && typeof memberInfo === "object") {
          decryptedCount++;
          if (isCouple && devId !== myDeviceId) {
            const mNameNorm = String(memberInfo.name || "").trim().toLowerCase();
            const isMyOwnSecondDevice = myNameNorm && myNameNorm !== "εγώ" && myNameNorm !== "εσύ" && mNameNorm === myNameNorm;
            if (!isMyOwnSecondDevice) {
              if (memberInfo.name && memberInfo.name !== "Εσύ" && memberInfo.name !== "Εγώ" && data.profile.partnerName !== memberInfo.name) {
                data.profile.partnerName = String(memberInfo.name).slice(0, 60);
                changed = true;
              }
              if (Number(memberInfo.income) > 0 && Number(data.profile.partnerIncome) !== Number(memberInfo.income)) {
                data.profile.partnerIncome = Math.min(1e9, Number(memberInfo.income));
                changed = true;
              }
            }
          }
        }
      } catch {
        decryptErrors++;
      }
    }
  }

  const statePacket = remoteRoom.sharedState || remoteRoom.state || remoteRoom.payload || (isEncryptedPacket(remoteRoom) ? remoteRoom : null);
  if (statePacket && isEncryptedPacket(statePacket)) {
    try {
      const remoteState = await decryptRoomPayload(statePacket, cfg.roomCode, activePin);
      if (remoteState && typeof remoteState === "object") {
        decryptedCount++;
        const remoteTs = Number(remoteState.stateUpdatedAt || remoteState.updatedAt) || 0;
        const localTs = Number(data.settings.stateUpdatedAt) || 0;
        const isFirstLoad = data.transactions.length === 0 && !data.profile.userName && Number(data.profile.monthlyIncome) === 0;
        const preferRemote = remoteTs >= localTs || isFirstLoad;

        if (remoteState.deletedTxIds && typeof remoteState.deletedTxIds === "object") {
          data.deletedTxIds = { ...data.deletedTxIds, ...cleanTsMap(remoteState.deletedTxIds) };
        }
        if (remoteState.deletedEntityIds && typeof remoteState.deletedEntityIds === "object") {
          data.deletedEntityIds = { ...data.deletedEntityIds, ...cleanTsMap(remoteState.deletedEntityIds) };
        }
        const delEntities = data.deletedEntityIds || {};

        if (remoteTs > localTs || isFirstLoad) {
          if (remoteState.profile && typeof remoteState.profile === "object") {
            const isSamePerson = !isCouple || !remoteState.deviceId || remoteState.deviceId === myDeviceId ||
              ((remoteState.profile.userName || "").trim().toLowerCase() === (data.profile.userName || "").trim().toLowerCase());
            if (isSamePerson) {
              data.profile = { ...data.profile, ...cleanProfile(remoteState.profile) };
            } else if (remoteState.profile.userName && !data.profile.partnerName) {
              data.profile.partnerName = remoteState.profile.userName;
              data.profile.partnerIncome = Number(remoteState.profile.monthlyIncome) || data.profile.partnerIncome;
            }
          }
          if (remoteState.budgets && typeof remoteState.budgets === "object") {
            data.budgets = { ...data.budgets, ...cleanBudgets(remoteState.budgets) };
          }
          if (remoteState.sharedBudgets && typeof remoteState.sharedBudgets === "object") {
            if (!data.budgetsByView || typeof data.budgetsByView !== "object") {
              data.budgetsByView = { me: {}, partner: {}, shared: {} };
            }
            data.budgetsByView.shared = { ...(data.budgetsByView.shared || {}), ...cleanBudgets(remoteState.sharedBudgets) };
          }
          if (remoteState.merchantRules && typeof remoteState.merchantRules === "object") {
            data.merchantRules = cleanRules(remoteState.merchantRules);
          }
          if (Array.isArray(remoteState.ignoredSubscriptions)) {
            const mergedIgnored = { ...(data.ignoredSubscriptions || {}) };
            remoteState.ignoredSubscriptions.forEach(k => { if (k) mergedIgnored[k] = true; });
            data.ignoredSubscriptions = mergedIgnored;
          } else if (remoteState.ignoredSubscriptions && typeof remoteState.ignoredSubscriptions === "object") {
            data.ignoredSubscriptions = { ...data.ignoredSubscriptions, ...remoteState.ignoredSubscriptions };
          }
          data.settings.stateUpdatedAt = Math.max(localTs, remoteTs, 1);
          changed = true;
        }

        if (Array.isArray(remoteState.recurring)) {
          const prevLen = data.recurring.length;
          data.recurring = mergeEntitiesById(data.recurring, cleanList(remoteState.recurring, cleanRecurring), delEntities, preferRemote);
          if (data.recurring.length !== prevLen || preferRemote) changed = true;
        }
        if (Array.isArray(remoteState.goals)) {
          const prevLen = data.goals.length;
          data.goals = mergeEntitiesById(data.goals, cleanList(remoteState.goals, cleanGoal), delEntities, preferRemote);
          if (data.goals.length !== prevLen || preferRemote) changed = true;
        }
        if (Array.isArray(remoteState.annualBills)) {
          const prevLen = data.annualBills.length;
          data.annualBills = mergeEntitiesById(data.annualBills, cleanList(remoteState.annualBills, cleanBill), delEntities, preferRemote);
          if (data.annualBills.length !== prevLen || preferRemote) changed = true;
        }
        if (Array.isArray(remoteState.portfolioAssets)) {
          const prevLen = data.portfolioAssets.length;
          data.portfolioAssets = mergeEntitiesById(data.portfolioAssets, cleanList(remoteState.portfolioAssets, cleanAsset), delEntities, preferRemote);
          if (data.portfolioAssets.length !== prevLen || preferRemote) changed = true;
        }
        if (Array.isArray(remoteState.liabilities)) {
          const prevLen = (data.liabilities || []).length;
          data.liabilities = mergeEntitiesById(data.liabilities || [], cleanList(remoteState.liabilities, cleanLiability), delEntities, preferRemote);
          if (data.liabilities.length !== prevLen || preferRemote) changed = true;
        }
        if (Array.isArray(remoteState.transactions) && !remoteRoom.txs && !remoteRoom.transactions) {
          data.transactions = remoteState.transactions.map(t => sanitizeRemoteTx(sanitizeJsonObject(t))).filter(t => t && !data.deletedTxIds[t.id]);
          changed = true;
        }
      }
    } catch {
      decryptErrors++;
    }
  }

  const rawTxMap = {
    ...(remoteRoom.txs && typeof remoteRoom.txs === "object" ? remoteRoom.txs : {}),
    ...(remoteRoom.transactions && typeof remoteRoom.transactions === "object" ? remoteRoom.transactions : {}),
    ...(remoteRoom.items && typeof remoteRoom.items === "object" ? remoteRoom.items : {})
  };

  if (Object.keys(rawTxMap).length > 0) {
    const localMap = new Map((data.transactions || []).map(t => [t.id, t]));
    const myNameNorm = (data.profile.userName || "Εγώ").trim().toLowerCase();

    for (const [txKey, packet] of Object.entries(rawTxMap)) {
      if (!packet) continue;
      let tx = null;
      if (isEncryptedPacket(packet)) {
        try {
          tx = await decryptRoomPayload(packet, cfg.roomCode, activePin);
          if (tx) decryptedCount++;
        } catch {
          decryptErrors++;
          continue;
        }
      }

      if (!tx || typeof tx !== "object") continue;
      tx = sanitizeJsonObject(tx);
      if (!tx.id && txKey) tx.id = txKey;
      if (!tx.id) continue;
      tx.id = String(tx.id).slice(0, 80);

      if (tx._deleted) {
        data.deletedTxIds = data.deletedTxIds || {};
        data.deletedTxIds[tx.id] = Number(tx._updatedAt) || Date.now();
        if (localMap.has(tx.id)) {
          localMap.delete(tx.id);
          changed = true;
        }
        continue;
      }

      tx = sanitizeRemoteTx(tx);
      if (!tx) continue;
      if (data.deletedTxIds?.[tx.id]) continue;

      const txDevice = tx._originDeviceId || tx._lastModifiedByDevice || tx.deviceId || tx.modifiedBy || tx.createdByDevice;
      const rNameNorm = String(tx._originName || "").trim().toLowerCase();
      const isSameUserSecondDevice = myNameNorm && myNameNorm !== "εγώ" && myNameNorm !== "εσύ" && rNameNorm === myNameNorm;
      const isFromMe = !isCouple || !txDevice || txDevice === myDeviceId || isSameUserSecondDevice;
      const isRemoteOwner = isCouple && !isFromMe;

      if (isCouple && cfg.privacyScope === "sharedOnly" && isRemoteOwner && !tx.isShared) {
        const existingLocal = localMap.get(tx.id);
        if (existingLocal && existingLocal.owner === "partner") {
          localMap.delete(tx.id);
          changed = true;
        }
        continue;
      }

      const existing = localMap.get(tx.id);
      const remoteTxTs = Number(tx._updatedAt) || 0;
      const localTxTs = Number(existing?._updatedAt) || 0;

      if (!existing || remoteTxTs > localTxTs) {
        if (tx._settlementPatch && existing) {
          existing.settled = Boolean(tx.settled);
          existing._updatedAt = remoteTxTs;
          changed = true;
          continue;
        }

        const mergedTx = { ...tx };
        delete mergedTx._settlementPatch;
        if (isRemoteOwner) {
          mergedTx.owner = "partner";
          if (mergedTx.paidBy === "me") mergedTx.paidBy = "partner";
          else if (mergedTx.paidBy === "partner") mergedTx.paidBy = "me";
        } else {
          mergedTx.owner = "me";
        }
        localMap.set(tx.id, mergedTx);
        changed = true;
      }
    }

    for (const delId of Object.keys(data.deletedTxIds || {})) {
      if (localMap.has(delId)) {
        localMap.delete(delId);
        changed = true;
      }
    }

    data.transactions = Array.from(localMap.values());
  }

  if (decryptedCount === 0 && decryptErrors > 0) {
    return "decrypt_error";
  }

  cfg.resolvedRoomPath = matchedPath;
  cfg.lastSyncedAt = Date.now();

  if (changed) {
    const activeMonthInp = document.getElementById("activeMonth");
    if (activeMonthInp && data.transactions.length > 0) {
      const curM = activeMonthInp.value || currentYearMonth();
      const hasCurMonthTxs = data.transactions.some(t => (t.date || "").startsWith(curM));
      if (!hasCurMonthTxs) {
        const sortedDates = data.transactions.map(t => t.date).filter(Boolean).sort();
        const latestDate = sortedDates[sortedDates.length - 1];
        if (latestDate && latestDate.length >= 7) {
          activeMonthInp.value = latestDate.slice(0, 7);
        }
      }
    }
    persist(true, true);
    render();
  }
  return "synced";
}

async function pullCloudSyncNow(silent = true) {
  const cfg = data.settings?.cloudSync;
  const activePin = getActiveCloudPin();
  if (!cfg?.enabled || !cfg.roomCode) return "disabled";
  if (!activePin) {
    cloudSyncStatus = "locked";
    updateBackupStatusUI();
    return "locked";
  }
  if (isCloudPullInFlight) return "busy";
  isCloudPullInFlight = true;

  if (!silent) {
    cloudSyncStatus = "syncing";
    updateBackupStatusUI();
  }

  try {
    const useAuthMode = cfg.authMode === "firebase_auth" || (typeof isFirebaseAuthConfigured === "function" && isFirebaseAuthConfigured() && Boolean(getCurrentFirebaseUser()));
    if (useAuthMode) {
      const idToken = await getFreshFirebaseIdToken(false);
      if (!idToken) {
        setCloudSyncLifecycleState("locked", { lastError: "Απαιτείται σύνδεση Firebase Auth" });
        return "locked";
      }
      const roomId = String(cfg.roomCode || "").trim().toUpperCase();
      const res = await fetch(`${FIREBASE_RTDB_URL}/rooms/${encodeURIComponent(roomId)}.json?auth=${encodeURIComponent(idToken)}`);
      if (res.status === 401 || res.status === 403) {
        setCloudSyncLifecycleState("failed", { lastError: "Δεν έχεις πρόσβαση σε αυτό το δωμάτιο" });
        return "permission_denied";
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const remoteRoom = await res.json();
      if (!remoteRoom || typeof remoteRoom !== "object") {
        setCloudSyncLifecycleState("synced");
        return "not_found";
      }
      const outcome = await applyRemoteRoomSnapshot(remoteRoom, roomId);
      if (outcome === "decrypt_error") {
        setCloudSyncLifecycleState("failed", { lastError: "Αποτυχία αποκρυπτογράφησης (λάθος PIN)" });
        return "decrypt_error";
      }
      cfg.authMode = "firebase_auth";
      setCloudSyncLifecycleState("synced", { lastError: "" });
      return "synced";
    }

    const candidatePaths = await getCandidateRoomPaths(cfg.roomCode, activePin);
    let sawDecryptError = false;

    for (const roomHash of candidatePaths) {
      const res = await fetch(`${FIREBASE_RTDB_URL}/rooms/${roomHash}.json`);
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          throw new Error("HTTP_PERMISSION_DENIED");
        }
        continue;
      }
      const remoteRoom = await res.json();
      if (!remoteRoom || typeof remoteRoom !== "object") continue;

      const outcome = await applyRemoteRoomSnapshot(remoteRoom, roomHash);
      if (outcome === "synced") {
        setCloudSyncLifecycleState("synced", { lastError: "" });
        return "synced";
      }
      if (outcome === "decrypt_error") {
        sawDecryptError = true;
      }
    }

    setCloudSyncLifecycleState(sawDecryptError ? "failed" : "synced");
    return sawDecryptError ? "decrypt_error" : "not_found";
  } catch (err) {
    console.error("Cloud pull error:", err);
    setCloudSyncLifecycleState("failed", { lastError: err?.message || "Cloud pull error" });
    return "error";
  } finally {
    isCloudPullInFlight = false;
  }
}

async function pushCloudSyncNow(forceFull = false) {
  const cfg = data.settings?.cloudSync;
  const activePin = getActiveCloudPin();
  if (!cfg?.enabled || !cfg.roomCode || !activePin) return false;

  if (isCloudPushInFlight) {
    queuedPushAfterCurrent = true;
    return false;
  }
  isCloudPushInFlight = true;

  cloudSyncStatus = "syncing";
  updateBackupStatusUI();

  const shouldPushFull = forceFull || fullSyncNeeded || !cfg.resolvedRoomPath;
  const batchDirtyIds = new Set(dirtyTxIds);
  dirtyTxIds.clear();
  fullSyncNeeded = false;

  try {
    const useAuthMode = cfg.authMode === "firebase_auth" || (typeof isFirebaseAuthConfigured === "function" && isFirebaseAuthConfigured() && Boolean(getCurrentFirebaseUser()));
    let authQuery = "";
    let roomPath = "";
    if (useAuthMode) {
      if ((cfg.membershipRole || "owner") === "viewer") {
        setCloudSyncLifecycleState("synced");
        return true;
      }
      const idToken = await getFreshFirebaseIdToken(false);
      if (!idToken) {
        setCloudSyncLifecycleState("locked", { lastError: "Απαιτείται σύνδεση Firebase Auth" });
        return false;
      }
      roomPath = encodeURIComponent(String(cfg.roomCode || "").trim().toUpperCase());
      authQuery = `?auth=${encodeURIComponent(idToken)}`;
    } else {
      roomPath = cfg.resolvedRoomPath || (await getRoomHash(cfg.roomCode, activePin));
    }

    const isCouple = cfg.mode === "couple";
    const isCoupleSharedOnly = isCouple && cfg.privacyScope === "sharedOnly";
    const myDeviceId = data.settings.deviceId;
    const myDisplayName = (data.profile.userName || "Εγώ").trim();
    const nowTs = Date.now();

    const patchBody = { updatedAt: nowTs };
    const profileKey = useAuthMode ? `deviceProfiles/${myDeviceId}` : `members/${myDeviceId}`;

    patchBody[profileKey] = await encryptRoomPayload({
      name: myDisplayName,
      income: Number(data.profile.monthlyIncome) || 0,
      updatedAt: nowTs
    }, cfg.roomCode, activePin);

    for (const tx of (data.transactions || [])) {
      if (!tx || !tx.id) continue;
      if (!shouldPushFull && !batchDirtyIds.has(tx.id) && !tx._settlementPatch) continue;
      if ((tx.owner || "me") !== "me" && !tx._settlementPatch) continue;
      if (isCoupleSharedOnly && !tx.isShared) {
        patchBody[`txs/${tx.id}`] = null;
        continue;
      }

      const outTx = {
        ...tx,
        _originDeviceId: myDeviceId,
        _originName: myDisplayName,
        _lastModifiedByDevice: myDeviceId,
        _updatedAt: Number(tx._updatedAt) || nowTs
      };
      patchBody[`txs/${tx.id}`] = await encryptRoomPayload(outTx, cfg.roomCode, activePin);
    }

    for (const [delId, delTs] of Object.entries(data.deletedTxIds || {})) {
      if (!shouldPushFull && !batchDirtyIds.has(delId)) continue;
      patchBody[`txs/${delId}`] = await encryptRoomPayload({
        id: delId,
        _deleted: true,
        _updatedAt: Number(delTs) || nowTs
      }, cfg.roomCode, activePin);
    }

    if (!isCoupleSharedOnly) {
      patchBody["sharedState"] = await encryptRoomPayload({
        profile: data.profile,
        budgets: data.budgets,
        sharedBudgets: data.budgetsByView?.shared || {},
        recurring: data.recurring || [],
        goals: data.goals || [],
        annualBills: data.annualBills || [],
        portfolioAssets: data.portfolioAssets || [],
        liabilities: data.liabilities || [],
        merchantRules: data.merchantRules || {},
        ignoredSubscriptions: Object.keys(data.ignoredSubscriptions || {}),
        deletedTxIds: data.deletedTxIds || {},
        deletedEntityIds: data.deletedEntityIds || {},
        stateUpdatedAt: Number(data.settings.stateUpdatedAt) || nowTs,
        updatedAt: Number(data.settings.stateUpdatedAt) || nowTs,
        deviceId: myDeviceId
      }, cfg.roomCode, activePin);
    } else {
      patchBody["sharedState"] = null;
    }

    const res = await fetch(`${FIREBASE_RTDB_URL}/rooms/${roomPath}.json${authQuery}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patchBody)
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    (data.transactions || []).forEach(tx => {
      if (tx && tx._settlementPatch) delete tx._settlementPatch;
    });

    cfg.resolvedRoomPath = useAuthMode ? String(cfg.roomCode || "").trim().toUpperCase() : roomPath;
    cfg.lastSyncedAt = nowTs;
    cfg.pendingPush = false;
    setCloudSyncLifecycleState("synced", { lastError: "" });
    persist(true, true);
    return true;
  } catch (err) {
    console.error("Cloud push error:", err);
    batchDirtyIds.forEach(id => dirtyTxIds.add(id));
    if (shouldPushFull) fullSyncNeeded = true;
    cfg.pendingPush = true;
    cloudSyncStatus = "error";
    updateBackupStatusUI();
    return false;
  } finally {
    isCloudPushInFlight = false;
    if (queuedPushAfterCurrent) {
      queuedPushAfterCurrent = false;
      pushCloudSyncNow();
    }
  }
}


/* ==========================================================================
   FIREBASE AUTHENTICATION, GOOGLE TICKER GUARD & ADMIN DASHBOARD
   ========================================================================== */
let _fbAuthInstance = null;
let _fbCurrentUser = null;

function isFirebaseAuthConfigured() {
  const cfg = window.FINANCEGR_FIREBASE_CONFIG;
  return Boolean(
    cfg &&
    cfg.apiKey &&
    !String(cfg.apiKey).startsWith("PASTE_") &&
    cfg.projectId &&
    typeof firebase !== "undefined" &&
    typeof firebase.auth === "function"
  );
}

function getCurrentFirebaseUser() {
  return _fbAuthInstance?.currentUser || _fbCurrentUser || null;
}

function isGoogleAccountSignedIn() {
  const user = getCurrentFirebaseUser();
  if (!user) return false;
  const providers = Array.isArray(user.providerData) ? user.providerData : [];
  return providers.some(p => p && p.providerId === "google.com");
}

function initFirebaseAuthIfConfigured() {
  if (!isFirebaseAuthConfigured()) {
    updateFirebaseAuthUI();
    return false;
  }
  try {
    if (!firebase.apps.length) {
      firebase.initializeApp(window.FINANCEGR_FIREBASE_CONFIG);
    }
    _fbAuthInstance = firebase.auth();
    if (typeof _fbAuthInstance.getRedirectResult === "function") {
      _fbAuthInstance.getRedirectResult().then((res) => {
        if (res && res.user) {
          _fbCurrentUser = res.user;
          updateFirebaseAuthUI();
          showToast("✅ Συνδέθηκες με Google!");
        }
      }).catch((err) => {
        if (err && err.code && err.code !== "auth/no-auth-event") {
          console.warn("Google redirect result warning:", err.code, err.message);
        }
      });
    }
    _fbAuthInstance.onAuthStateChanged((user) => {
      _fbCurrentUser = user || null;
      if (data.settings?.cloudSync) {
        data.settings.cloudSync.authUid = user ? user.uid : "";
        data.settings.cloudSync.authEmail = user ? (user.email || "") : "";
      }
      updateFirebaseAuthUI();
      if (user && data.settings?.cloudSync?.enabled && data.settings.cloudSync.authMode === "firebase_auth") {
        pullCloudSyncNow(true);
      }
    });
    return true;
  } catch (err) {
    console.warn("Firebase Auth init warning:", err?.message || err);
    updateFirebaseAuthUI();
    return false;
  }
}

async function getFreshFirebaseIdToken(forceRefresh = false) {
  const user = getCurrentFirebaseUser();
  if (!user || typeof user.getIdToken !== "function") return "";
  try {
    return await user.getIdToken(forceRefresh);
  } catch {
    return "";
  }
}

function updateTickerGuardUI() {
  const allowed = isGoogleAccountSignedIn();
  const lockBanner = document.getElementById("tickerAuthLockBanner");
  const testInp = document.getElementById("testTickerInput");
  const testBtn = document.getElementById("testTickerBtn");
  const refreshBtn = document.getElementById("refreshEtfsBtn");
  const lookupBtn = document.getElementById("toggleTickerLookupBtn");
  const presetBtns = document.querySelectorAll("#tickerLookupBox .preset-pill");

  if (lockBanner) {
    lockBanner.style.display = allowed ? "none" : "flex";
  }
  if (testInp) {
    testInp.disabled = !allowed;
  }
  if (testBtn) {
    testBtn.disabled = !allowed;
    testBtn.title = allowed ? "Έλεγχος ζωντανής τιμής" : "Απαιτείται σύνδεση με λογαριασμό Google";
  }
  if (refreshBtn) {
    refreshBtn.title = allowed
      ? "Ενημέρωση ζωντανών τιμών χαρτοφυλακίου"
      : "🔒 Απαιτείται σύνδεση με Google για ενημέρωση τιμών";
  }
  if (lookupBtn) {
    lookupBtn.textContent = allowed ? "🔍 Έλεγχος Ticker" : "🔒 Έλεγχος Ticker";
  }
  presetBtns.forEach(btn => {
    btn.disabled = !allowed;
  });
}

function updateFirebaseAuthUI() {
  const statusEl = document.getElementById("fbAuthStatusText");
  const signedOutBox = document.getElementById("fbAuthSignedOutBox");
  const signedInBox = document.getElementById("fbAuthSignedInBox");
  const configWarnEl = document.getElementById("fbAuthConfigWarn");
  const memberMgmtBox = document.getElementById("cloudRoomMembersMgmtBox");

  const configured = isFirebaseAuthConfigured();
  const user = getCurrentFirebaseUser();
  const googleSignedIn = isGoogleAccountSignedIn();

  if (configWarnEl) {
    configWarnEl.style.display = configured ? "none" : "block";
  }
  if (signedOutBox) {
    signedOutBox.style.display = (configured && !user) ? "block" : "none";
  }
  if (signedInBox) {
    signedInBox.style.display = (configured && user) ? "flex" : "none";
  }
  if (statusEl) {
    if (!configured) {
      statusEl.textContent = "⚙️ Εκκρεμεί το Web API Key στο js/firebase-config.js";
    } else if (user) {
      const providerTag = googleSignedIn ? " (Google)" : " (Email)";
      statusEl.textContent = `✅ Συνδεδεμένος ως: ${user.email || user.uid}${providerTag}`;
    } else {
      statusEl.textContent = "🔒 Απαιτείται σύνδεση Firebase (Google ή Email) για ασφαλές Cloud Sync & Έλεγχο Ticker";
    }
  }

  const cfg = data.settings?.cloudSync || {};
  const isAuthRoom = Boolean(cfg.enabled && cfg.authMode === "firebase_auth" && user);
  const myRole = String(cfg.membershipRole || "owner").toLowerCase();
  const isOwner = isAuthRoom && myRole === "owner";

  if (memberMgmtBox) {
    memberMgmtBox.style.display = isOwner ? "block" : "none";
  }

  const membersListBox = document.getElementById("cloudRoomMembersListBox");
  const membersListEl = document.getElementById("cloudRoomMembersList");
  const myRoleBadge = document.getElementById("cloudRoomMyRoleBadge");
  if (membersListBox && membersListEl) {
    membersListBox.style.display = isAuthRoom ? "block" : "none";
    if (myRoleBadge) {
      myRoleBadge.textContent = myRole === "owner" ? "👑 Owner" : (myRole === "editor" ? "✏️ Editor" : "👁️ Viewer");
    }
    if (isAuthRoom) {
      const membersMap = (cfg.roomMembers && typeof cfg.roomMembers === "object")
        ? cfg.roomMembers
        : { [user.uid]: { role: myRole, email: user.email || user.uid, joinedAt: Date.now() } };
      const entries = Object.entries(membersMap);
      membersListEl.innerHTML = entries.map(([uid, info]) => {
        const r = String(info?.role || "viewer").toLowerCase();
        const roleTag = r === "owner" ? "👑 Owner" : (r === "editor" ? "✏️ Editor" : "👁️ Viewer");
        const label = escapeHtml(info?.email || uid);
        const isMe = uid === user.uid;
        const removeBtn = (isOwner && !isMe)
          ? `<button type="button" class="danger small-btn" style="padding:2px 7px; font-size:11px;" data-uid="${escapeHtml(uid)}" data-email="${label}" onclick="removeRoomMemberByUid(this.dataset.uid, this.dataset.email)">✕</button>`
          : "";
        return `<div style="display:flex; justify-content:space-between; align-items:center; gap:8px; padding:5px 0; border-bottom:1px solid var(--border);">
          <span><strong>${label}</strong>${isMe ? " (Εσύ)" : ""}</span>
          <span style="display:inline-flex; align-items:center; gap:6px;">
            <span class="badge ${r === "owner" ? "income" : "saving"}" style="font-size:10px;">${roleTag}</span>
            ${removeBtn}
          </span>
        </div>`;
      }).join("");
    }
  }

  updateTickerGuardUI();
}

function shouldFallbackToRedirect(err) {
  const code = String(err?.code || "");
  return [
    "auth/popup-blocked",
    "auth/cancelled-popup-request",
    "auth/operation-not-supported-in-this-environment",
    "auth/web-storage-unsupported"
  ].includes(code);
}

async function signInWithGoogleFirebase() {
  if (!isFirebaseAuthConfigured()) {
    showModal("Συμπλήρωσε πρώτα το apiKey και appId στο αρχείο js/firebase-config.js.");
    return;
  }
  if (!_fbAuthInstance) {
    initFirebaseAuthIfConfigured();
  }
  const provider = new firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    const cred = await _fbAuthInstance.signInWithPopup(provider);
    if (cred?.user) {
      _fbCurrentUser = cred.user;
      updateFirebaseAuthUI();
    }
    showToast("✅ Συνδέθηκες με Google! Ο Έλεγχος Ticker ξεκλειδώθηκε.");
  } catch (err) {
    if (shouldFallbackToRedirect(err) && typeof _fbAuthInstance.signInWithRedirect === "function") {
      try {
        await _fbAuthInstance.signInWithRedirect(provider);
        return;
      } catch (redirErr) {
        err = redirErr;
      }
    }
    console.error("Google sign-in error:", err);
    const codeTag = err?.code ? ` [${err.code}]` : "";
    showModal(`Αποτυχία σύνδεσης Google${codeTag}: ${err?.message || "Σφάλμα"}`);
  }
}

async function signInWithEmailFirebase(isRegister = false) {
  if (!isFirebaseAuthConfigured()) {
    showModal("Συμπλήρωσε πρώτα το apiKey και appId στο αρχείο js/firebase-config.js.");
    return;
  }
  const email = (document.getElementById("fbAuthEmailInput")?.value || "").trim();
  const pass = (document.getElementById("fbAuthPassInput")?.value || "").trim();
  if (!email || pass.length < 6) {
    showModal("Συμπλήρωσε έγκυρο email και κωδικό (τουλάχιστον 6 χαρακτήρες).");
    return;
  }
  try {
    if (isRegister) {
      await _fbAuthInstance.createUserWithEmailAndPassword(email, pass);
      showToast("✅ Ο λογαριασμός δημιουργήθηκε και συνδέθηκες!");
    } else {
      await _fbAuthInstance.signInWithEmailAndPassword(email, pass);
      showToast("✅ Συνδέθηκες επιτυχώς!");
    }
  } catch (err) {
    console.error("Email auth error:", err);
    showModal(`Αποτυχία σύνδεσης: ${err?.message || "Έλεγξε email/κωδικό."}`);
  }
}

async function signOutFirebase() {
  if (!_fbAuthInstance) return;
  try {
    await _fbAuthInstance.signOut();
    showToast("👋 Αποσυνδέθηκες από το Firebase Auth.");
  } catch (err) {
    console.error("Sign out error:", err);
  }
}

async function callFinanceGrCloudFunction(fnName, bodyObj = {}) {
  const baseUrl = String(window.FINANCEGR_FIREBASE_CONFIG?.functionsBaseUrl || "").replace(/\/+$/, "");
  if (!baseUrl) {
    throw new Error("Λείπει το functionsBaseUrl στο js/firebase-config.js");
  }
  const idToken = await getFreshFirebaseIdToken(false);
  if (!idToken) {
    throw new Error("Απαιτείται σύνδεση χρήστη (Firebase Authentication).");
  }
  const res = await fetch(`${baseUrl}/${fnName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${idToken}`
    },
    body: JSON.stringify(bodyObj)
  });
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  if (!res.ok || !payload?.ok) {
    throw new Error(payload?.error || `Cloud Function HTTP ${res.status}`);
  }
  return payload;
}

async function inviteRoomMemberViaFunction() {
  const cfg = data.settings?.cloudSync;
  const emailInp = document.getElementById("inviteMemberEmailInput");
  const roleSel = document.getElementById("inviteMemberRoleSelect");
  const email = (emailInp?.value || "").trim().toLowerCase();
  const role = (roleSel?.value || "editor").trim();
  if (!cfg?.roomCode || !email) {
    showModal("Συμπλήρωσε το email του μέλους που θέλεις να προσθέσεις.");
    return;
  }
  try {
    const res = await callFinanceGrCloudFunction("manageMember", {
      roomId: cfg.roomCode,
      action: "add",
      targetEmail: email,
      role
    });
    if (emailInp) emailInp.value = "";
    if (typeof pullCloudSyncNow === "function") await pullCloudSyncNow(true);
    updateFirebaseAuthUI();
    showToast(`✅ Το μέλος ${res.email || email} προστέθηκε ως ${res.role}!`);
  } catch (err) {
    showModal(`Αποτυχία προσθήκης μέλους: ${err?.message || "Σφάλμα"}`);
  }
}

async function removeRoomMemberViaFunction() {
  const cfg = data.settings?.cloudSync;
  const emailInp = document.getElementById("inviteMemberEmailInput");
  const email = (emailInp?.value || "").trim().toLowerCase();
  if (!cfg?.roomCode || !email) {
    showModal("Συμπλήρωσε το email του μέλους προς αφαίρεση.");
    return;
  }
  try {
    await callFinanceGrCloudFunction("manageMember", {
      roomId: cfg.roomCode,
      action: "remove",
      targetEmail: email
    });
    if (emailInp) emailInp.value = "";
    if (typeof pullCloudSyncNow === "function") await pullCloudSyncNow(true);
    updateFirebaseAuthUI();
    showToast(`🗑️ Το μέλος ${email} αφαιρέθηκε από το δωμάτιο.`);
  } catch (err) {
    showModal(`Αποτυχία αφαίρεσης μέλους: ${err?.message || "Σφάλμα"}`);
  }
}

async function removeRoomMemberByUid(targetUid, label = "") {
  const cfg = data.settings?.cloudSync;
  if (!cfg?.roomCode || !targetUid) return;
  try {
    await callFinanceGrCloudFunction("manageMember", {
      roomId: cfg.roomCode,
      action: "remove",
      targetUid
    });
    if (cfg.roomMembers && cfg.roomMembers[targetUid]) {
      delete cfg.roomMembers[targetUid];
    }
    updateFirebaseAuthUI();
    showToast(`🗑️ Το μέλος ${label || targetUid} αφαιρέθηκε.`);
  } catch (err) {
    showModal(`Αποτυχία αφαίρεσης μέλους: ${err?.message || "Σφάλμα"}`);
  }
}

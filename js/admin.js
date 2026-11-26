/* ==========================================================================
   FinanceGR Standalone Hidden Admin Console (Server-Verified Only)
   ========================================================================== */
let _admAuth = null;
let _admRooms = [];
let _admUsersQuota = [];
let _admAuditLogs = [];
let _admParserErrors = [];
let _admAnalytics = { totals: {}, daily: [] };
let _admInfra = null;
let _admActiveTab = "overview";

function admEscapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function admFormatDate(ts) {
  const n = Number(ts) || 0;
  if (!n) return "—";
  try {
    return new Date(n).toLocaleString("el-GR", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return "—";
  }
}

function showGateError(msg) {
  const el = document.getElementById("adminGateMessage");
  if (!el) return;
  el.textContent = msg;
  el.style.display = msg ? "block" : "none";
}

function showAdminBanner(msg, isError = false) {
  const el = document.getElementById("adminStatusToast");
  if (!el) return;
  el.className = isError ? "banner warn" : "banner success";
  el.textContent = msg;
  el.style.display = "block";
  setTimeout(() => {
    if (el.textContent === msg) el.style.display = "none";
  }, 5000);
}

async function callAdminFunction(fnName, body = {}) {
  const user = _admAuth?.currentUser;
  if (!user) throw new Error("Απαιτείται σύνδεση διαχειριστή.");
  const idToken = await user.getIdToken(false);
  const baseUrl = String(window.FINANCEGR_FIREBASE_CONFIG?.functionsBaseUrl || "").replace(/\/+$/, "");
  const res = await fetch(`${baseUrl}/${fnName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${idToken}`
    },
    body: JSON.stringify(body)
  });
  let payload = null;
  try { payload = await res.json(); } catch { payload = null; }
  if (!res.ok || !payload?.ok) {
    const err = new Error(payload?.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return payload;
}

function admShouldFallbackRedirect(err) {
  const code = String(err?.code || "");
  return [
    "auth/popup-blocked",
    "auth/cancelled-popup-request",
    "auth/operation-not-supported-in-this-environment",
    "auth/web-storage-unsupported"
  ].includes(code);
}

async function adminSignInWithGoogle() {
  showGateError("");
  if (!_admAuth && typeof firebase !== "undefined" && window.FINANCEGR_FIREBASE_CONFIG) {
    if (!firebase.apps.length) firebase.initializeApp(window.FINANCEGR_FIREBASE_CONFIG);
    _admAuth = firebase.auth();
  }
  if (!_admAuth) {
    showGateError("Αδυναμία αρχικοποίησης Firebase Auth.");
    return;
  }

  // If already signed in with a Google account, force-refresh token and verify adminOverview directly
  if (_admAuth.currentUser) {
    const providers = Array.isArray(_admAuth.currentUser.providerData) ? _admAuth.currentUser.providerData : [];
    const hasGoogle = providers.some(p => p && p.providerId === "google.com");
    if (hasGoogle) {
      try {
        await _admAuth.currentUser.getIdToken(true);
      } catch {}
      await loadAdminOverview();
      return;
    }
  }

  const btn = document.getElementById("adminGoogleLoginBtn");
  if (btn) btn.disabled = true;
  const provider = new firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    const cred = await _admAuth.signInWithPopup(provider);
    if (cred?.user) {
      await loadAdminOverview();
    }
  } catch (err) {
    if (admShouldFallbackRedirect(err) && typeof _admAuth.signInWithRedirect === "function") {
      try {
        await _admAuth.signInWithRedirect(provider);
        return;
      } catch (redirErr) {
        err = redirErr;
      }
    }
    const codeTag = err?.code ? ` [${err.code}]` : "";
    showGateError(`Αποτυχία σύνδεσης Google${codeTag}: ${err?.message || "Σφάλμα"}`);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function adminSignOut() {
  if (!_admAuth) return;
  await _admAuth.signOut();
  _admRooms = [];
  document.getElementById("adminConsoleApp").style.display = "none";
  document.getElementById("adminLoginGate").style.display = "flex";
}

async function loadAdminOverview() {
  try {
    const data = await callAdminFunction("adminOverview", {});
    _admRooms = Array.isArray(data.rooms) ? data.rooms : [];
    _admUsersQuota = Array.isArray(data.usersQuota) ? data.usersQuota : [];
    _admAuditLogs = Array.isArray(data.auditLogs) ? data.auditLogs : [];
    _admParserErrors = Array.isArray(data.parserErrors) ? data.parserErrors : [];
    _admAnalytics = data.analytics && typeof data.analytics === "object"
      ? data.analytics
      : { totals: {}, daily: [] };

    document.getElementById("adminLoginGate").style.display = "none";
    document.getElementById("adminConsoleApp").style.display = "block";
    document.getElementById("adminIdentityLine").textContent =
      `Επαληθευμένος Διαχειριστής: ${data.admin?.email || data.admin?.uid || "Admin"}`;

    document.getElementById("admKpiTotalRooms").textContent = String(data.summary?.totalRooms ?? _admRooms.length);
    document.getElementById("admKpiRoomsSplit").textContent =
      `Auth: ${data.summary?.authRooms ?? 0} • Μοναδικοί χρήστες: ${data.summary?.uniqueUsers ?? _admUsersQuota.length}`;
    document.getElementById("admKpiTotalMembers").textContent = String(data.summary?.totalMembers ?? 0);
    document.getElementById("admKpiSecurityAlerts").textContent = String(data.summary?.securityAlertsCount ?? 0);
    document.getElementById("admKpiSecuritySub").textContent = `403 / 429 στο Audit Log (σύνολο ${_admAuditLogs.length})`;
    document.getElementById("admKpiParserErrors").textContent = String(data.summary?.parserErrorsCount ?? _admParserErrors.length);
    document.getElementById("admKpiInactiveSub").textContent = `Ανενεργοί >30ημ: ${data.summary?.inactiveUsersCount ?? 0} • Όριο: ${data.summary?.maxRoomsPerUser ?? 5} rooms`;

    _admInfra = data.infra && typeof data.infra === "object" ? data.infra : null;

    const roomsBadge = document.getElementById("admTabBadgeRooms");
    if (roomsBadge) roomsBadge.textContent = String(_admRooms.length);

    const secTotal = (data.summary?.securityAlertsCount ?? 0) + (data.summary?.parserErrorsCount ?? _admParserErrors.length);
    const secBadge = document.getElementById("admTabBadgeSecurity");
    if (secBadge) {
      secBadge.style.display = secTotal > 0 ? "inline-flex" : "none";
      secBadge.className = `badge ${secTotal > 0 ? "expense" : ""}`;
      secBadge.textContent = String(secTotal);
    }

    const syncTsEl = document.getElementById("admLastSyncTime");
    if (syncTsEl) {
      syncTsEl.textContent = `Ενημέρωση: ${new Date().toLocaleTimeString("el-GR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
    }

    renderInfraDashboard();
    renderRoomsOverviewTable();
    populateRoomSelector();
    renderSelectedRoomMembers();
    renderProductAnalyticsPanel();
    renderUsersQuotaTable();
    renderAuditLogTable();
    renderParserErrorsTable();

    // Restore last tab or default to overview
    try {
      const savedTab = sessionStorage.getItem("fg_admin_tab");
      if (savedTab) switchAdminTab(savedTab);
    } catch {}

    // Non-blocking live Cloudflare Worker & FX probe
    probeCloudflareWorkerStatus();
  } catch (err) {
    if (err?.status === 401 || err?.status === 403) {
      await _admAuth?.signOut();
      document.getElementById("adminConsoleApp").style.display = "none";
      document.getElementById("adminLoginGate").style.display = "flex";
      showGateError("⛔ Μη εξουσιοδοτημένος λογαριασμός Google. Βεβαιώσου ότι συνδέθηκες με το email που έχει οριστεί στο FINANCEGR_ADMIN_EMAILS (στο functions/.env) και ότι έχει γίνει firebase deploy --only functions.");
    } else {
      showGateError(`⚠️ Σφάλμα επικοινωνίας με Cloud Function (adminOverview): ${err?.message || "Επιβεβαίωσε το firebase deploy --only functions"}`);
    }
  }
}

function populateRoomSelector() {
  const sel = document.getElementById("admRoomSelect");
  if (!sel) return;
  const prev = sel.value;
  const authRooms = _admRooms.filter(r => !r.isLegacy);
  if (authRooms.length === 0) {
    sel.innerHTML = `<option value="">Κανένα Firebase Auth δωμάτιο ακόμη</option>`;
    return;
  }
  sel.innerHTML = authRooms.map(r => {
    const cnt = Object.keys(r.members || {}).length;
    return `<option value="${admEscapeHtml(r.roomId)}">${admEscapeHtml(r.roomId)} (${cnt} μέλη)</option>`;
  }).join("");
  if (prev && authRooms.some(r => r.roomId === prev)) {
    sel.value = prev;
  }
}

function renderSelectedRoomMembers() {
  const sel = document.getElementById("admRoomSelect");
  const tbody = document.getElementById("admMembersTbody");
  if (!tbody) return;
  const roomId = sel?.value || "";
  const room = _admRooms.find(r => r.roomId === roomId);
  if (!room) {
    tbody.innerHTML = `<tr><td colspan="4" class="small">Δεν επιλέχθηκε προστατευμένο δωμάτιο.</td></tr>`;
    return;
  }
  const entries = Object.entries(room.members || {});
  const ownerCount = entries.filter(([, m]) => m.role === "owner").length;
  if (entries.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="small">Κανένα μέλος σε αυτό το δωμάτιο.</td></tr>`;
    return;
  }

  tbody.innerHTML = entries.map(([uid, info]) => {
    const emailLabel = admEscapeHtml(info.email || uid);
    const r = info.role || "viewer";
    const disableLastOwner = r === "owner" && ownerCount <= 1;
    const roleBadge = r === "owner" ? "👑 Owner" : (r === "editor" ? "✏️ Editor" : "👁️ Viewer");
    return `
      <tr>
        <td>
          <strong>${emailLabel}</strong>
          <div class="small" style="font-family:monospace; opacity:0.75;">${admEscapeHtml(uid)}</div>
        </td>
        <td><span class="badge ${r === "owner" ? "income" : "saving"}">${roleBadge}</span></td>
        <td class="small">${admEscapeHtml(admFormatDate(info.joinedAt))}</td>
        <td style="text-align:right;">
          <div style="display:inline-flex; gap:6px; align-items:center;">
            <select style="padding:4px 8px; font-size:12px;" data-room="${admEscapeHtml(roomId)}" data-uid="${admEscapeHtml(uid)}" data-email="${emailLabel}" onchange="admChangeRole(this.dataset.room, this.dataset.uid, this.value, this.dataset.email)" ${disableLastOwner ? "disabled title='Πρέπει να παραμείνει τουλάχιστον 1 Owner'" : ""}>
              <option value="owner" ${r === "owner" ? "selected" : ""}>Owner</option>
              <option value="editor" ${r === "editor" ? "selected" : ""}>Editor</option>
              <option value="viewer" ${r === "viewer" ? "selected" : ""}>Viewer</option>
            </select>
            <button type="button" class="danger small-btn" data-room="${admEscapeHtml(roomId)}" data-uid="${admEscapeHtml(uid)}" data-email="${emailLabel}" onclick="admRemoveMember(this.dataset.room, this.dataset.uid, this.dataset.email)" ${disableLastOwner ? "disabled" : ""}>🗑️</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

function renderRoomsOverviewTable() {
  const tbody = document.getElementById("admRoomsTbody");
  if (!tbody) return;
  const query = (document.getElementById("admRoomSearchInput")?.value || "").trim().toLowerCase();

  const filtered = _admRooms.filter(r => {
    if (!query) return true;
    const idMatch = String(r.roomId || "").toLowerCase().includes(query);
    const memberEmails = Object.values(r.members || {}).map(m => String(m?.email || "").toLowerCase()).join(" ");
    return idMatch || memberEmails.includes(query);
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="small">${_admRooms.length === 0 ? "Δεν βρέθηκαν δωμάτια στη βάση." : "Κανένα δωμάτιο δεν ταιριάζει στην αναζήτηση."}</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(r => {
    const memberEntries = Object.values(r.members || {});
    const memberCount = memberEntries.length;
    const emailPreview = memberEntries
      .map(m => admEscapeHtml(m?.email || "—"))
      .slice(0, 3)
      .join(", ") + (memberCount > 3 ? ` +${memberCount - 3}` : "");
    const typeBadge = r.isLegacy
      ? `<span class="badge withdrawal">Legacy (v1)</span>`
      : `<span class="badge income">Firebase Auth (v${r.schemaVersion})</span>`;
    const safeRoom = admEscapeHtml(r.roomId);
    return `
      <tr>
        <td style="font-family:monospace;">
          <strong>${safeRoom}</strong>
          <div class="small" style="opacity:0.75;">${memberCount} μέλη</div>
        </td>
        <td>${typeBadge}</td>
        <td class="small">${emailPreview || "—"}</td>
        <td>${r.txCount === null || r.txCount === undefined ? "🔒 Zero-Knowledge" : r.txCount}</td>
        <td class="small">${admEscapeHtml(admFormatDate(r.updatedAt || r.createdAt))}</td>
        <td style="text-align:right;">
          <div style="display:inline-flex; gap:6px; align-items:center;">
            <button type="button" class="secondary small-btn" data-room="${safeRoom}" onclick="admSelectRoom(this.dataset.room)" title="Επιλογή δωματίου">👁️</button>
            <button type="button" class="danger small-btn" data-room="${safeRoom}" onclick="admDeleteRoom(this.dataset.room)" title="Οριστική διαγραφή δωματίου">🗑️</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

function admSelectRoom(roomId) {
  switchAdminTab("rooms");
  const sel = document.getElementById("admRoomSelect");
  if (sel) {
    sel.value = roomId;
    renderSelectedRoomMembers();
    sel.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

async function admDeleteRoom(roomId) {
  if (!roomId) return;
  if (!confirm(`ΠΡΟΣΟΧΗ: Θα διαγραφεί οριστικά το δωμάτιο «${roomId}» μαζί με όλα τα κρυπτογραφημένα δεδομένα του από το Firebase.\n\nΣυνέχεια;`)) return;
  try {
    await callAdminFunction("deleteRoom", { roomId });
    showAdminBanner(`🗑️ Το δωμάτιο ${roomId} διαγράφηκε οριστικά.`);
    await loadAdminOverview();
  } catch (err) {
    showAdminBanner(`⚠️ ${err?.message || "Σφάλμα διαγραφής δωματίου"}`, true);
  }
}

async function admAddMember() {
  const roomId = document.getElementById("admRoomSelect")?.value || "";
  const emailInp = document.getElementById("admInviteEmail");
  const roleSel = document.getElementById("admInviteRole");
  const email = (emailInp?.value || "").trim().toLowerCase();
  const role = (roleSel?.value || "editor").trim();
  if (!roomId || !email) {
    showAdminBanner("Επίλεξε δωμάτιο και συμπλήρωσε email μέλους.", true);
    return;
  }
  try {
    await callAdminFunction("manageMember", { roomId, action: "add", targetEmail: email, role });
    if (emailInp) emailInp.value = "";
    showAdminBanner(`✅ Το μέλος ${email} προστέθηκε στο ${roomId} ως ${role}.`);
    await loadAdminOverview();
  } catch (err) {
    showAdminBanner(`⚠️ ${err?.message || "Σφάλμα προσθήκης"}`, true);
  }
}

async function admChangeRole(roomId, targetUid, role, emailLabel) {
  try {
    await callAdminFunction("manageMember", { roomId, action: "updateRole", targetUid, role });
    showAdminBanner(`✅ Ο ρόλος του ${emailLabel} άλλαξε σε ${role}.`);
    await loadAdminOverview();
  } catch (err) {
    showAdminBanner(`⚠️ ${err?.message || "Σφάλμα αλλαγής ρόλου"}`, true);
    await loadAdminOverview();
  }
}

async function admRemoveMember(roomId, targetUid, emailLabel) {
  if (!confirm(`Αφαίρεση του μέλους ${emailLabel} από το δωμάτιο ${roomId};`)) return;
  try {
    await callAdminFunction("manageMember", { roomId, action: "remove", targetUid });
    showAdminBanner(`🗑️ Το μέλος ${emailLabel} αφαιρέθηκε.`);
    await loadAdminOverview();
  } catch (err) {
    showAdminBanner(`⚠️ ${err?.message || "Σφάλμα αφαίρεσης"}`, true);
  }
}

window.addEventListener("DOMContentLoaded", () => {
  if (typeof firebase === "undefined" || !window.FINANCEGR_FIREBASE_CONFIG) {
    showGateError("Αδυναμία φόρτωσης Firebase SDK.");
    return;
  }
  if (!firebase.apps.length) {
    firebase.initializeApp(window.FINANCEGR_FIREBASE_CONFIG);
  }
  _admAuth = firebase.auth();
  if (typeof _admAuth.getRedirectResult === "function") {
    _admAuth.getRedirectResult().then((res) => {
      if (res && res.user) {
        loadAdminOverview();
      }
    }).catch((err) => {
      if (err && err.code && err.code !== "auth/no-auth-event") {
        showGateError(`Αποτυχία σύνδεσης Google [${err.code}]: ${err.message || "Σφάλμα"}`);
      }
    });
  }
  _admAuth.onAuthStateChanged((user) => {
    if (user) {
      loadAdminOverview();
    } else {
      document.getElementById("adminConsoleApp").style.display = "none";
      document.getElementById("adminLoginGate").style.display = "flex";
    }
  });
});

async function runAdminSystemHealthCheck() {
  const btn = document.getElementById("admRunHealthBtn");
  const box = document.getElementById("admHealthResultsBox");
  const badge = document.getElementById("admHealthSummaryBadge");
  if (!box) return;

  if (btn) {
    btn.disabled = true;
    btn.textContent = "⏳ Εκτέλεση ελέγχων...";
  }
  box.innerHTML = `<div class="small">⏳ Εκτέλεση Self-Test πυρήνα και live probes (Cloudflare Worker / FX)...</div>`;

  const allResults = [];
  const t0 = performance.now();

  // 1. Core Engine Self-Tests (from js/self-tests.js)
  try {
    if (typeof runFinanceGRSelfTests === "function") {
      const coreRes = await runFinanceGRSelfTests();
      coreRes.forEach(r => allResults.push({ group: "Core", ...r }));
    } else {
      allResults.push({ group: "Core", name: "Φόρτωση js/self-tests.js", passed: false, detail: "Μη διαθέσιμο" });
    }
  } catch (err) {
    allResults.push({ group: "Core", name: "Εκτέλεση Core Self-Tests", passed: false, detail: err?.message || "Σφάλμα" });
  }

  // 2. Live Cloudflare Quotes Worker & FX Probe (using Admin's Google ID Token)
  try {
    const user = _admAuth?.currentUser;
    const idToken = user ? await user.getIdToken(false) : "";
    const workerUrl = typeof CF_QUOTES_WORKER_URL !== "undefined"
      ? CF_QUOTES_WORKER_URL
      : "https://financegr-quotes.tgoulis.workers.dev";

    const wStart = performance.now();
    const qRes = await fetch(`${workerUrl}/?symbol=VUAA.MI`, {
      headers: idToken ? { "Authorization": `Bearer ${idToken}` } : {}
    });
    const wMs = Math.round(performance.now() - wStart);
    const qJson = await qRes.json().catch(() => null);
    const quoteOk = qRes.ok && qJson?.success === true && Number(qJson?.priceEur) > 0;
    allResults.push({
      group: "Live",
      name: "Cloudflare Quotes Worker (VUAA.MI + Google RS256)",
      passed: quoteOk,
      detail: quoteOk ? `€${Number(qJson.priceEur).toFixed(2)} • ${wMs}ms` : `HTTP ${qRes.status} (${qJson?.error || "Σφάλμα"})`
    });

    const fxStart = performance.now();
    const fxRes = await fetch(`${workerUrl}/?endpoint=fx`, {
      headers: idToken ? { "Authorization": `Bearer ${idToken}` } : {}
    });
    const fxMs = Math.round(performance.now() - fxStart);
    const fxJson = await fxRes.json().catch(() => null);
    const fxOk = fxRes.ok && Boolean(fxJson?.ratesToEur?.USD);
    allResults.push({
      group: "Live",
      name: "Live FX Endpoint (ECB / Frankfurter)",
      passed: fxOk,
      detail: fxOk
        ? `${fxJson.source || "FX"} • asOf ${fxJson.asOf || "—"} • ${fxJson.freshnessStatus || "ok"} • ${fxMs}ms`
        : `HTTP ${fxRes.status}`
    });
  } catch (err) {
    allResults.push({ group: "Live", name: "Cloudflare Worker / FX Probe", passed: false, detail: err?.message || "Σφάλμα δικτύου" });
  }

  // 3. PWA Service Worker status check
  try {
    const swRegs = ("serviceWorker" in navigator) ? await navigator.serviceWorker.getRegistrations() : [];
    const activeSw = swRegs.some(r => Boolean(r.active));
    allResults.push({
      group: "PWA",
      name: "Service Worker Registration",
      passed: true,
      detail: activeSw ? `Ενεργό (${swRegs.length} registration)` : "Μη εγγεγραμμένο σε αυτό το origin (π.χ. localhost)"
    });
  } catch {
    allResults.push({ group: "PWA", name: "Service Worker Registration", passed: true, detail: "Μη διαθέσιμο" });
  }

  const totalMs = Math.round(performance.now() - t0);
  const passedCount = allResults.filter(r => r.passed).length;
  const allOk = passedCount === allResults.length;

  if (badge) {
    badge.style.display = "inline-flex";
    badge.className = `badge ${allOk ? "income" : "expense"}`;
    badge.textContent = `${allOk ? "✅" : "⚠️"} ${passedCount}/${allResults.length} (${totalMs}ms)`;
  }

  box.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Κατηγορία</th>
            <th>Έλεγχος</th>
            <th>Αποτέλεσμα</th>
            <th>Λεπτομέρειες</th>
          </tr>
        </thead>
        <tbody>
          ${allResults.map(r => `
            <tr>
              <td><span class="badge ${r.group === "Live" ? "saving" : ""}" style="font-size:10.5px;">${admEscapeHtml(r.group)}</span></td>
              <td><strong>${admEscapeHtml(r.name)}</strong></td>
              <td><span class="badge ${r.passed ? "income" : "expense"}">${r.passed ? "✅ PASS" : "❌ FAIL"}</span></td>
              <td class="small">${admEscapeHtml(r.detail || "OK")}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;

  if (btn) {
    btn.disabled = false;
    btn.textContent = "🧪 Εκτέλεση Πλήρους Ελέγχου";
  }
  showAdminBanner(
    allOk
      ? `✅ Έλεγχος Υγείας επιτυχής: ${passedCount}/${allResults.length} (${totalMs}ms)`
      : `⚠️ Εντοπίστηκαν αποτυχίες: ${passedCount}/${allResults.length} επιτυχείς.`,
    !allOk
  );
}

function renderProductAnalyticsPanel() {
  const totals = _admAnalytics?.totals || {};
  const daily = Array.isArray(_admAnalytics?.daily) ? _admAnalytics.daily : [];

  const setEl = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = String(v); };
  setEl("admAnaSessions", totals.session_start || 0);
  setEl("admAnaOnboarding", `${totals.onboarding_completed || 0} / ${totals.demo_loaded || 0}`);
  setEl("admAnaImports", totals.bank_import_success || 0);
  setEl("admAnaCloudSync", totals.cloud_sync_connected || 0);

  const tbody = document.getElementById("admAnalyticsTbody");
  if (!tbody) return;
  if (daily.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="small">Δεν έχουν καταγραφεί ακόμη ημερήσιοι μετρητές χρήσης.</td></tr>`;
    return;
  }
  tbody.innerHTML = daily.map(d => `
    <tr>
      <td style="font-family:monospace;"><strong>${admEscapeHtml(d.day)}</strong></td>
      <td>${d.session_start}</td>
      <td>${d.onboarding_completed}</td>
      <td>${d.demo_loaded}</td>
      <td>${d.bank_import_success}</td>
      <td>${d.cloud_sync_connected}</td>
    </tr>
  `).join("");
}

function renderUsersQuotaTable() {
  const tbody = document.getElementById("admUsersQuotaTbody");
  if (!tbody) return;
  const filter = document.getElementById("admQuotaFilterSelect")?.value || "all";

  const list = _admUsersQuota.filter(u => {
    if (filter === "at_quota") return u.roomsCount >= u.maxRooms;
    if (filter === "inactive") return u.inactiveDays >= 30;
    return true;
  });

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="small">Δεν βρέθηκαν χρήστες για αυτό το φίλτρο.</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(u => {
    const pct = Math.min(100, Math.round((u.roomsCount / Math.max(1, u.maxRooms)) * 100));
    const statusMap = {
      active: `<span class="badge income">🟢 Ενεργός</span>`,
      at_quota: `<span class="badge expense">⚠️ Όριο Quota</span>`,
      inactive_30d: `<span class="badge withdrawal">🟡 Ανενεργός ${u.inactiveDays}ημ</span>`,
      inactive_60d: `<span class="badge expense">🔴 Ανενεργός ${u.inactiveDays}ημ</span>`
    };
    return `
      <tr>
        <td>
          <strong>${admEscapeHtml(u.email || u.uid)}</strong>
          <div class="small" style="font-family:monospace; opacity:0.7;">${admEscapeHtml(u.uid)}</div>
        </td>
        <td>
          <strong>${u.roomsCount} / ${u.maxRooms}</strong> (${pct}%)
          <div class="progress" style="height:5px; margin-top:4px; max-width:120px;">
            <div style="width:${pct}%; background:${pct >= 100 ? "var(--danger)" : "var(--accent)"};"></div>
          </div>
        </td>
        <td>${u.ownedRoomsCount}</td>
        <td class="small">${admEscapeHtml(admFormatDate(u.lastActivityAt))}</td>
        <td>${statusMap[u.status] || statusMap.active}</td>
      </tr>
    `;
  }).join("");
}

function renderAuditLogTable() {
  const tbody = document.getElementById("admAuditLogTbody");
  if (!tbody) return;
  const filter = document.getElementById("admAuditFilterSelect")?.value || "all";

  const list = _admAuditLogs.filter(e => {
    if (filter === "security") return e.severity === "security" || e.statusCode === 403 || e.statusCode === 429;
    if (filter === "changes") return ["room_created", "room_deleted", "member_added", "member_role_updated", "member_removed"].includes(e.action);
    return true;
  });

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="small">Δεν υπάρχουν καταγεγραμμένα συμβάντα ασφαλείας.</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(e => {
    const sevBadge = e.severity === "security"
      ? `<span class="badge expense">🚨 SECURITY (${e.statusCode})</span>`
      : (e.severity === "warn" ? `<span class="badge withdrawal">⚠️ WARN (${e.statusCode})</span>` : `<span class="badge income">ℹ️ INFO</span>`);
    return `
      <tr>
        <td class="small">${admEscapeHtml(admFormatDate(e.ts))}</td>
        <td>${sevBadge}</td>
        <td style="font-family:monospace; font-size:12px;"><strong>${admEscapeHtml(e.action)}</strong></td>
        <td class="small">${admEscapeHtml(e.actorEmail || e.actorUid || "—")}</td>
        <td style="font-family:monospace; font-size:12px;">${admEscapeHtml(e.roomId || "—")}</td>
        <td class="small">${admEscapeHtml(e.detail || "—")}</td>
      </tr>
    `;
  }).join("");
}

function renderParserErrorsTable() {
  const tbody = document.getElementById("admParserErrorsTbody");
  if (!tbody) return;
  if (_admParserErrors.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="small">✅ Κανένα καταγεγραμμένο σφάλμα parser.</td></tr>`;
    return;
  }
  tbody.innerHTML = _admParserErrors.map(e => `
    <tr>
      <td class="small">${admEscapeHtml(admFormatDate(e.ts))}</td>
      <td><strong>${admEscapeHtml(e.bankSource || "Unknown")}</strong></td>
      <td style="font-family:monospace;">.${admEscapeHtml(e.fileExt || "other")}</td>
      <td><span class="badge expense">${admEscapeHtml(e.errorCode || "PARSE_EXCEPTION")}</span></td>
      <td class="small">${admEscapeHtml(e.rowCountBucket || "0")}</td>
      <td class="small">${admEscapeHtml(e.appVersion || "—")}</td>
    </tr>
  `).join("");
}

async function admClearParserErrors() {
  if (!confirm("Εκκαθάριση όλων των ανώνυμων καταγραφών σφαλμάτων parser;")) return;
  try {
    await callAdminFunction("clearTelemetry", { target: "parserErrors" });
    showAdminBanner("🧹 Οι καταγραφές σφαλμάτων parser εκκαθαρίστηκαν.");
    await loadAdminOverview();
  } catch (err) {
    showAdminBanner(`⚠️ ${err?.message || "Σφάλμα εκκαθάρισης"}`, true);
  }
}

function switchAdminTab(tabKey) {
  const validTabs = ["overview", "rooms", "users", "security", "analytics", "health"];
  const target = validTabs.includes(tabKey) ? tabKey : "overview";
  _admActiveTab = target;
  document.querySelectorAll(".adm-tab-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.admTab === target);
  });
  document.querySelectorAll(".adm-tab-panel").forEach(panel => {
    panel.classList.toggle("active", panel.id === `admPanel-${target}`);
  });
  try { sessionStorage.setItem("fg_admin_tab", target); } catch {}
}

function admFormatBytes(bytes) {
  const b = Math.max(0, Number(bytes) || 0);
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(2)} MB`;
}

function renderInfraDashboard() {
  const infra = _admInfra || {};
  const setEl = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(text);
  };

  setEl("admInfraProjectRegion", `${infra.projectId || "financegr-sync"} • ${infra.region || "europe-west1"}`);
  setEl("admInfraRuntime", infra.runtime ? `Node.js ${infra.runtime}` : "Node.js 22");
  setEl("admInfraCostCap", `maxInstances: ${infra.maxInstances ?? 2} • ${infra.memory || "256MiB"} • ${infra.timeoutSeconds ?? 15}s`);
  setEl("admInfraRoomQuota", `${infra.maxRoomsPerUser ?? 5} rooms / χρήστη`);
  setEl(
    "admInfraBetaMode",
    infra.betaAllowlistActive
      ? `🔒 Ενεργή (${infra.betaAllowlistCount} emails)`
      : "🌐 Ανοιχτή (όλοι οι Google χρήστες)"
  );

  const metaBytes = infra.rtdbMetadataBytes || {};
  setEl(
    "admInfraRtdbSize",
    `${admFormatBytes(metaBytes.total || 0)} (Index: ${admFormatBytes(metaBytes.roomIndex || 0)})`
  );
  setEl("admInfraAdminCount", `${infra.adminEmailsCount ?? 1} λογαριασμός/οί`);
  setEl("admInfraServerTs", admFormatDate(infra.serverTimestamp || Date.now()));
}

async function probeCloudflareWorkerStatus() {
  const statusEl = document.getElementById("admCfLiveStatus");
  const latEl = document.getElementById("admCfLatency");
  const fxSrcEl = document.getElementById("admCfFxSource");
  const fxRatesEl = document.getElementById("admCfFxRates");
  const kpiSubEl = document.getElementById("admKpiCloudflareSub");
  const btn = document.getElementById("admProbeCfBtn");

  if (btn) btn.disabled = true;
  if (statusEl) statusEl.innerHTML = `<span class="badge">⏳ Έλεγχος...</span>`;

  try {
    const user = _admAuth?.currentUser;
    const idToken = user ? await user.getIdToken(false) : "";
    const workerUrl = typeof CF_QUOTES_WORKER_URL !== "undefined"
      ? CF_QUOTES_WORKER_URL
      : "https://financegr-quotes.tgoulis.workers.dev";

    const t0 = performance.now();
    const res = await fetch(`${workerUrl}/?endpoint=fx`, {
      headers: idToken ? { "Authorization": `Bearer ${idToken}` } : {}
    });
    const ms = Math.round(performance.now() - t0);
    const json = await res.json().catch(() => null);

    if (res.ok && json?.ratesToEur) {
      if (statusEl) statusEl.innerHTML = `<span class="badge income">🟢 Online (HTTP 200)</span>`;
      if (latEl) latEl.textContent = `${ms} ms`;
      if (fxSrcEl) fxSrcEl.textContent = `${json.source || "FX"} • ${json.asOf || "—"} (${json.freshnessStatus || "ok"})`;
      const r = json.ratesToEur;
      const parts = ["USD", "GBP", "CHF"]
        .filter(c => Number.isFinite(Number(r[c])) && Number(r[c]) > 0)
        .map(c => `1 ${c} = €${Number(r[c]).toFixed(4)}`);
      if (fxRatesEl) fxRatesEl.textContent = parts.join(" • ") || "Διαθέσιμο";
      if (kpiSubEl) kpiSubEl.textContent = `Cloudflare Worker: 🟢 Online (${ms}ms)`;
    } else {
      if (statusEl) statusEl.innerHTML = `<span class="badge expense">🔴 HTTP ${res.status}</span>`;
      if (latEl) latEl.textContent = `${ms} ms`;
      if (fxSrcEl) fxSrcEl.textContent = json?.error || "Σφάλμα απόκρισης";
      if (kpiSubEl) kpiSubEl.textContent = `Cloudflare Worker: ⚠️ HTTP ${res.status}`;
    }
  } catch (err) {
    if (statusEl) statusEl.innerHTML = `<span class="badge expense">🔴 Offline / Network</span>`;
    if (latEl) latEl.textContent = "—";
    if (fxSrcEl) fxSrcEl.textContent = err?.message || "Αδυναμία σύνδεσης";
    if (kpiSubEl) kpiSubEl.textContent = "Cloudflare Worker: 🔴 Offline";
  } finally {
    if (btn) btn.disabled = false;
  }
}

/* ==========================================================================
   11. SETTINGS, COUPLE MERGE, SHARE QR & EXPORT/IMPORT
   ========================================================================== */
function previewProfileSplit() {
  const mode = document.getElementById("splitMode")?.value || "auto";
  const wrap = document.getElementById("customSplitInputWrap");
  if (wrap) wrap.style.display = mode === "custom" ? "block" : "none";

  const pName = document.getElementById("partnerName")?.value.trim() || "";
  const pInc = Number(document.getElementById("partnerIncome")?.value) || 0;
  const uInc = Number(document.getElementById("monthlyIncome")?.value) || 0;

  if (!pName && pInc <= 0) {
    setTextSafe("profileSplitPreviewText", "Ατομικό προφίλ (100% Εσύ)");
    return;
  }
  let myPct = 50;
  if (mode === "custom") {
    const raw = Number(document.getElementById("customUserSharePct")?.value);
    myPct = Number.isFinite(raw) ? Math.min(100, Math.max(0, raw)) : 50;
  } else if (uInc + pInc > 0) {
    myPct = Number(((uInc / (uInc + pInc)) * 100).toFixed(1));
  }
  setTextSafe("profileSplitPreviewText", `Αναλογία κοινών εξόδων: Εσύ ${myPct}% • ${pName || "Σύντροφος"} ${(100 - myPct).toFixed(1)}%`);
}

function saveProfileSettings() {
  const payday = Math.min(31, Math.max(1, Number(document.getElementById("paydayDay").value) || 25));
  data.profile = {
    ...data.profile,
    userName: document.getElementById("userName").value.trim(),
    monthlyIncome: Math.max(0, Number(document.getElementById("monthlyIncome").value) || 0),
    savingGoal: Math.max(0, Number(document.getElementById("savingGoal").value) || 0),
    initialSavings: Math.max(0, Number(document.getElementById("initialSavings").value) || 0),
    paydayDay: payday,
    typicalPayday: payday,
    partnerName: document.getElementById("partnerName").value.trim(),
    partnerIncome: Math.max(0, Number(document.getElementById("partnerIncome").value) || 0),
    splitMode: document.getElementById("splitMode").value || "auto",
    customUserSharePct: (() => {
      const raw = document.getElementById("customUserSharePct").value;
      const n = raw === "" ? NaN : Number(raw);
      return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 50;
    })()
  };
  data.settings.stateUpdatedAt = Date.now();
  persist();
  render();
  showToast("💾 Οι ρυθμίσεις προφίλ αποθηκεύτηκαν!");
}

function unlinkPartnerProfile() {
  showModal(
    "Αποσύνδεση Συντρόφου; Οι ατομικές κινήσεις του συντρόφου θα αφαιρεθούν και το προφίλ θα επανέλθει σε 100% ατομικό.",
    true,
    (ok) => {
      if (!ok) return;
      const split = getCoupleSplit();
      data.transactions = (data.transactions || [])
        .filter(t => t.owner !== "partner" || t.isShared)
        .map(t => {
          if (t.isShared) {
            markTxDirty(t.id);
            return {
              ...t,
              owner: "me",
              amount: Number((((Number(t.amount) || 0) * split.myPct) / 100).toFixed(2)),
              isShared: false,
              paidBy: undefined,
              settled: false,
              _updatedAt: Date.now()
            };
          }
          return t;
        });
      data.profile.partnerName = "";
      data.profile.partnerIncome = 0;
      data.settings.memberView = "all";
      data.settings.stateUpdatedAt = Date.now();
      persist();
      render();
      showToast("🔓 Ο σύντροφος αποσυνδέθηκε καθαρά.");
    },
    "Αποσύνδεση Συντρόφου"
  );
}

function toggleMerchantRuleShared(key) {
  if (!key || !data.merchantRules?.[key]) return;
  data.merchantRules[key].isShared = !Boolean(data.merchantRules[key].isShared);
  data.settings.stateUpdatedAt = Date.now();
  persist();
  renderMerchantRulesManager();
  showToast(data.merchantRules[key].isShared
    ? `👫 Ο κανόνας «${key}» ορίστηκε ως Κοινό.`
    : `👤 Ο κανόνας «${key}» ορίστηκε ως Προσωπικό.`);
}

function renderMerchantRulesManager() {
  const container = document.getElementById("merchantRulesContainer");
  if (!container) return;
  const split = getCoupleSplit();
  const entries = Object.entries(data.merchantRules || {});
  if (entries.length === 0) {
    container.innerHTML = `<div class="small">Δεν έχουν απομνημονευτεί κανόνες εμπόρων ακόμα.</div>`;
    return;
  }
  container.innerHTML = entries.map(([key, rule]) => `
    <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; padding:6px 0; border-bottom:1px solid var(--border);">
      <div>
        <strong style="font-size:12px;">${escapeHtml(key)}</strong>
        <span class="badge">${escapeHtml(rule.category)}</span>
        ${rule.isShared ? '<span class="badge shared">👫 Κοινό</span>' : (split.hasPartner ? '<span class="badge">👤 Προσωπικό</span>' : "")}
      </div>
      <div style="display:flex; gap:4px; flex-shrink:0;">
        ${split.hasPartner ? `<button type="button" class="secondary small-btn" data-rulekey="${escapeHtml(key)}" onclick="toggleMerchantRuleShared(this.dataset.rulekey)" title="Εναλλαγή Κοινού / Προσωπικού" aria-label="Εναλλαγή κοινού">${rule.isShared ? "👤" : "👫"}</button>` : ""}
        <button type="button" class="danger small-btn" data-rulekey="${escapeHtml(key)}" onclick="deleteMerchantRule(this.dataset.rulekey)" aria-label="Διαγραφή κανόνα">✕</button>
      </div>
    </div>
  `).join("");
}

function deleteMerchantRule(key) {
  if (!key) return;
  delete data.merchantRules[key];
  data.settings.stateUpdatedAt = Date.now();
  persist();
  renderMerchantRulesManager();
}

function openCoupleMergeModal() {
  document.getElementById("coupleMergeModal").style.display = "flex";
}

function closeCoupleMergeModal() {
  document.getElementById("coupleMergeModal").style.display = "none";
}

function exportPartnerMergeFile(onlyShared = true) {
  const myTxs = (data.transactions || []).filter(t => (t.owner || "me") === "me" && (!onlyShared || t.isShared));
  const payload = {
    type: "FinanceGR_PartnerMerge",
    exportedAt: new Date().toISOString(),
    senderName: data.profile.userName || "Σύντροφος",
    senderIncome: Number(data.profile.monthlyIncome) || 0,
    transactions: myTxs
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  downloadBlob(blob, `FinanceGR-Partner-${today()}.json`);
  showToast("📤 Το αρχείο ενοποίησης κατέβηκε!");
}

function importPartnerMergeFile() {
  const inp = document.getElementById("partnerMergeFileInput");
  const file = inp?.files?.[0];
  if (!file) {
    showModal("Επίλεξε πρώτα το αρχείο .json του συντρόφου.");
    return;
  }
  if (file.size > 15 * 1024 * 1024) {
    showModal("Το αρχείο ξεπερνά το επιτρεπτό όριο (15MB).");
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const parsed = sanitizeJsonObject(JSON.parse(e.target.result));
      if (!Array.isArray(parsed.transactions)) throw new Error("INVALID");
      if (parsed.senderName && !data.profile.partnerName) {
        data.profile.partnerName = String(parsed.senderName).trim().slice(0, 60);
      }
      if (Number(parsed.senderIncome) > 0 && Number(data.profile.partnerIncome) === 0) {
        data.profile.partnerIncome = Number(parsed.senderIncome);
      }

      const localMap = new Map(data.transactions.map(t => [t.id, t]));
      let added = 0;

      parsed.transactions.forEach(t => {
        const cleanTx = sanitizeImportedTransaction(t);
        if (!cleanTx || data.deletedTxIds?.[cleanTx.id]) return;
        const flipped = { ...cleanTx, owner: "partner" };
        if (flipped.paidBy === "me") flipped.paidBy = "partner";
        else if (flipped.paidBy === "partner") flipped.paidBy = "me";

        if (!localMap.has(flipped.id)) {
          localMap.set(flipped.id, flipped);
          added++;
        }
      });

      data.transactions = Array.from(localMap.values());
      data.settings.stateUpdatedAt = Date.now();
      persist();
      closeCoupleMergeModal();
      render();
      showToast(`🤝 Συγχωνεύτηκαν ${added} νέες κινήσεις συντρόφου!`);
    } catch {
      showModal("Το αρχείο συντρόφου δεν είναι έγκυρο.");
    }
  };
  reader.readAsText(file);
}

function openShareModal() {
  const modal = document.getElementById("shareModal");
  const container = document.getElementById("qrCodeContainer");
  document.getElementById("shareUrlInput").value = OFFICIAL_SHARE_URL;
  if (container && typeof QRCode !== "undefined") {
    container.innerHTML = "";
    new QRCode(container, {
      text: OFFICIAL_SHARE_URL,
      width: 170,
      height: 170,
      colorDark: "#0f172a",
      colorLight: "#ffffff"
    });
  }
  modal.style.display = "flex";
}

function closeShareModal() {
  document.getElementById("shareModal").style.display = "none";
}

function copyShareUrl() {
  copyTextToClipboard(OFFICIAL_SHARE_URL);
  showToast("📋 Ο σύνδεσμος αντιγράφηκε!");
}

function shareSocial(platform) {
  const text = encodeURIComponent(`Δοκίμασε το FinanceGR — δωρεάν, 100% ιδιωτικό εργαλείο ελέγχου οικονομικών & τραπεζών: ${OFFICIAL_SHARE_URL}`);
  const urls = {
    whatsapp: `https://api.whatsapp.com/send?text=${text}`,
    viber: `viber://forward?text=${text}`,
    telegram: `https://t.me/share/url?url=${encodeURIComponent(OFFICIAL_SHARE_URL)}&text=${text}`
  };
  window.open(urls[platform], "_blank", "noopener");
}

function downloadQrCodePng() {
  const container = document.getElementById("qrCodeContainer");
  if (!container) return;
  const canvas = container.querySelector("canvas");
  if (canvas) {
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = "FinanceGR-QR.png";
    a.click();
    return;
  }
  const img = container.querySelector("img");
  if (img && img.src) {
    const a = document.createElement("a");
    a.href = img.src;
    a.download = "FinanceGR-QR.png";
    a.click();
  }
}

function exportJSON() {
  const exportCopy = deepClone(data);
  if (exportCopy.settings) {
    if (exportCopy.settings.cloudSync) {
      exportCopy.settings.cloudSync.pin = "";
      exportCopy.settings.cloudSync.roomPin = "";
    }
  }
  const blob = new Blob([JSON.stringify(exportCopy, null, 2)], { type: "application/json" });
  downloadBlob(blob, `FinanceGR-Backup-${today()}.json`);
  sessionHasUnsavedChanges = false;
  updateBackupStatusUI();
  showToast("⬇️ Το αρχείο JSON Backup κατέβηκε!");
}

function sanitizeImportedTransaction(rawTx) {
  if (!rawTx || typeof rawTx !== "object") return null;
  const dateIso = parseFlexibleDate(rawTx.date);
  const amount = Math.abs(Number(rawTx.amount) || 0);
  if (!dateIso || !Number.isFinite(amount) || amount <= 0 || amount > 1e9) return null;

  const validTypes = ["income", "expense", "saving", "withdrawal"];
  const type = validTypes.includes(rawTx.type) ? rawTx.type : "expense";
  const catRaw = String(rawTx.category || "").trim().slice(0, 60);
  const category = ALL_CATEGORIES.includes(catRaw) ? catRaw : (type === "income" ? "Άλλο Έσοδο" : "Άλλο");
  const description = String(rawTx.description || category).trim().slice(0, 200);

  return {
    id: typeof rawTx.id === "string" && rawTx.id.trim() ? rawTx.id.trim() : generateId("tx"),
    owner: rawTx.owner === "partner" ? "partner" : "me",
    type,
    category,
    amount: Number(amount.toFixed(2)),
    date: dateIso,
    description,
    originalBankDesc: typeof rawTx.originalBankDesc === "string" ? rawTx.originalBankDesc.slice(0, 250) : undefined,
    source: typeof rawTx.source === "string" ? rawTx.source.slice(0, 40) : "",
    unexpected: Boolean(rawTx.unexpected),
    isInternalTransfer: rawTx.isInternalTransfer ? true : undefined,
    isShared: Boolean(rawTx.isShared),
    paidBy: ["me", "partner", "split"].includes(rawTx.paidBy) ? rawTx.paidBy : undefined,
    settled: Boolean(rawTx.settled),
    recurringId: typeof rawTx.recurringId === "string" ? rawTx.recurringId : undefined,
    linkedGoalId: typeof rawTx.linkedGoalId === "string" ? rawTx.linkedGoalId : undefined,
    linkedAnnualBillId: typeof rawTx.linkedAnnualBillId === "string" ? rawTx.linkedAnnualBillId : undefined,
    linkedPortfolioAssetId: typeof rawTx.linkedPortfolioAssetId === "string" ? rawTx.linkedPortfolioAssetId : undefined,
    _updatedAt: Number(rawTx._updatedAt) || Date.now()
  };
}

const _num = (v, d = 0) => { v = Number(v); return Number.isFinite(v) ? v : d; };
const _str = (v, n = 80) => String(v ?? "").slice(0, n);
const _r2 = v => Number(v.toFixed(2));
const _sid = v => (typeof v === "string" && v.trim()) ? v.trim().slice(0, 60) : null;
const _clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, _num(v)));
const _isObj = o => o && typeof o === "object" && !Array.isArray(o);

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function csvCell(v) {
  let t = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;
  return `"${t.replace(/"/g, '""')}"`;
}

function cleanList(arr, fn) { return (Array.isArray(arr) ? arr : []).slice(0, 5000).map(x => _isObj(x) ? fn(x) : null).filter(Boolean); }
function cleanTsMap(o) { const out = {}; if (_isObj(o)) Object.entries(o).slice(0, 50000).forEach(([k, v]) => { const n = Number(v); if (k.length <= 80 && Number.isFinite(n)) out[k] = n; }); return out; }
function cleanFlags(o) { const out = {}; if (_isObj(o)) Object.entries(o).slice(0, 2000).forEach(([k, v]) => { if (v) out[k.slice(0, 80)] = true; }); return out; }
function cleanRules(o) { const out = {}; if (_isObj(o)) Object.entries(o).slice(0, 5000).forEach(([k, v]) => { if (_isObj(v) && ALL_CATEGORIES.includes(v.category)) out[k.slice(0, 80)] = { category: v.category, isShared: Boolean(v.isShared) }; }); return out; }
function cleanBudgets(o) { const out = {}; if (_isObj(o)) EXPENSE_CATEGORIES.forEach(c => { if (Object.prototype.hasOwnProperty.call(o, c)) out[c] = _clamp(o[c], 0, 1e9); }); return out; }
function cleanSettings(st) {
  const o = {};
  if (!_isObj(st)) return o;
  if (["month", "cycle", "year"].includes(st.periodMode)) o.periodMode = st.periodMode;
  if (["all", "me", "partner", "shared"].includes(st.memberView)) o.memberView = st.memberView;
  if (typeof st.planningSubfilter === "string") o.planningSubfilter = st.planningSubfilter.slice(0, 20);
  ["privacyMode", "darkMode", "firstUseDismissed", "firstUseCollapsed", "detectedSubsCollapsed", "onboardingCompleted"].forEach(k => { if (typeof st[k] === "boolean") o[k] = st[k]; });
  return o;
}
function cleanProfile(p) {
  const o = {};
  if (!_isObj(p)) return o;
  ["userName", "partnerName"].forEach(k => { if (typeof p[k] === "string") o[k] = p[k].trim().slice(0, 60); });
  ["monthlyIncome", "savingGoal", "initialSavings", "partnerIncome"].forEach(k => { if (p[k] !== undefined) o[k] = _clamp(p[k], 0, 1e9); });
  if (p.paydayDay !== undefined || p.typicalPayday !== undefined) { const d = Math.round(_clamp(p.paydayDay ?? p.typicalPayday, 1, 31)); o.paydayDay = d; o.typicalPayday = d; }
  if (["auto", "custom"].includes(p.splitMode)) o.splitMode = p.splitMode;
  if (p.customUserSharePct !== undefined && p.customUserSharePct !== "") o.customUserSharePct = _clamp(p.customUserSharePct, 0, 100);
  return o;
}
function cleanRecurring(r) {
  const id = _sid(r.id), amount = Math.abs(_num(r.amount));
  if (!id || !(amount > 0)) return null;
  const skipped = {};
  if (_isObj(r.skippedMonths)) Object.entries(r.skippedMonths).slice(0, 600).forEach(([k, v]) => { if (/^\d{4}-\d{2}$/.test(k) && v) skipped[k] = true; });
  return {
    id, title: _str(r.title), type: ["expense", "income", "saving"].includes(r.type) ? r.type : "expense",
    category: ALL_CATEGORIES.includes(r.category) ? r.category : "Άλλο", amount: _r2(Math.min(amount, 1e9)),
    day: Math.round(_clamp(r.day || 1, 1, 31)), isShared: Boolean(r.isShared), skippedMonths: skipped
  };
}
function cleanGoal(g) {
  const id = _sid(g.id), target = Math.abs(_num(g.target));
  if (!id || !(target > 0)) return null;
  return { id, title: _str(g.title), target: _r2(Math.min(target, 1e9)), saved: _r2(_clamp(g.saved, 0, 1e9)), targetDate: parseFlexibleDate(g.targetDate) || "" };
}
function cleanBill(b) {
  const id = _sid(b.id), amount = Math.abs(_num(b.amount)), due = parseFlexibleDate(b.dueDate);
  if (!id || !(amount > 0) || !due) return null;
  return {
    id, title: _str(b.title), amount: _r2(Math.min(amount, 1e9)), saved: _r2(_clamp(b.saved, 0, 1e9)), dueDate: due,
    category: EXPENSE_CATEGORIES.includes(b.category) ? b.category : "Λογαριασμοί"
  };
}
function cleanAsset(a) {
  const id = _sid(a.id), name = _str(a.name).trim();
  if (!id || !name) return null;
  const ticker = String(a.ticker || "").trim().toUpperCase();
  const out = {
    id, name, ticker: /^[A-Z0-9.:^=\-]{1,20}$/.test(ticker) ? ticker : "", type: _str(a.type || "ETF", 30),
    units: Number(_clamp(a.units, 0, 1e9).toFixed(8)), invested: _r2(_clamp(a.invested, 0, 1e12)), current: _r2(_clamp(a.current, 0, 1e12))
  };
  if (_num(a.lastUnitPriceEur) > 0) out.lastUnitPriceEur = _num(a.lastUnitPriceEur);
  if (_num(a.lastPriceUpdatedAt) > 0) out.lastPriceUpdatedAt = _num(a.lastPriceUpdatedAt);
  return out;
}
function sanitizeRemoteTx(raw) {
  const c = sanitizeImportedTransaction(raw);
  if (!c) return null;
  ["_originDeviceId", "_lastModifiedByDevice"].forEach(k => { if (typeof raw[k] === "string") c[k] = raw[k].slice(0, 80); });
  if (typeof raw._originName === "string") c._originName = raw._originName.slice(0, 60);
  if (raw._settlementPatch === true) c._settlementPatch = true;
  return c;
}

function importJSON() {
  const file = document.getElementById("importJsonFile")?.files?.[0];
  if (!file) {
    showModal("Επίλεξε πρώτα ένα αρχείο .json backup.");
    return;
  }
  if (file.size > 15 * 1024 * 1024) {
    showModal("Το αρχείο JSON ξεπερνά το επιτρεπτό όριο (15MB).");
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const parsed = sanitizeJsonObject(JSON.parse(e.target.result));
      if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.transactions)) {
        throw new Error("INVALID_JSON");
      }
      const seenIds = new Set();
      const validTxs = parsed.transactions.slice(0, 200000).map(sanitizeImportedTransaction).filter(t => t && !seenIds.has(t.id) && seenIds.add(t.id));

      showModal(
        `Επαναφορά JSON Backup (${validTxs.length} έγκυρες συναλλαγές); Τα τρέχοντα τοπικά δεδομένα θα αντικατασταθούν.`,
        true,
        (ok) => {
          if (!ok) return;
          const preservedSync = deepClone(data.settings?.cloudSync || {});
          const base = createDefaultState();
          data = {
            ...base,
            profile: { ...base.profile, ...cleanProfile(parsed.profile) },
            budgets: { ...base.budgets, ...cleanBudgets(parsed.budgets) },
            budgetsByView: {
              me: cleanBudgets(parsed.budgetsByView?.me),
              partner: cleanBudgets(parsed.budgetsByView?.partner),
              shared: cleanBudgets(parsed.budgetsByView?.shared)
            },
            transactions: validTxs,
            recurring: cleanList(parsed.recurring, cleanRecurring),
            goals: cleanList(parsed.goals, cleanGoal),
            annualBills: cleanList(parsed.annualBills, cleanBill),
            portfolioAssets: cleanList(parsed.portfolioAssets, cleanAsset),
            merchantRules: cleanRules(parsed.merchantRules),
            ignoredSubscriptions: Array.isArray(parsed.ignoredSubscriptions)
              ? cleanFlags(Object.fromEntries(parsed.ignoredSubscriptions.slice(0, 2000).map(k => [String(k), true])))
              : cleanFlags(parsed.ignoredSubscriptions),
            deletedTxIds: cleanTsMap(parsed.deletedTxIds),
            deletedEntityIds: cleanTsMap(parsed.deletedEntityIds),
            settings: {
              ...base.settings,
              ...cleanSettings(parsed.settings),
              deviceId: data.settings.deviceId,
              cloudSync: preservedSync
            }
          };
          data.settings.stateUpdatedAt = Date.now();
          fullSyncNeeded = true;
          persist();
          render();
          showToast(`✅ Το JSON Backup επαναφέρθηκε (${validTxs.length} συναλλαγές)!`);
        },
        "Επαναφορά Backup"
      );
    } catch {
      showModal("Το αρχείο JSON δεν είναι έγκυρο.");
    }
  };
  reader.readAsText(file);
}

function exportCSV() {
  const header = ["Ημερομηνία", "Τύπος", "Κατηγορία", "Ποσό", "Περιγραφή", "Πηγή", "Κοινό", "Πληρωμή Από", "Κάτοχος"];
  const rows = (data.transactions || []).map(t => [
    t.date || "",
    t.type || "expense",
    csvCell(t.category),
    (Number(t.amount) || 0).toFixed(2),
    csvCell(t.description),
    csvCell(t.source),
    t.isShared ? "Ναι" : "Όχι",
    csvCell(t.paidBy),
    t.owner || "me"
  ]);
  const csv = "\uFEFF" + [header.join(","), ...rows.map(r => r.join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  downloadBlob(blob, `FinanceGR-Transactions-${today()}.csv`);
  showToast("⬇️ Το CSV εξήχθη!");
}

function importCSV() {
  const file = document.getElementById("importCsvFile")?.files?.[0];
  if (!file) {
    showModal("Επίλεξε πρώτα ένα αρχείο .csv.");
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    showModal("Το αρχείο CSV ξεπερνά το επιτρεπτό όριο (5MB).");
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    const rows = parseDelimitedTextToMatrix(e.target.result);
    let count = 0;
    let skippedDups = 0;
    const consumedIds = new Set();
    for (let i = 1; i < Math.min(rows.length, 50001); i++) {
      const r = rows[i];
      if (!r || r.length < 4) continue;
      const dateIso = parseFlexibleDate(r[0]);
      const rawType = normalizeText(r[1]);
      const type = ["income", "expense", "saving", "withdrawal"].includes(rawType) ? rawType : "expense";
      const category = String(r[2] || "Άλλο").trim();
      const amount = Math.abs(parseFlexibleAmount(r[3]) || 0);
      const description = String(r[4] || category).trim();
      if (!dateIso || amount <= 0) continue;

      if (isDuplicateTransaction(dateIso, amount, description, "", [], consumedIds, type)) {
        skippedDups++;
        continue;
      }

      const cleanTx = sanitizeImportedTransaction({
        owner: String(r[8] || "me").trim(), type, category, amount, date: dateIso, description,
        source: String(r[5] || "").trim(), isShared: normalizeText(r[6]) === "ναι", paidBy: String(r[7] || "").trim()
      });
      if (!cleanTx) continue;
      data.transactions.push(cleanTx);
      markTxDirty(cleanTx.id);
      count++;
    }
    persist();
    render();
    showToast(`✅ Εισήχθησαν ${count} συναλλαγές από CSV${skippedDups > 0 ? ` (${skippedDups} διπλές παραλείφθηκαν)` : ""}!`);
  };
  reader.readAsText(file, "UTF-8");
}

function applyWelcomePersona(income, payday, savingGoal) {
  document.getElementById("welcomeIncome").value = income;
  document.getElementById("welcomePayday").value = payday;
  document.getElementById("welcomeSavingGoal").value = savingGoal;
  document.getElementById("welcomeUserName")?.focus();
}

function completeWelcomeSetup() {
  const payday = Math.min(31, Math.max(1, Number(document.getElementById("welcomePayday").value) || 25));
  data.profile.userName = document.getElementById("welcomeUserName").value.trim();
  data.profile.monthlyIncome = Math.max(0, Number(document.getElementById("welcomeIncome").value) || 0);
  data.profile.savingGoal = Math.max(0, Number(document.getElementById("welcomeSavingGoal").value) || 0);
  data.profile.paydayDay = payday;
  data.profile.typicalPayday = payday;
  data.settings.onboardingCompleted = true;
  data.settings.stateUpdatedAt = Date.now();
  document.getElementById("welcomeSetupModal").style.display = "none";
  persist();
  render();
}

function skipWelcomeSetup() {
  data.settings.onboardingCompleted = true;
  document.getElementById("welcomeSetupModal").style.display = "none";
  persist(true, true);
  render();
}

function confirmResetAllData() {
  const hasSync = Boolean(data.settings?.cloudSync?.enabled);
  const warningMsg =
    "Είσαι σίγουρος/η ότι θέλεις να διαγράψεις ΟΛΑ τα δεδομένα σου (συναλλαγές, προφίλ, προϋπολογισμούς, πάγια, κουμπαράδες, χαρτοφυλάκιο και κανόνες εμπόρων);\n\n" +
    "Η ενέργεια αυτή δεν αναιρείται (εκτός αν έχεις αποθηκεύσει αρχείο JSON Backup)." +
    (hasSync ? "\n\nℹ️ Το Live Cloud Sync θα αποσυνδεθεί τοπικά ώστε να μην επαναφορτωθούν τα παλιά δεδομένα." : "");

  showModal(warningMsg, true, (ok) => {
    if (!ok) return;
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      sessionStorage.removeItem(SESSION_PIN_KEY);
    } catch (e) {
      console.error("Error clearing storage:", e);
    }
    const fresh = createDefaultState();
    fresh.settings.onboardingCompleted = true;
    fresh.settings.darkMode = Boolean(data.settings?.darkMode);
    fresh.settings.privacyMode = Boolean(data.settings?.privacyMode);
    data = fresh;
    dirtyTxIds.clear();
    fullSyncNeeded = false;
    sessionHasUnsavedChanges = false;
    cloudSyncStatus = "idle";
    persist(true, true);
    switchTab("overview");
    render();
    showToast("🗑️ Όλα τα τοπικά δεδομένα διαγράφηκαν. Επαναφορά σε €0.");
  }, "⚠️ Διαγραφή Όλων των Δεδομένων");
}


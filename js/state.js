/* ==========================================================================
   1. CONSTANTS, DEFAULTS & STATE MANAGEMENT
   ========================================================================== */
const LEGACY_STORAGE_KEY = "personalFinanceDashboard_v5";
const STORAGE_KEY = "financeGR_v1_state";
const SESSION_PIN_KEY = "financeGR_session_pin";
const OFFICIAL_SHARE_URL = "https://thgoulis.github.io/FinanceGR/";
const FIREBASE_RTDB_URL = "https://financegr-sync-default-rtdb.europe-west1.firebasedatabase.app";

const EXPENSE_CATEGORIES = [
  "Στέγαση",
  "Λογαριασμοί",
  "Τρόφιμα",
  "Μεταφορές",
  "Υγεία",
  "Διασκέδαση",
  "Ανάληψη",
  "Έκτακτο έξοδο",
  "Άλλο"
];

const INCOME_CATEGORIES = [
  "Μισθός",
  "Bonus / Δώρο",
  "Επίδομα",
  "Επιστροφή Χρημάτων",
  "Επενδύσεις / Μερίσματα",
  "Άλλο Έσοδο"
];

const SAVING_CATEGORIES = [
  "Αποταμίευση",
  "Επένδυση",
  "Αποθεματικό Ασφαλείας",
  "Κουμπαράς Στόχου"
];

const ALL_CATEGORIES = Array.from(new Set([
  ...EXPENSE_CATEGORIES,
  ...INCOME_CATEGORIES,
  ...SAVING_CATEGORIES
]));

const NEEDS_CATEGORIES = ["Στέγαση", "Λογαριασμοί", "Τρόφιμα", "Μεταφορές", "Υγεία"];
const WANTS_CATEGORIES = ["Διασκέδαση", "Ανάληψη", "Έκτακτο έξοδο", "Άλλο"];

const BONUS_KEYWORDS = [
  "δωρο χριστουγεννων", "δωρο πασχα", "επιδομα αδειας", "δωρο", "bonus", "μπονους", "επιδομα"
];

const BONUS_KEYWORD_RE = /(?<![\p{L}\p{N}])(δωρο χριστουγεννων|δωρο πασχα|επιδομα αδειας|δωρο|bonus|μπονους|επιδομα)(?![\p{L}\p{N}])/u;
function hasBonusKeyword(norm) {
  return BONUS_KEYWORD_RE.test(String(norm || ""));
}

const GENERIC_BANK_WORDS = new Set([
  "αγορα", "καρτα", "καρτας", "πληρωμη", "pos", "iris", "μεταφορα",
  "χρεωση", "πιστωση", "απο", "προς", "eur", "gr", "card", "payment",
  "purchase", "transfer", "fee", "εμβασμα", "αναληψη", "atm", "web", "banking",
  "google", "pay", "apple", "contactless", "athina", "athens", "thessaloniki",
  "θεσσαλονικη", "αθηνα", "greece", "ελλας", "grc", "ae", "sa", "ltd", "oe", "ee", "ike", "ικε", "επε", "οε", "εε"
]);

function generateId(prefix = "id") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function sanitizeJsonObject(obj) {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeJsonObject);
  const clean = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
    clean[k] = sanitizeJsonObject(v);
  }
  return clean;
}

function createDefaultState() {
  const defaultBudgets = {};
  EXPENSE_CATEGORIES.forEach(c => { defaultBudgets[c] = 0; });
  return {
    profile: {
      userName: "",
      monthlyIncome: 0,
      savingGoal: 0,
      initialSavings: 0,
      paydayDay: 25,
      typicalPayday: 25,
      partnerName: "",
      partnerIncome: 0,
      splitMode: "auto",
      customUserSharePct: 50
    },
    budgets: defaultBudgets,
    budgetsByView: {
      me: {},
      partner: {},
      shared: {}
    },
    transactions: [],
    recurring: [],
    goals: [],
    annualBills: [],
    portfolioAssets: [],
    merchantRules: {},
    ignoredSubscriptions: {},
    deletedTxIds: {},
    deletedEntityIds: {},
    settings: {
      deviceId: generateId("dev"),
      stateUpdatedAt: 0,
      periodMode: "month",
      memberView: "all",
      planningSubfilter: "all",
      privacyMode: false,
      darkMode: false,
      firstUseDismissed: false,
      firstUseCollapsed: false,
      detectedSubsCollapsed: false,
      onboardingCompleted: false,
      cloudSync: {
        enabled: false,
        roomCode: "",
        rawRoomCode: "",
        pin: "",
        roomPin: "",
        sessionOnlyPin: false,
        mode: "solo",
        privacyScope: "fullHousehold",
        resolvedRoomPath: "",
        resolvedRecipeId: "orig_salt_v1_sha256",
        resolvedSaltPrefix: "",
        lastSyncedAt: 0,
        pendingPush: false
      },
      etfQuotesCache: {}
    }
  };
}

function hasMeaningfulStateData(obj) {
  if (!obj || typeof obj !== "object") return false;
  const txCount = Array.isArray(obj.transactions) ? obj.transactions.length : 0;
  const recCount = Array.isArray(obj.recurring) ? obj.recurring.length : 0;
  const goalCount = Array.isArray(obj.goals) ? obj.goals.length : 0;
  const assetCount = Array.isArray(obj.portfolioAssets) ? obj.portfolioAssets.length : 0;
  const hasName = Boolean(obj.profile?.userName && String(obj.profile.userName).trim());
  const hasIncome = Number(obj.profile?.monthlyIncome) > 0;
  const hasSync = Boolean(obj.settings?.cloudSync?.enabled && obj.settings?.cloudSync?.roomCode);
  return txCount > 0 || recCount > 0 || goalCount > 0 || assetCount > 0 || hasName || hasIncome || hasSync;
}

function getActiveCloudPin() {
  const cfg = data.settings?.cloudSync;
  if (!cfg) return "";
  if (cfg.sessionOnlyPin) {
    try {
      return sessionStorage.getItem(SESSION_PIN_KEY) || cfg.pin || cfg.roomPin || "";
    } catch {
      return cfg.pin || cfg.roomPin || "";
    }
  }
  return cfg.pin || cfg.roomPin || "";
}

function loadStateFromStorage() {
  const base = createDefaultState();
  try {
    let raw = localStorage.getItem(STORAGE_KEY);
    let parsed = raw ? sanitizeJsonObject(JSON.parse(raw)) : null;

    const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacyRaw) {
      try {
        const legacyParsed = sanitizeJsonObject(JSON.parse(legacyRaw));
        if (!parsed || !hasMeaningfulStateData(parsed)) {
          parsed = legacyParsed;
        }
      } catch {
        // Ignore malformed legacy storage
      }
    }

    if (!parsed) return base;
    const rawCloud = parsed.settings?.cloudSync || {};
    let sessionPin = "";
    try {
      sessionPin = sessionStorage.getItem(SESSION_PIN_KEY) || "";
    } catch {
      sessionPin = "";
    }
    const resolvedPin = rawCloud.sessionOnlyPin ? sessionPin : (rawCloud.pin || rawCloud.roomPin || "");
    const resolvedPayday = Number(parsed.profile?.paydayDay || parsed.profile?.typicalPayday) || 25;
    const normalizedIgnored = Array.isArray(parsed.ignoredSubscriptions)
      ? parsed.ignoredSubscriptions.reduce((acc, k) => { if (k) acc[k] = true; return acc; }, {})
      : (parsed.ignoredSubscriptions || {});

    return {
      ...base,
      ...parsed,
      profile: {
        ...base.profile,
        ...(parsed.profile || {}),
        paydayDay: resolvedPayday,
        typicalPayday: resolvedPayday
      },
      budgets: { ...base.budgets, ...(parsed.budgets || {}) },
      budgetsByView: {
        me: { ...(parsed.budgetsByView?.me || {}) },
        partner: { ...(parsed.budgetsByView?.partner || {}) },
        shared: { ...(parsed.budgetsByView?.shared || {}) }
      },
      transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
      recurring: Array.isArray(parsed.recurring) ? parsed.recurring : [],
      goals: Array.isArray(parsed.goals) ? parsed.goals : [],
      annualBills: Array.isArray(parsed.annualBills) ? parsed.annualBills : [],
      portfolioAssets: Array.isArray(parsed.portfolioAssets) ? parsed.portfolioAssets : [],
      merchantRules: parsed.merchantRules || {},
      ignoredSubscriptions: normalizedIgnored,
      deletedTxIds: parsed.deletedTxIds || {},
      deletedEntityIds: parsed.deletedEntityIds || {},
      settings: {
        ...base.settings,
        ...(parsed.settings || {}),
        cloudSync: {
          ...base.settings.cloudSync,
          ...rawCloud,
          pin: resolvedPin,
          roomPin: resolvedPin
        }
      }
    };
  } catch {
    return base;
  }
}

let data = loadStateFromStorage();
let sessionHasUnsavedChanges = false;
let localPersistenceStatus = "saved"; // saved | unsaved | error
let cloudSyncStatus = "idle"; // idle | syncing | synced | error | locked
let isCloudPullInFlight = false;
let isCloudPushInFlight = false;
let queuedPushAfterCurrent = false;
let dirtyTxIds = new Set();
let fullSyncNeeded = Boolean(data.settings?.cloudSync?.pendingPush);

let bankPreviewRows = [];
let detectedBankSource = "Τράπεζα";
let lastRawBankMatrix = [];
let lastRawBankFileName = "";
let categoryChartInstance = null;
let trendChartInstance = null;
let wealthChartInstance = null;
let portfolioChartInstance = null;
let txSearchDebounceTimer = null;
let bankSearchDebounceTimer = null;

function markTxDirty(txId) {
  if (txId) dirtyTxIds.add(String(txId));
}

function debouncedRenderTransactionsTable() {
  clearTimeout(txSearchDebounceTimer);
  txSearchDebounceTimer = setTimeout(() => renderTransactionsTable(), 150);
}

function debouncedRenderBankPreviewTable() {
  clearTimeout(bankSearchDebounceTimer);
  bankSearchDebounceTimer = setTimeout(() => renderBankPreviewTable(), 150);
}

function persist(skipRemotePush = false, skipSessionDirty = false) {
  let saved = false;
  try {
    if (!skipRemotePush && data.settings?.cloudSync?.enabled) {
      data.settings.cloudSync.pendingPush = true;
    }
    const copyToSave = deepClone(data);
    if (copyToSave.settings?.cloudSync) {
      const activePin = copyToSave.settings.cloudSync.pin || copyToSave.settings.cloudSync.roomPin || "";
      if (copyToSave.settings.cloudSync.sessionOnlyPin) {
        try {
          if (activePin) sessionStorage.setItem(SESSION_PIN_KEY, activePin);
        } catch {
          // Session-only PIN persistence is best effort; never copy it into localStorage.
        }
        copyToSave.settings.cloudSync.pin = "";
        copyToSave.settings.cloudSync.roomPin = "";
      } else {
        copyToSave.settings.cloudSync.pin = activePin;
        copyToSave.settings.cloudSync.roomPin = activePin;
      }
    }
    const serialized = JSON.stringify(copyToSave);
    // The current key is authoritative. Avoid writing the same full state twice.
    localStorage.setItem(STORAGE_KEY, serialized);
    saved = true;
    localPersistenceStatus = "saved";
    sessionHasUnsavedChanges = false;
    // Remove the duplicate legacy copy only after the canonical write succeeded.
    try { localStorage.removeItem(LEGACY_STORAGE_KEY); } catch { /* non-fatal cleanup */ }
  } catch (e) {
    localPersistenceStatus = "error";
    sessionHasUnsavedChanges = true;
    console.error("Failed to save state:", e);
    if (e && (e.name === "QuotaExceededError" || e.code === 22)) {
      showModal("⚠️ Ο χώρος αποθήκευσης του browser γέμισε! Κάνε εξαγωγή JSON Backup και διέγραψε παλιές περιττές κινήσεις.");
    } else {
      showToast("⚠️ Δεν αποθηκεύτηκαν οι αλλαγές τοπικά. Έλεγξε τις ρυθμίσεις αποθήκευσης του browser.");
    }
  }
  if (!skipSessionDirty && !saved) sessionHasUnsavedChanges = true;
  updateBackupStatusUI();
  if (saved && !skipRemotePush && data.settings?.cloudSync?.enabled) {
    // Remote sync is asynchronous; pendingPush remains true until the server confirms the write.
    pushCloudSyncNow();
  }
  return saved;
}

function recordEntityDeletion(id) {
  if (!id) return;
  if (!data.deletedEntityIds) data.deletedEntityIds = {};
  data.deletedEntityIds[id] = Date.now();
  data.settings.stateUpdatedAt = Date.now();
}

function updateBackupStatusUI() {
  const btn = document.getElementById("cloudSyncStatusBtn");
  if (!btn) return;
  const cfg = data.settings?.cloudSync;
  const isMobile = window.innerWidth <= 680;
  const activePin = getActiveCloudPin();

  if (localPersistenceStatus === "error") {
    btn.textContent = isMobile ? "⚠️" : "⚠️ Μη αποθηκευμένο τοπικά";
  } else if (cfg?.enabled && cfg.roomCode) {
    if (cfg.sessionOnlyPin && !activePin) {
      btn.textContent = isMobile ? "🔒" : "🔒 Ξεκλείδωμα Sync";
    } else if (cloudSyncStatus === "syncing") {
      btn.textContent = isMobile ? "🔄" : "🔄 Συγχρονισμός...";
    } else if (cloudSyncStatus === "error" || cfg.pendingPush) {
      btn.textContent = isMobile ? "⚠️" : (cfg.pendingPush ? "⏳ Εκκρεμεί Sync" : "⚠️ Cloud Σφάλμα");
    } else {
      btn.textContent = isMobile ? "☁️" : `☁️ Sync (${cfg.roomCode})`;
    }
  } else {
    btn.textContent = isMobile ? "💾" : (sessionHasUnsavedChanges ? "💾 Εκκρεμεί αποθήκευση" : "💾 Τοπικά αποθηκευμένο");
  }
}

/* ==========================================================================
   2. HELPERS, MODALS, TOASTS & FORMATTING
   ========================================================================== */
function setTextSafe(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function money(val) {
  const num = Number(val) || 0;
  return new Intl.NumberFormat("el-GR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(num);
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeText(str) {
  return String(str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function currentYearMonth() {
  return today().slice(0, 7);
}

function parseIsoDate(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function addDaysIso(iso, deltaDays) {
  const d = parseIsoDate(iso);
  if (!d) return iso;
  d.setDate(d.getDate() + deltaDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysBetweenIso(isoA, isoB) {
  const a = parseIsoDate(isoA);
  const b = parseIsoDate(isoB);
  if (!a || !b) return 999;
  return Math.round(Math.abs(a - b) / 86400000);
}

function showModal(message, isConfirm = false, callback = null, title = "Επιβεβαίωση") {
  const modal = document.getElementById("customModal");
  if (!modal) return;
  setTextSafe("customModalTitle", title);
  setTextSafe("customModalMessage", message);

  const okBtn = document.getElementById("customModalOk");
  const cancelBtn = document.getElementById("customModalCancel");
  if (cancelBtn) cancelBtn.style.display = isConfirm ? "inline-flex" : "none";
  modal.style.display = "flex";

  const closeAndRun = (res) => {
    modal.style.display = "none";
    if (callback) callback(res);
  };

  if (okBtn) {
    okBtn.onclick = () => closeAndRun(true);
    setTimeout(() => okBtn.focus(), 40);
  }
  if (cancelBtn) cancelBtn.onclick = () => closeAndRun(false);
}

function showToast(msg) {
  const container = document.getElementById("toastContainer");
  if (!container) return;
  const el = document.createElement("div");
  el.className = "toast-msg";
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transition = "opacity 0.25s ease";
    setTimeout(() => el.remove(), 260);
  }, 2800);
}

function copyTextToClipboard(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(ta);
  return ok;
}


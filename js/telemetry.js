/* ==========================================================================
   ZERO-KNOWLEDGE PRODUCT ANALYTICS & ANONYMOUS PARSER ERROR TELEMETRY
   - Zero PII, zero financial figures, zero descriptions, zero filenames.
   - Respects user opt-out (data.settings.anonymousTelemetryEnabled).
   ========================================================================== */
const FINANCEGR_APP_VERSION = "v31";

function isAnonymousTelemetryEnabled() {
  if (typeof data === "undefined" || !data || !data.settings) return true;
  return data.settings.anonymousTelemetryEnabled !== false;
}

function getTelemetryEndpointUrl() {
  const baseUrl = String(window.FINANCEGR_FIREBASE_CONFIG?.functionsBaseUrl || "").replace(/\/+$/, "");
  return baseUrl ? `${baseUrl}/logTelemetry` : "";
}

function postTelemetrySilently(payload) {
  try {
    if (!isAnonymousTelemetryEnabled()) return;
    if (typeof fetch !== "function") return;
    const url = getTelemetryEndpointUrl();
    if (!url) return;
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true
    }).catch(() => {});
  } catch {
    // Telemetry must never interrupt user flows
  }
}

function trackZeroKnowledgeEvent(eventName, { oncePerSession = false } = {}) {
  const allowed = ["session_start", "onboarding_completed", "demo_loaded", "bank_import_success", "cloud_sync_connected"];
  if (!allowed.includes(eventName)) return;
  if (oncePerSession) {
    try {
      const k = `fg_zk_evt_${eventName}`;
      if (sessionStorage.getItem(k)) return;
      sessionStorage.setItem(k, "1");
    } catch {}
  }
  postTelemetrySilently({ kind: "analytics", event: eventName });
}

function normalizeTelemetryBankSource(raw) {
  const s = String(raw || "").trim();
  const allowed = ["Πειραιώς", "Εθνική", "Alpha Bank", "Eurobank", "Revolut", "Viva Wallet", "Τράπεζα"];
  if (allowed.includes(s)) return s;
  const low = s.toLowerCase();
  if (low.includes("πειραι") || low.includes("piraeus")) return "Πειραιώς";
  if (low.includes("εθνικ") || low.includes("nbg")) return "Εθνική";
  if (low.includes("alpha")) return "Alpha Bank";
  if (low.includes("eurobank")) return "Eurobank";
  if (low.includes("revolut")) return "Revolut";
  if (low.includes("viva")) return "Viva Wallet";
  return "Unknown";
}

function reportAnonymousParserError({ bankSource = "Unknown", fileName = "", errorCode = "PARSE_EXCEPTION", rowCount = 0 } = {}) {
  const extMatch = String(fileName || "").toLowerCase().match(/\.([a-z0-9]+)$/);
  const ext = extMatch && ["xlsx", "xls", "csv"].includes(extMatch[1]) ? extMatch[1] : "other";
  const count = Math.max(0, Number(rowCount) || 0);
  const rowCountBucket = count === 0 ? "0" : (count <= 50 ? "1-50" : (count <= 200 ? "51-200" : "200+"));
  const allowedCodes = ["FILE_TOO_LARGE", "PARSE_EXCEPTION", "ZERO_ROWS_DETECTED", "COLUMN_MAP_FALLBACK"];
  const safeCode = allowedCodes.includes(errorCode) ? errorCode : "PARSE_EXCEPTION";

  postTelemetrySilently({
    kind: "parser_error",
    bankSource: normalizeTelemetryBankSource(bankSource),
    fileExt: ext,
    errorCode: safeCode,
    rowCountBucket,
    appVersion: FINANCEGR_APP_VERSION
  });
}

function toggleAnonymousTelemetry(checked) {
  if (!data || !data.settings) return;
  data.settings.anonymousTelemetryEnabled = Boolean(checked);
  data.settings.stateUpdatedAt = Date.now();
  persist(true, true);
  showToast(
    data.settings.anonymousTelemetryEnabled
      ? "✅ Ανώνυμο telemetry ενεργοποιήθηκε (0 προσωπικά δεδομένα)."
      : "🔒 Ανώνυμο telemetry απενεργοποιήθηκε."
  );
}

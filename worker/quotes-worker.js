/**
 * FinanceGR Quotes & FX Worker (Sprint 2 — Market Data Reliability)
 * - No hardcoded FX fallback rates
 * - Explicit FX contract with source, asOf, fetchedAt, stale (6h fresh, 6-24h stale, >24h expired/unavailable)
 * - Strict symbol & response validation, timeouts, bounded retries, provider fallback
 */

const ALLOWED_ORIGINS = new Set([
  "https://thgoulis.github.io",
  "http://localhost:3000",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "http://127.0.0.1:8080",
  "http://127.0.0.1:4173",
  "http://localhost:4173"
]);

const SYMBOL_REGEX = /^[A-Z0-9.:^=-]{1,20}$/;
const SUPPORTED_CURRENCIES = new Set(["EUR", "USD", "GBP", "GBPENCE", "GBX", "CHF"]);
const FX_FRESH_MAX_MS = 6 * 60 * 60 * 1000;
const FX_STALE_MAX_MS = 24 * 60 * 60 * 1000;
const QUOTE_CACHE_TTL_MS = 60 * 1000;
const FX_CACHE_TTL_MS = 10 * 60 * 1000;

// Isolate-level caches & per-user sliding-window rate limiter
const memQuoteCache = new Map();
const memFxCache = { data: null, cachedAt: 0 };
const memRateLimits = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_PER_MIN = 30;

function checkUserRateLimit(uid, env) {
  const maxPerMin = Number(env?.RATE_LIMIT_PER_MINUTE || RATE_LIMIT_MAX_PER_MIN);
  const limit = Number.isFinite(maxPerMin) && maxPerMin >= 1 ? Math.floor(maxPerMin) : RATE_LIMIT_MAX_PER_MIN;
  const now = Date.now();
  const key = String(uid || "anon");
  const entry = memRateLimits.get(key);

  if (!entry || (now - entry.windowStart) >= RATE_LIMIT_WINDOW_MS) {
    // Periodic pruning so map never grows unbounded
    if (memRateLimits.size > 500) {
      for (const [k, v] of memRateLimits.entries()) {
        if ((now - v.windowStart) >= RATE_LIMIT_WINDOW_MS) memRateLimits.delete(k);
      }
    }
    memRateLimits.set(key, { windowStart: now, count: 1 });
    return { allowed: true, remaining: limit - 1, retryAfterSec: 0 };
  }

  if (entry.count >= limit) {
    const retryAfterSec = Math.max(1, Math.ceil((RATE_LIMIT_WINDOW_MS - (now - entry.windowStart)) / 1000));
    return { allowed: false, remaining: 0, retryAfterSec };
  }

  entry.count += 1;
  return { allowed: true, remaining: limit - entry.count, retryAfterSec: 0 };
}

function getCorsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  const allowedOrigin = ALLOWED_ORIGINS.has(origin) ? origin : "https://thgoulis.github.io";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Vary": "Origin"
  };
}

function jsonResponse(bodyObj, status = 200, request = null, extraHeaders = {}) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...(request ? getCorsHeaders(request) : {}),
    ...extraHeaders
  };
  return new Response(JSON.stringify(bodyObj), { status, headers });
}

async function fetchWithTimeoutAndRetry(url, { timeoutMs = 6000, retries = 1 } = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "FinanceGR-Worker/2.0",
          "Accept": "application/json"
        }
      });
      clearTimeout(timer);
      if (!res.ok) {
        lastErr = new Error(`Upstream HTTP ${res.status}`);
        lastErr.httpStatus = res.status;
        if (res.status >= 500 && attempt < retries) continue;
        throw lastErr;
      }
      return await res.json();
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 150 * (attempt + 1)));
      }
    }
  }
  throw lastErr || new Error("Upstream request failed");
}

function normalizeCurrencyCode(rawCurr) {
  const trimmed = String(rawCurr || "").trim();
  const upper = trimmed.toUpperCase();
  if (trimmed === "GBp" || upper === "GBX" || upper === "GBPENCE") return "GBPENCE";
  if (upper === "EUR") return "EUR";
  if (upper === "USD") return "USD";
  if (upper === "GBP") return "GBP";
  if (upper === "CHF") return "CHF";
  return "";
}

function evaluateFxFreshness(fetchedAtIso, asOfDateStr) {
  const nowMs = Date.now();
  let refMs = Date.parse(fetchedAtIso || "");
  if (!Number.isFinite(refMs) && typeof asOfDateStr === "string" && /^\d{4}-\d{2}-\d{2}$/.test(asOfDateStr)) {
    refMs = Date.parse(`${asOfDateStr}T16:00:00Z`);
  }
  if (!Number.isFinite(refMs)) {
    return { status: "unavailable", stale: true, ageHours: null };
  }
  const ageMs = Math.max(0, nowMs - refMs);
  const ageHours = Number((ageMs / (60 * 60 * 1000)).toFixed(2));
  if (ageMs <= FX_FRESH_MAX_MS) {
    return { status: "fresh", stale: false, ageHours };
  }
  if (ageMs <= FX_STALE_MAX_MS) {
    return { status: "stale", stale: true, ageHours };
  }
  return { status: "expired", stale: true, ageHours };
}

async function fetchFrankfurterFxToEur() {
  const payload = await fetchWithTimeoutAndRetry(
    "https://api.frankfurter.app/latest?from=EUR&to=USD,GBP,CHF",
    { timeoutMs: 5000, retries: 1 }
  );
  if (!payload || typeof payload !== "object" || !payload.rates || typeof payload.rates !== "object") {
    throw new Error("Invalid Frankfurter FX response");
  }
  const ratesToEur = { EUR: 1 };
  for (const ccy of ["USD", "GBP", "CHF"]) {
    const eurPerUnit = Number(payload.rates[ccy]);
    // Frankfurter returns foreign currency units per 1 EUR (e.g. 1 EUR = 1.08 USD -> 1 USD = 1 / 1.08 EUR)
    if (!Number.isFinite(eurPerUnit) || !(eurPerUnit > 0)) {
      throw new Error(`Invalid Frankfurter rate for ${ccy}`);
    }
    ratesToEur[ccy] = Number((1 / eurPerUnit).toFixed(8));
  }
  const asOf = typeof payload.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(payload.date)
    ? payload.date
    : new Date().toISOString().slice(0, 10);
  const fetchedAt = new Date().toISOString();
  const freshness = evaluateFxFreshness(fetchedAt, asOf);

  return {
    success: true,
    baseCurrency: "EUR",
    ratesToEur,
    source: "frankfurter",
    asOf,
    fetchedAt,
    stale: freshness.stale,
    freshnessStatus: freshness.status
  };
}

async function fetchYahooFxToEur() {
  const pairs = [
    { ccy: "USD", yahooSym: "EURUSD=X", invert: true },
    { ccy: "GBP", yahooSym: "EURGBP=X", invert: true },
    { ccy: "CHF", yahooSym: "EURCHF=X", invert: true }
  ];
  const ratesToEur = { EUR: 1 };
  let latestTs = 0;

  for (const item of pairs) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(item.yahooSym)}?range=1d&interval=1d`;
    const json = await fetchWithTimeoutAndRetry(url, { timeoutMs: 5000, retries: 1 });
    const meta = json?.chart?.result?.[0]?.meta;
    const px = Number(meta?.regularMarketPrice);
    if (!Number.isFinite(px) || !(px > 0)) {
      throw new Error(`Invalid Yahoo FX rate for ${item.yahooSym}`);
    }
    const rate = item.invert ? (1 / px) : px;
    if (!Number.isFinite(rate) || !(rate > 0)) {
      throw new Error(`Computed invalid EUR rate for ${item.ccy}`);
    }
    ratesToEur[item.ccy] = Number(rate.toFixed(8));
    const mTime = Number(meta?.regularMarketTime);
    if (Number.isFinite(mTime) && mTime > latestTs) latestTs = mTime * 1000;
  }

  const fetchedAt = new Date().toISOString();
  const asOfDate = new Date(latestTs > 0 ? latestTs : Date.now()).toISOString().slice(0, 10);
  const freshness = evaluateFxFreshness(fetchedAt, asOfDate);

  return {
    success: true,
    baseCurrency: "EUR",
    ratesToEur,
    source: "yahoo-finance",
    asOf: asOfDate,
    fetchedAt,
    stale: freshness.stale,
    freshnessStatus: freshness.status
  };
}

async function getFxRatesToEur() {
  const now = Date.now();
  if (memFxCache.data && (now - memFxCache.cachedAt) < FX_CACHE_TTL_MS) {
    const freshCheck = evaluateFxFreshness(memFxCache.data.fetchedAt, memFxCache.data.asOf);
    if (freshCheck.status === "fresh" || freshCheck.status === "stale") {
      return {
        ...memFxCache.data,
        stale: freshCheck.stale,
        freshnessStatus: freshCheck.status,
        cached: true
      };
    }
  }

  let fx = null;
  try {
    fx = await fetchFrankfurterFxToEur();
  } catch (errPrimary) {
    console.warn("Primary FX provider failed:", errPrimary?.message || errPrimary);
    fx = await fetchYahooFxToEur();
  }

  const freshCheck = evaluateFxFreshness(fx.fetchedAt, fx.asOf);
  if (freshCheck.status !== "fresh" && freshCheck.status !== "stale") {
    throw new Error("FX rates expired or unavailable");
  }

  const normalized = {
    success: true,
    baseCurrency: "EUR",
    ratesToEur: fx.ratesToEur,
    source: fx.source,
    asOf: fx.asOf,
    fetchedAt: fx.fetchedAt,
    stale: freshCheck.stale,
    freshnessStatus: freshCheck.status
  };
  memFxCache.data = normalized;
  memFxCache.cachedAt = now;
  return normalized;
}

async function fetchYahooQuoteRaw(symbol) {
  const encoded = encodeURIComponent(symbol);
  const candidateUrls = [
    `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?range=1d&interval=5m`,
    `https://query2.finance.yahoo.com/v8/finance/chart/${encoded}?range=5d&interval=1d`
  ];
  let json = null;
  let lastErr = null;
  for (const url of candidateUrls) {
    try {
      json = await fetchWithTimeoutAndRetry(url, { timeoutMs: 6500, retries: 1 });
      if (json?.chart?.result?.[0]?.meta) break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!json?.chart?.result?.[0]?.meta) {
    throw lastErr || new Error("Missing chart meta");
  }
  const result = json?.chart?.result?.[0];
  const meta = result?.meta;
  if (!meta) throw new Error("Missing chart meta");

  const price = Number(meta.regularMarketPrice);
  const prevClose = Number(meta.previousClose ?? meta.chartPreviousClose);
  const normCurrency = normalizeCurrencyCode(meta.currency);

  if (!Number.isFinite(price) || !(price > 0)) {
    throw new Error("Invalid market price");
  }
  if (!normCurrency || !SUPPORTED_CURRENCIES.has(normCurrency)) {
    throw new Error(`Unsupported currency: ${meta.currency || "unknown"}`);
  }

  const returnedSymbol = String(meta.symbol || "").trim().toUpperCase();
  if (returnedSymbol && returnedSymbol !== symbol) {
    const mismatchErr = new Error(`Ασυμφωνία ticker (ζητήθηκε ${symbol}, επεστράφη ${returnedSymbol})`);
    mismatchErr.httpStatus = 404;
    throw mismatchErr;
  }

  const marketTimeMs = Number(meta.regularMarketTime) > 0
    ? Number(meta.regularMarketTime) * 1000
    : Date.now();

  return {
    ticker: returnedSymbol || symbol,
    name: String(meta.shortName || meta.longName || meta.symbol || symbol),
    exchange: String(meta.exchangeName || ""),
    price,
    previousClose: Number.isFinite(prevClose) && prevClose > 0 ? prevClose : null,
    currency: normCurrency,
    marketTime: new Date(marketTimeMs).toISOString(),
    source: "yahoo-finance"
  };
}


const FIREBASE_PROJECT_ID = "financegr-sync";
const FIREBASE_JWK_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
let _cachedJwks = { keys: null, fetchedAt: 0 };

function base64UrlToUint8Array(b64url) {
  const pad = b64url.length % 4 ? "=".repeat(4 - (b64url.length % 4)) : "";
  const b64 = (b64url + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function getFirebasePublicJwks() {
  const now = Date.now();
  if (_cachedJwks.keys && (now - _cachedJwks.fetchedAt) < 60 * 60 * 1000) {
    return _cachedJwks.keys;
  }
  const data = await fetchWithTimeoutAndRetry(FIREBASE_JWK_URL, { timeoutMs: 5000, retries: 1 });
  const keys = Array.isArray(data?.keys) ? data.keys : [];
  if (!keys.length) throw new Error("Unable to load Firebase public JWKs");
  _cachedJwks = { keys, fetchedAt: now };
  return keys;
}

async function verifyFirebaseGoogleToken(request, env) {
  if (env && String(env.REQUIRE_GOOGLE_AUTH).toLowerCase() === "false") {
    return { ok: true, bypassed: true };
  }
  const authHeader = request.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return { ok: false, status: 401, error: "Απαιτείται σύνδεση με Google (Missing Bearer token)" };
  }
  const token = authHeader.slice(7).trim();
  const parts = token.split(".");
  if (parts.length !== 3) {
    return { ok: false, status: 401, error: "Μη έγκυρο Firebase token" };
  }

  try {
    const header = JSON.parse(new TextDecoder().decode(base64UrlToUint8Array(parts[0])));
    const payload = JSON.parse(new TextDecoder().decode(base64UrlToUint8Array(parts[1])));
    const nowSec = Math.floor(Date.now() / 1000);

    if (header.alg !== "RS256" || !header.kid) {
      return { ok: false, status: 401, error: "Μη υποστηριζόμενος αλγόριθμος token" };
    }
    if (payload.aud !== FIREBASE_PROJECT_ID || payload.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`) {
      return { ok: false, status: 401, error: "Μη έγκυρος εκδότης/project token" };
    }
    if (!Number.isFinite(payload.exp) || payload.exp <= nowSec) {
      return { ok: false, status: 401, error: "Η συνεδρία Google έληξε" };
    }
    if (!payload.sub || typeof payload.sub !== "string") {
      return { ok: false, status: 401, error: "Μη έγκυρο uid χρήστη" };
    }

    const jwks = await getFirebasePublicJwks();
    const jwk = jwks.find(k => k.kid === header.kid);
    if (!jwk) {
      return { ok: false, status: 401, error: "Άγνωστο κλειδί υπογραφής Firebase" };
    }

    const cryptoKey = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );
    const sigBytes = base64UrlToUint8Array(parts[2]);
    const signingInput = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const validSig = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", cryptoKey, sigBytes, signingInput);
    if (!validSig) {
      return { ok: false, status: 401, error: "Μη έγκυρη υπογραφή token" };
    }

    const provider = String(payload?.firebase?.sign_in_provider || "");
    if (provider !== "google.com") {
      return { ok: false, status: 403, error: "Απαιτείται σύνδεση με λογαριασμό Google" };
    }
    if (payload.email_verified !== true) {
      return { ok: false, status: 403, error: "Απαιτείται επιβεβαιωμένο email Google" };
    }

    const allowListRaw = String(env?.ALLOWED_EMAILS || "").trim();
    if (allowListRaw) {
      const allowedSet = new Set(allowListRaw.split(",").map(s => s.trim().toLowerCase()).filter(Boolean));
      const callerEmail = String(payload.email || "").trim().toLowerCase();
      if (!callerEmail || !allowedSet.has(callerEmail)) {
        return { ok: false, status: 403, error: "Μη εξουσιοδοτημένος λογαριασμός για αναζήτηση τιμών" };
      }
    }

    return { ok: true, uid: payload.sub, email: payload.email || "" };
  } catch (err) {
    return { ok: false, status: 401, error: err?.message || "Αποτυχία επαλήθευσης token" };
  }
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: getCorsHeaders(request) });
    }
    if (request.method !== "GET") {
      return jsonResponse({ success: false, error: "Method not allowed" }, 405, request);
    }

    const authCheck = await verifyFirebaseGoogleToken(request, env);
    if (!authCheck.ok) {
      return jsonResponse({ success: false, error: authCheck.error }, authCheck.status || 401, request);
    }

    if (!authCheck.bypassed) {
      const rl = checkUserRateLimit(authCheck.uid, env);
      if (!rl.allowed) {
        return jsonResponse(
          { success: false, error: `Υπέρβαση ορίου αιτημάτων (${rl.retryAfterSec}s). Δοκίμασε ξανά σε λίγο.` },
          429,
          request,
          { "Retry-After": String(rl.retryAfterSec) }
        );
      }
    }

    const url = new URL(request.url);
    const symbolParam = (url.searchParams.get("symbol") || "").trim().toUpperCase();
    const endpoint = (url.searchParams.get("endpoint") || "").trim().toLowerCase();

    try {
      if (endpoint === "fx" || (!symbolParam && url.searchParams.has("fx"))) {
        const fxData = await getFxRatesToEur();
        return jsonResponse(fxData, 200, request);
      }

      if (!symbolParam || !SYMBOL_REGEX.test(symbolParam)) {
        return jsonResponse(
          { success: false, error: "Invalid or missing symbol parameter" },
          400,
          request
        );
      }

      const now = Date.now();
      const memCached = memQuoteCache.get(symbolParam);
      if (memCached && (now - memCached.cachedAt) < QUOTE_CACHE_TTL_MS) {
        return jsonResponse({ ...memCached.payload, cached: true }, 200, request);
      }

      const rawQuote = await fetchYahooQuoteRaw(symbolParam);

      let fxInfo = null;
      let priceEur = null;
      if (rawQuote.currency === "EUR") {
        priceEur = rawQuote.price;
        fxInfo = {
          available: true,
          source: "direct-eur",
          asOf: new Date().toISOString().slice(0, 10),
          fetchedAt: new Date().toISOString(),
          stale: false,
          freshnessStatus: "fresh"
        };
      } else {
        const fxRates = await getFxRatesToEur();
        const fxKey = rawQuote.currency === "GBPENCE" ? "GBP" : rawQuote.currency;
        const rateToEur = Number(fxRates.ratesToEur?.[fxKey]);
        if (!Number.isFinite(rateToEur) || !(rateToEur > 0)) {
          return jsonResponse(
            {
              success: false,
              ticker: rawQuote.ticker,
              currency: rawQuote.currency,
              price: rawQuote.price,
              fxStatus: "unavailable",
              error: `FX rate to EUR unavailable for ${rawQuote.currency}`
            },
            503,
            request
          );
        }
        const effectiveRate = rawQuote.currency === "GBPENCE" ? (rateToEur / 100) : rateToEur;
        priceEur = Number((rawQuote.price * effectiveRate).toFixed(6));
        fxInfo = {
          available: true,
          source: fxRates.source,
          asOf: fxRates.asOf,
          fetchedAt: fxRates.fetchedAt,
          stale: fxRates.stale,
          freshnessStatus: fxRates.freshnessStatus
        };
      }

      const payload = {
        success: true,
        ticker: rawQuote.ticker,
        name: rawQuote.name,
        exchange: rawQuote.exchange,
        price: rawQuote.price,
        currency: rawQuote.currency,
        priceEur: Number(priceEur.toFixed(6)),
        previousClose: rawQuote.previousClose,
        marketTime: rawQuote.marketTime,
        source: rawQuote.source,
        fx: fxInfo,
        stale: Boolean(fxInfo?.stale)
      };

      memQuoteCache.set(symbolParam, { payload, cachedAt: now });
      return jsonResponse(payload, 200, request);
    } catch (err) {
      console.error("Worker error:", err?.message || err);
      const status = err?.httpStatus === 404 ? 404 : 502;
      return jsonResponse(
        {
          success: false,
          error: status === 404
            ? `Δεν βρέθηκε το ticker «${symbolParam}» στο Yahoo Finance (${err?.message || "404"})`
            : (err?.message || "Market data unavailable"),
          fxStatus: status === 404 ? undefined : "unavailable"
        },
        status,
        request
      );
    }
  }
};

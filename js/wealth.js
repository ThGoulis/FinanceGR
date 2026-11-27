/* ==========================================================================
   9. PORTFOLIO (CLOUDFLARE WORKER LIVE QUOTES), ANALYTICS, FIRE & E-RECEIPTS
   ========================================================================== */
const CF_QUOTES_WORKER_URL = "https://financegr-quotes.tgoulis.workers.dev";
let activePortfolioFilter = "all";
let lastTestedQuote = null;

function ensureGoogleLoginForTicker(interactive = true) {
  if (typeof isGoogleAccountSignedIn === "function" && isGoogleAccountSignedIn()) {
    return true;
  }
  if (interactive) {
    showModal(
      "Ο έλεγχος Ticker και η ζωντανή ενημέρωση τιμών αγοράς απαιτούν σύνδεση με λογαριασμό Google, για την προστασία της υπηρεσίας από κακοπροαίρετη χρήση.\n\nΘέλεις να συνδεθείς τώρα με Google;",
      true,
      (ok) => {
        if (ok && typeof signInWithGoogleFirebase === "function") {
          signInWithGoogleFirebase();
        }
      },
      "🔒 Απαιτείται Σύνδεση Google"
    );
  }
  return false;
}

function toggleTickerLookupBox() {
  const box = document.getElementById("tickerLookupBox");
  if (!box) return;
  const isHidden = box.style.display === "none" || !box.style.display;
  box.style.display = isHidden ? "block" : "none";
  if (typeof updateTickerGuardUI === "function") updateTickerGuardUI();
  if (isHidden && (typeof isGoogleAccountSignedIn !== "function" || isGoogleAccountSignedIn())) {
    document.getElementById("testTickerInput")?.focus();
  }
}

function quickTestTicker(symbol) {
  if (!ensureGoogleLoginForTicker(true)) return;
  const inp = document.getElementById("testTickerInput");
  if (inp) inp.value = symbol;
  runLiveTickerTest();
}

function applyTestedTickerToForm() {
  if (!lastTestedQuote) return;
  const nameInp = document.getElementById("assetName");
  const tickerInp = document.getElementById("assetTicker");
  const typeSel = document.getElementById("assetType");

  if (nameInp && !nameInp.value.trim()) {
    nameInp.value = lastTestedQuote.name || lastTestedQuote.ticker;
  }
  if (tickerInp) {
    tickerInp.value = lastTestedQuote.ticker;
  }
  if (typeSel) {
    const upper = String(lastTestedQuote.ticker || "").toUpperCase();
    if (upper.includes("XEON")) typeSel.value = "Κατάθεση / XEON";
    else if (/\.(MI|MIL|DE|AS|L|PA)$/i.test(upper) || /ETF|UCITS|VANGUARD|ISHARES|SPDR|AMUNDI/i.test(lastTestedQuote.name || "")) {
      typeSel.value = "ETF";
    } else if (/BTC|ETH|SOL|USD$/i.test(upper) && upper.includes("-")) {
      typeSel.value = "Crypto";
    } else {
      typeSel.value = "Μετοχή";
    }
  }
  document.getElementById("assetUnits")?.focus();
  showToast(`✨ Συμπληρώθηκε το ${lastTestedQuote.ticker} στη φόρμα!`);
}

const FX_FRESH_MAX_HOURS = 6;
const FX_STALE_MAX_HOURS = 24;

function evaluateFxTimestampFreshness(fetchedAtStr, asOfStr) {
  let tsMs = Date.parse(fetchedAtStr || "");
  if (!Number.isFinite(tsMs) && typeof asOfStr === "string" && /^\d{4}-\d{2}-\d{2}$/.test(asOfStr)) {
    tsMs = Date.parse(`${asOfStr}T16:00:00Z`);
  }
  if (!Number.isFinite(tsMs)) {
    return { status: "unavailable", stale: true };
  }
  const ageHours = Math.max(0, (Date.now() - tsMs) / (60 * 60 * 1000));
  if (ageHours <= FX_FRESH_MAX_HOURS) {
    return { status: "fresh", stale: false };
  }
  if (ageHours <= FX_STALE_MAX_HOURS) {
    return { status: "stale", stale: true };
  }
  return { status: "unavailable", stale: true };
}

function normalizeQuoteFxContract(json, rawPrice, currency) {
  const directEur = Number(json?.priceEur);
  if (currency === "EUR") {
    const eurPrice = (Number.isFinite(directEur) && directEur > 0) ? directEur : rawPrice;
    return {
      ok: true,
      priceEur: eurPrice,
      currency: "EUR",
      fxStatus: "fresh",
      stale: false,
      fxSource: json?.fx?.source || "direct-eur",
      fxAsOf: json?.fx?.asOf || new Date().toISOString().slice(0, 10),
      fxFetchedAt: json?.fx?.fetchedAt || new Date().toISOString()
    };
  }

  if (!Number.isFinite(directEur) || !(directEur > 0)) {
    return {
      ok: false,
      status: "unavailable",
      error: "Μη διαθέσιμη ισοτιμία μετατροπής σε EUR"
    };
  }

  const fxObj = json?.fx;
  if (!fxObj || fxObj.available === false) {
    return {
      ok: false,
      status: "unavailable",
      error: `Μη διαθέσιμη ισοτιμία ${currency} → EUR`
    };
  }

  const check = evaluateFxTimestampFreshness(fxObj.fetchedAt, fxObj.asOf);
  if (check.status === "unavailable" || fxObj.freshnessStatus === "expired" || fxObj.freshnessStatus === "unavailable") {
    return {
      ok: false,
      status: "unavailable",
      error: `Η ισοτιμία ${currency} → EUR είναι παρωχημένη (>24h) ή μη διαθέσιμη`
    };
  }

  const isStale = check.status === "stale" || Boolean(json?.stale) || Boolean(fxObj.stale);
  return {
    ok: true,
    priceEur: directEur,
    currency,
    fxStatus: isStale ? "stale" : "fresh",
    stale: isStale,
    fxSource: fxObj.source || json?.source || "worker",
    fxAsOf: fxObj.asOf || "",
    fxFetchedAt: fxObj.fetchedAt || ""
  };
}

async function fetchCloudflareWorkerQuote(rawTicker) {
  const symbol = String(rawTicker || "").trim().toUpperCase();
  if (!symbol || !/^[A-Z0-9.:^=-]{1,20}$/.test(symbol)) {
    throw new Error("Μη έγκυρο σύμβολο ticker");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  if (typeof isGoogleAccountSignedIn === "function" && !isGoogleAccountSignedIn()) {
    clearTimeout(timer);
    throw new Error("Απαιτείται σύνδεση με λογαριασμό Google για έλεγχο τιμών / Ticker.");
  }

  try {
    const url = `${CF_QUOTES_WORKER_URL}/?symbol=${encodeURIComponent(symbol)}`;
    let idToken = typeof getFreshFirebaseIdToken === "function" ? await getFreshFirebaseIdToken(false) : "";
    let headers = idToken ? { "Authorization": `Bearer ${idToken}` } : {};
    let res = await fetch(url, { signal: controller.signal, headers });

    // If token expired / clock skew caused 401, force-refresh Firebase ID token and retry once
    if (res.status === 401 && typeof getFreshFirebaseIdToken === "function") {
      idToken = await getFreshFirebaseIdToken(true);
      if (idToken) {
        headers = { "Authorization": `Bearer ${idToken}` };
        res = await fetch(url, { signal: controller.signal, headers });
      }
    }

    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }

    if (!res.ok || !json || json.success === false) {
      const msg = json?.error || `HTTP ${res.status}`;
      throw new Error(msg);
    }

    const rawPrice = Number(json.price);
    if (!Number.isFinite(rawPrice) || !(rawPrice > 0)) {
      throw new Error("Μη έγκυρη τιμή αγοράς");
    }

    const currency = String(json.currency || "").trim().toUpperCase();
    if (!currency) {
      throw new Error("Άγνωστο νόμισμα τιμής");
    }

    const fxContract = normalizeQuoteFxContract(json, rawPrice, currency);
    if (!fxContract.ok) {
      const err = new Error(fxContract.error);
      err.fxUnavailable = true;
      throw err;
    }

    const prevCloseRaw = Number(json?.previousClose);
    let dayChangePct = null;
    let prevCloseEur = null;
    if (Number.isFinite(prevCloseRaw) && prevCloseRaw > 0) {
      dayChangePct = Number((((rawPrice - prevCloseRaw) / prevCloseRaw) * 100).toFixed(2));
      const fxRatio = fxContract.priceEur / rawPrice;
      prevCloseEur = Number((prevCloseRaw * fxRatio).toFixed(6));
    }

    return {
      ticker: json.ticker || symbol,
      name: json.name || json.ticker || symbol,
      exchange: json.exchange || "",
      priceEur: Number(fxContract.priceEur.toFixed(6)),
      prevCloseEur,
      dayChangePct,
      rawPrice,
      currency: fxContract.currency,
      fxStatus: fxContract.fxStatus,
      stale: fxContract.stale,
      fxSource: fxContract.fxSource,
      fxAsOf: fxContract.fxAsOf,
      fxFetchedAt: fxContract.fxFetchedAt,
      marketTime: json.marketTime || new Date().toISOString()
    };
  } finally {
    clearTimeout(timer);
  }
}

async function runLiveTickerTest() {
  if (!ensureGoogleLoginForTicker(true)) return;
  const inp = document.getElementById("testTickerInput");
  const out = document.getElementById("testTickerResultText");
  const btn = document.getElementById("testTickerBtn");
  const useBtn = document.getElementById("useTestedTickerBtn");
  const ticker = (inp?.value || "").trim().toUpperCase();
  if (!ticker) return;

  lastTestedQuote = null;
  if (useBtn) useBtn.style.display = "none";
  if (btn) btn.disabled = true;
  if (out) {
    out.style.color = "var(--muted)";
    out.textContent = `⏳ Αναζήτηση τιμής για ${ticker}...`;
  }

  try {
    const quote = await fetchCloudflareWorkerQuote(ticker);
    if (quote && quote.priceEur > 0) {
      lastTestedQuote = quote;
      if (useBtn) useBtn.style.display = "inline-flex";
      if (out) {
        const dayStr = quote.dayChangePct !== null
          ? ` • Σήμερα: ${quote.dayChangePct >= 0 ? "+" : ""}${quote.dayChangePct.toFixed(2)}%`
          : "";
        const exStr = quote.exchange ? ` • ${quote.exchange}` : "";
        out.style.color = "var(--accent)";
        out.textContent = `✅ ${quote.ticker} (${quote.name}): ${money(quote.priceEur)} / μερίδιο (${quote.rawPrice} ${quote.currency}${dayStr}${exStr})`;
      }
    }
  } catch (err) {
    if (out) {
      out.style.color = "var(--danger)";
      const hintMap = { XETRA: "DE", XETR: "DE", GER: "DE", MIL: "MI", LSE: "L", AMS: "AS", EPA: "PA", ATH: "AT", FRA: "F", SWX: "SW" };
      const dotIdx = ticker.lastIndexOf(".");
      const suggested = (dotIdx > 0 && hintMap[ticker.slice(dotIdx + 1)])
        ? `${ticker.slice(0, dotIdx)}.${hintMap[ticker.slice(dotIdx + 1)]}`
        : "";
      const errMsg = escapeHtml(err?.message || "Σφάλμα σύνδεσης");
      if (suggested) {
        const safeSug = escapeHtml(suggested);
        out.innerHTML = `❌ Δεν βρέθηκε το <strong>${escapeHtml(ticker)}</strong> (${errMsg}). ` +
          `Το Yahoo Finance χρησιμοποιεί διαφορετική κατάληξη — θέλεις να δοκιμάσεις ` +
          `<button type="button" class="secondary small-btn" style="padding:2px 8px; font-size:11.5px; margin-left:4px;" data-sym="${safeSug}" onclick="quickTestTicker(this.dataset.sym)">🔍 ${safeSug}</button>;`;
      } else {
        out.textContent = `❌ Δεν βρέθηκε τιμή για ${ticker} (${err?.message || "Σφάλμα σύνδεσης"}). Δοκίμασε VUAA.MI, VWCE.DE ή OPAP.AT.`;
      }
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function refreshPortfolioMarketPrices(forceManual = false) {
  if (!ensureGoogleLoginForTicker(forceManual)) return;
  const trackedAssets = (data.portfolioAssets || []).filter(a => a.ticker && Number(a.units) > 0);

  if (trackedAssets.length === 0) {
    if (forceManual) {
      showModal("Δεν βρέθηκαν θέσεις με συμπληρωμένο «Ticker» (π.χ. VUAA.MI) και «Μερίδια». Πρόσθεσε μια θέση ETF ή μετοχής με Ticker & Μερίδια για αυτόματη ενημέρωση.");
    }
    return;
  }

  const btn = document.getElementById("refreshEtfsBtn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "⏳ Ενημέρωση...";
  }

  const CACHE_TTL_MS = 15 * 60 * 1000; // 15 λεπτά τοπική cache
  data.settings.etfQuotesCache = data.settings.etfQuotesCache || {};
  let updatedCount = 0;
  const failedDetails = [];

  try {
    await Promise.all(trackedAssets.map(async (asset) => {
      const symbol = String(asset.ticker).trim().toUpperCase();
      const cached = data.settings.etfQuotesCache[symbol];
      let unitPriceEur = null;
      let dayChangePct = asset.dayChangePct ?? null;
      let prevCloseEur = asset.prevCloseEur ?? null;

      if (!forceManual && cached && (Date.now() - cached.fetchedAt) < CACHE_TTL_MS && cached.priceEur > 0) {
        unitPriceEur = cached.priceEur;
        if (cached.dayChangePct !== undefined) dayChangePct = cached.dayChangePct;
        if (cached.prevCloseEur !== undefined) prevCloseEur = cached.prevCloseEur;
        if (cached.fxStatus) {
          asset.fxStatus = cached.fxStatus;
          asset.marketDataStatus = cached.fxStatus;
        }
      } else {
        try {
          const quote = await fetchCloudflareWorkerQuote(symbol);
          const prevPx = Number(asset.lastUnitPriceEur) || 0;
          const implausible = prevPx > 0 && quote && (quote.priceEur / prevPx > 5 || quote.priceEur / prevPx < 0.2);
          if (implausible) {
            failedDetails.push(`${symbol}: απόκλιση τιμής >5x από την προηγούμενη (€${quote.priceEur.toFixed(2)} έναντι €${prevPx.toFixed(2)})`);
          }
          if (quote && quote.priceEur > 0 && !implausible) {
            unitPriceEur = quote.priceEur;
            dayChangePct = quote.dayChangePct;
            prevCloseEur = quote.prevCloseEur;
            asset.marketDataStatus = quote.stale ? "stale" : "fresh";
            asset.fxStatus = quote.fxStatus || (quote.stale ? "stale" : "fresh");
            asset.fxSource = quote.fxSource || "";
            asset.fxAsOf = quote.fxAsOf || "";
            asset.fxFetchedAt = quote.fxFetchedAt || "";
            data.settings.etfQuotesCache[symbol] = {
              priceEur: Number(unitPriceEur.toFixed(6)),
              prevCloseEur,
              dayChangePct,
              fxStatus: asset.fxStatus,
              fxSource: asset.fxSource,
              fxAsOf: asset.fxAsOf,
              fetchedAt: Date.now()
            };
          }
        } catch (err) {
          const reason = err?.message || "Σφάλμα σύνδεσης";
          console.warn(`Quote fetch failed for ${symbol}:`, reason);
          failedDetails.push(`${symbol}: ${reason}`);
          if (err?.fxUnavailable) {
            asset.marketDataStatus = "unavailable";
            asset.fxStatus = "unavailable";
          } else if (!asset.marketDataStatus) {
            asset.marketDataStatus = asset.lastUnitPriceEur > 0 ? "stale" : "unavailable";
          }
        }
      }

      if (unitPriceEur && unitPriceEur > 0) {
        asset.lastUnitPriceEur = Number(unitPriceEur.toFixed(4));
        asset.prevCloseEur = prevCloseEur;
        asset.dayChangePct = dayChangePct;
        asset.lastPriceUpdatedAt = Date.now();
        asset.current = roundMoney(unitPriceEur * Number(asset.units));
        updatedCount++;
      }
    }));

    if (updatedCount > 0) {
      data.settings.stateUpdatedAt = Date.now();
      persist();
      render();
      if (forceManual) {
        showToast(`📈 Ενημερώθηκαν ${updatedCount} θέσεις χαρτοφυλακίου!`);
      }
    } else if (forceManual) {
      const detailText = failedDetails.length > 0
        ? `\n\nΛεπτομέρειες:\n• ${failedDetails.join("\n• ")}`
        : "";
      showModal(`Δεν βρέθηκε τιμή για τα συγκεκριμένα tickers. Έλεγξε τη μορφή (π.χ. VUAA.MI, VWCE.DE, OPAP.AT, VOO).${detailText}`);
    }
  } catch (err) {
    console.error("Portfolio quote error:", err);
    if (forceManual) {
      showToast("⚠️ Αποτυχία σύνδεσης για ενημέρωση τιμών.");
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "🔄 Ενημέρωση Τιμών";
    }
  }
}

function setPortfolioFilter(filterVal) {
  activePortfolioFilter = filterVal || "all";
  document.querySelectorAll("#portfolioFilterChips [data-pfilter]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.pfilter === activePortfolioFilter);
  });
  renderPortfolio();
}

function savePortfolioAsset() {
  const editId = document.getElementById("editingAssetId")?.value || "";
  const name = document.getElementById("assetName").value.trim();
  const ticker = (document.getElementById("assetTicker")?.value || "").trim().toUpperCase();
  const type = document.getElementById("assetType").value;
  const unitsRaw = document.getElementById("assetUnits")?.value;
  const units = unitsRaw !== "" && unitsRaw !== null ? Math.max(0, Number(unitsRaw) || 0) : 0;
  const invested = Math.max(0, Number(document.getElementById("assetInvested").value) || 0);
  const currentRaw = document.getElementById("assetCurrent").value;
  const hasExplicitCurrent = currentRaw !== "" && currentRaw !== null && Number(currentRaw) > 0;
  const cachedPrice = ticker ? Number(data.settings?.etfQuotesCache?.[ticker]?.priceEur) : 0;

  let current = 0;
  if (hasExplicitCurrent) {
    current = Math.max(0, Number(currentRaw) || 0);
  } else if (units > 0 && cachedPrice > 0) {
    current = Number((units * cachedPrice).toFixed(2));
  } else {
    current = invested;
  }

  if (!name) return;
  if (ticker && !/^[A-Z0-9.:^=\-]{1,20}$/.test(ticker)) {
    showModal("Μη έγκυρο Ticker. Επιτρέπονται γράμματα, ψηφία και τα σύμβολα . : ^ = -");
    return;
  }

  if (editId) {
    const idx = data.portfolioAssets.findIndex(a => a.id === editId);
    if (idx !== -1) {
      const existing = data.portfolioAssets[idx];
      const tickerChanged = (existing.ticker || "").toUpperCase() !== ticker;
      const unitPrice = cachedPrice > 0 ? cachedPrice : (!tickerChanged ? Number(existing.lastUnitPriceEur || 0) : 0);
      if (!hasExplicitCurrent && units > 0 && unitPrice > 0) {
        current = Number((units * unitPrice).toFixed(2));
      }
      data.portfolioAssets[idx] = {
        ...existing,
        name,
        ticker,
        type,
        units,
        invested,
        current,
        lastUnitPriceEur: unitPrice > 0 ? unitPrice : undefined,
        lastPriceUpdatedAt: tickerChanged && cachedPrice <= 0 ? undefined : existing.lastPriceUpdatedAt
      };
    }
    showToast(`✅ Η θέση «${name}» ενημερώθηκε!`);
  } else {
    data.portfolioAssets.push({
      id: generateId("asset"),
      name,
      ticker,
      type,
      units,
      invested,
      current,
      lastUnitPriceEur: cachedPrice > 0 ? cachedPrice : undefined
    });
    showToast(`📈 Η θέση «${name}» προστέθηκε στο χαρτοφυλάκιο!`);
  }

  data.settings.stateUpdatedAt = Date.now();
  cancelPortfolioAssetEditor();
  persist();
  render();
  if (ticker && units > 0) {
    refreshPortfolioMarketPrices(false);
  }
}

function editPortfolioAsset(id) {
  const a = (data.portfolioAssets || []).find(item => item.id === id);
  if (!a) return;
  document.getElementById("editingAssetId").value = a.id;
  document.getElementById("assetName").value = a.name || "";
  if (document.getElementById("assetTicker")) document.getElementById("assetTicker").value = a.ticker || "";
  document.getElementById("assetType").value = a.type || "ETF";
  if (document.getElementById("assetUnits")) document.getElementById("assetUnits").value = Number(a.units) > 0 ? a.units : "";
  document.getElementById("assetInvested").value = Number(a.invested) > 0 ? a.invested : "";
  document.getElementById("assetCurrent").value = Number(a.current) > 0 ? a.current : "";
  setTextSafe("saveAssetBtn", "💾 Αποθήκευση");
  const cancelBtn = document.getElementById("cancelAssetEditBtn");
  if (cancelBtn) cancelBtn.style.display = "inline-flex";
  document.getElementById("assetName").focus();
}

function cancelPortfolioAssetEditor() {
  if (document.getElementById("editingAssetId")) document.getElementById("editingAssetId").value = "";
  document.getElementById("assetName").value = "";
  if (document.getElementById("assetTicker")) document.getElementById("assetTicker").value = "";
  if (document.getElementById("assetUnits")) document.getElementById("assetUnits").value = "";
  document.getElementById("assetInvested").value = "";
  document.getElementById("assetCurrent").value = "";
  setTextSafe("saveAssetBtn", "➕ Προσθήκη");
  const cancelBtn = document.getElementById("cancelAssetEditBtn");
  if (cancelBtn) cancelBtn.style.display = "none";
}

const _dcaInFlightKeys = new Set();

function addDcaToPortfolioAsset(id, addEuro = 100, options = {}) {
  const lockKey = `${String(id || "")}:${toCents(addEuro)}`;
  if (_dcaInFlightKeys.has(lockKey)) {
    return false;
  }

  const amtCheck = validateFinancialAmount(addEuro, { min: 0.01, max: 1e8 });
  if (!amtCheck.ok) {
    showModal(amtCheck.error);
    return false;
  }

  const asset = (data.portfolioAssets || []).find(a => a && a.id === id);
  if (!asset) {
    showModal("Δεν βρέθηκε η επιλεγμένη επενδυτική θέση.");
    return false;
  }

  const dateCheck = validateFinancialDate(options.date || today());
  if (!dateCheck.ok) {
    showModal(dateCheck.error);
    return false;
  }

  _dcaInFlightKeys.add(lockKey);
  const snapshotBefore = deepClone(data);
  const dirtyBefore = new Set(dirtyTxIds);
  const prevFullSync = fullSyncNeeded;

  try {
    const amountEur = amtCheck.value;
    const txDate = dateCheck.value;
    const nowTs = Date.now();
    const prevUnits = Math.max(0, Number(asset.units) || 0);
    const prevCurrent = Math.max(0, roundMoney(asset.current) || 0);
    const prevInvested = Math.max(0, roundMoney(asset.invested) || 0);
    const unitPrice = Number(asset.lastUnitPriceEur) > 0
      ? Number(asset.lastUnitPriceEur)
      : (prevUnits > 0 && prevCurrent > 0 ? prevCurrent / prevUnits : 0);

    let addedUnits = 0;
    asset.invested = fromCents(toCents(prevInvested) + toCents(amountEur));
    if (unitPrice > 0 && prevUnits > 0) {
      addedUnits = Number((amountEur / unitPrice).toFixed(8));
      asset.units = Number((prevUnits + addedUnits).toFixed(8));
      asset.current = roundMoney(asset.units * unitPrice);
    } else {
      asset.current = fromCents(toCents(prevCurrent) + toCents(amountEur));
    }
    asset._updatedAt = nowTs;

    if (!Array.isArray(data.transactions)) data.transactions = [];
    const txId = generateId("tx");
    data.transactions.push({
      id: txId,
      owner: "me",
      type: "saving",
      category: "Επένδυση",
      amount: amountEur,
      date: txDate,
      description: `DCA: ${asset.name || asset.ticker || "Επένδυση"}`,
      linkedPortfolioAssetId: asset.id,
      dcaAddedUnits: addedUnits > 0 ? addedUnits : undefined,
      dcaUnitPriceEur: unitPrice > 0 ? Number(unitPrice.toFixed(6)) : undefined,
      _updatedAt: nowTs
    });
    markTxDirty(txId);
    data.settings.stateUpdatedAt = nowTs;

    const saved = persist();
    if (!saved) {
      data = snapshotBefore;
      dirtyTxIds = dirtyBefore;
      fullSyncNeeded = prevFullSync;
      render();
      showToast("⚠️ Η αποθήκευση DCA απέτυχε — έγινε επαναφορά.");
      return false;
    }

    render();
    showToast(`📈 +${money(amountEur)} DCA στη θέση «${asset.name}»!`);
    return true;
  } catch (err) {
    data = snapshotBefore;
    dirtyTxIds = dirtyBefore;
    fullSyncNeeded = prevFullSync;
    render();
    showToast("⚠️ Σφάλμα κατά την καταχώριση DCA — έγινε επαναφορά.");
    return false;
  } finally {
    _dcaInFlightKeys.delete(lockKey);
  }
}

function updatePortfolioAssetValue(id, newVal) {
  const asset = data.portfolioAssets.find(a => a.id === id);
  if (!asset) return;
  asset.current = Math.max(0, Number(newVal) || 0);
  data.settings.stateUpdatedAt = Date.now();
  persist();
  render();
}

function deletePortfolioAsset(id) {
  const asset = (data.portfolioAssets || []).find(a => a && a.id === id);
  if (!asset) return;
  const linkedTxs = (data.transactions || []).filter(t => t && t.linkedPortfolioAssetId === id);
  const linkedSum = fromCents(linkedTxs.reduce((s, t) => s + toCents(Math.abs(Number(t.amount) || 0)), 0));
  const msg = linkedTxs.length > 0
    ? `Διαγραφή της επενδυτικής θέσης «${asset.name || asset.ticker || "Θέση"}»;\n\nΒρέθηκαν ${linkedTxs.length} συνδεδεμένες DCA συναλλαγές (${money(linkedSum)}). Θα διαγραφούν επίσης ώστε τα κεφάλαια να επιστρέψουν στη Σωρευτική Ροή και να μη δημιουργηθεί απώλεια στην Καθαρή Θέση (Net Worth).`
    : `Διαγραφή της επενδυτικής θέσης «${asset.name || asset.ticker || "Θέση"}»;`;

  showModal(msg, true, (ok) => {
    if (!ok) return;
    const nowTs = Date.now();
    if (linkedTxs.length > 0) {
      const linkedIds = new Set(linkedTxs.map(t => t.id));
      data.transactions = (data.transactions || []).filter(t => !t || !linkedIds.has(t.id));
      linkedIds.forEach(txId => {
        data.deletedTxIds[txId] = nowTs;
        markTxDirty(txId);
      });
    }
    data.portfolioAssets = (data.portfolioAssets || []).filter(a => a.id !== id);
    recordEntityDeletion(id);
    persist();
    render();
    showToast(linkedTxs.length > 0
      ? `🗑️ Η θέση και ${linkedTxs.length} συνδεδεμένες DCA κινήσεις διαγράφηκαν.`
      : "🗑️ Η επενδυτική θέση διαγράφηκε.");
  }, "Διαγραφή Θέσης");
}

function getChartThemeTokens() {
  const isDark = Boolean(data.settings?.darkMode);
  return {
    textColor: isDark ? "#cbd5e1" : "#334155",
    mutedColor: isDark ? "#94a3b8" : "#64748b",
    gridColor: isDark ? "rgba(148, 163, 184, 0.12)" : "rgba(15, 23, 42, 0.06)",
    borderColor: isDark ? "#0f172a" : "#ffffff"
  };
}

function renderPortfolio() {
  const grid = document.getElementById("portfolioAssetsGrid");
  const analyticsBlock = document.getElementById("portfolioAnalyticsBlock");
  const toolbar = document.getElementById("portfolioToolbar");
  if (!grid) return;

  const assets = data.portfolioAssets || [];
  const totalCurrent = assets.reduce((s, a) => s + (Number(a.current) || 0), 0);
  const totalInvested = assets.reduce((s, a) => s + (Number(a.invested) || 0), 0);
  const pnl = totalCurrent - totalInvested;
  const pnlPct = totalInvested > 0 ? (pnl / totalInvested) * 100 : 0;

  // Daily change across tracked positions with prevCloseEur
  let dailyDeltaEur = 0;
  let dailyBaseEur = 0;
  assets.forEach(a => {
    const units = Number(a.units) || 0;
    const px = Number(a.lastUnitPriceEur) || 0;
    const prev = Number(a.prevCloseEur) || 0;
    if (units > 0 && px > 0 && prev > 0) {
      dailyDeltaEur += (px - prev) * units;
      dailyBaseEur += prev * units;
    }
  });
  const hasDaily = dailyBaseEur > 0;
  const dailyPct = hasDaily ? (dailyDeltaEur / dailyBaseEur) * 100 : 0;

  setTextSafe(
    "portfolioSummaryLine",
    `Συνολική αξία: ${money(totalCurrent)} • Κεφάλαιο: ${money(totalInvested)} • Κέρδος/Ζημία: ${pnl >= 0 ? "+" : ""}${money(pnl)} (${pnlPct.toFixed(1)}%)`
  );

  if (assets.length === 0) {
    if (analyticsBlock) analyticsBlock.style.display = "none";
    if (toolbar) toolbar.style.display = "none";
    grid.innerHTML = `<div class="small">Δεν έχουν προστεθεί επενδυτικές θέσεις ακόμα. Χρησιμοποίησε το κουμπί «🔍 Έλεγχος Ticker» ή τη φόρμα επάνω για να προσθέσεις ETFs & μετοχές.</div>`;
    return;
  }

  if (toolbar) toolbar.style.display = "flex";

  if (analyticsBlock) {
    analyticsBlock.style.display = "block";
    setTextSafe("pfTotalCurrentCard", money(totalCurrent));
    setTextSafe("pfTotalInvestedCard", money(totalInvested));

    const pnlEl = document.getElementById("pfTotalPnlCard");
    if (pnlEl) {
      pnlEl.textContent = `${pnl >= 0 ? "+" : ""}${money(pnl)} (${pnlPct.toFixed(1)}%)`;
      pnlEl.className = `metric ${pnl >= 0 ? "accent" : "red"} privacy-sensitive`;
    }

    const dailyEl = document.getElementById("pfDailyChangeCard");
    if (dailyEl) {
      if (hasDaily) {
        dailyEl.textContent = `${dailyDeltaEur >= 0 ? "+" : ""}${money(dailyDeltaEur)} (${dailyPct >= 0 ? "+" : ""}${dailyPct.toFixed(2)}%)`;
        dailyEl.className = `metric ${dailyDeltaEur >= 0 ? "accent" : "red"} privacy-sensitive`;
      } else {
        dailyEl.textContent = "—";
        dailyEl.className = "metric privacy-sensitive";
      }
    }

    const latestTs = Math.max(0, ...assets.map(a => Number(a.lastPriceUpdatedAt) || 0));
    setTextSafe(
      "pfLastUpdatedLine",
      latestTs > 0
        ? `🕒 Τελευταία ενημέρωση τιμών: ${new Date(latestTs).toLocaleString("el-GR")} • 15-min delayed`
        : "💡 Συμπλήρωσε Ticker (π.χ. VUAA.MI) & Μερίδια για αυτόματη αποτίμηση."
    );

    const pfCanvas = document.getElementById("portfolioChart");
    if (pfCanvas && typeof Chart !== "undefined" && document.getElementById("tab-wealth")?.classList.contains("active")) {
      const theme = getChartThemeTokens();
      const labels = assets.map(a => a.ticker || a.name);
      const values = assets.map(a => Number((Number(a.current) || 0).toFixed(2)));
      const palette = ["#2563eb", "#10b981", "#8b5cf6", "#f59e0b", "#06b6d4", "#ec4899", "#14b8a6", "#64748b"];
      const sliceColors = values.map((_, i) => palette[i % palette.length]);

      if (portfolioChartInstance) {
        portfolioChartInstance.data.labels = labels;
        portfolioChartInstance.data.datasets[0].data = values;
        portfolioChartInstance.data.datasets[0].backgroundColor = sliceColors;
        portfolioChartInstance.data.datasets[0].borderColor = theme.borderColor;
        portfolioChartInstance.options.plugins.legend.labels.color = theme.textColor;
        portfolioChartInstance.update("none");
      } else {
        portfolioChartInstance = new Chart(pfCanvas, {
          type: "doughnut",
          data: {
            labels,
            datasets: [{
              data: values,
              backgroundColor: sliceColors,
              borderColor: theme.borderColor,
              borderWidth: 2
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: "62%",
            plugins: {
              legend: {
                position: "right",
                labels: { color: theme.textColor, usePointStyle: true, boxWidth: 10, font: { size: 11, weight: "600" } }
              },
              tooltip: {
                callbacks: {
                  label: (ctx) => {
                    const val = Number(ctx.raw) || 0;
                    const share = totalCurrent > 0 ? ((val / totalCurrent) * 100).toFixed(1) : "0.0";
                    return ` ${ctx.label}: ${money(val)} (${share}%)`;
                  }
                }
              }
            }
          }
        });
      }
    }
  }

  // Filter & Sort visible positions
  const sortMode = document.getElementById("portfolioSortSelect")?.value || "value_desc";
  const visibleAssets = assets
    .filter(a => activePortfolioFilter === "all" || a.type === activePortfolioFilter)
    .slice()
    .sort((a, b) => {
      const aCur = Number(a.current) || 0;
      const bCur = Number(b.current) || 0;
      const aInv = Number(a.invested) || 0;
      const bInv = Number(b.invested) || 0;
      const aPnl = aCur - aInv;
      const bPnl = bCur - bInv;
      const aPct = aInv > 0 ? aPnl / aInv : 0;
      const bPct = bInv > 0 ? bPnl / bInv : 0;
      if (sortMode === "pnl_pct_desc") return bPct - aPct;
      if (sortMode === "pnl_desc") return bPnl - aPnl;
      if (sortMode === "name_asc") return String(a.name || "").localeCompare(String(b.name || ""), "el");
      return bCur - aCur;
    });

  if (visibleAssets.length === 0) {
    grid.innerHTML = `<div class="small">Δεν υπάρχουν θέσεις σε αυτή την κατηγορία φίλτρου.</div>`;
    return;
  }

  grid.innerHTML = visibleAssets.map(a => {
    const unitsNum = Number(a.units) || 0;
    const investedNum = Number(a.invested) || 0;
    const currentNum = Number(a.current) || 0;
    const diff = currentNum - investedNum;
    const pct = investedNum > 0 ? (diff / investedNum) * 100 : 0;
    const weight = totalCurrent > 0 ? (currentNum / totalCurrent) * 100 : 0;
    const avgCost = unitsNum > 0 && investedNum > 0 ? investedNum / unitsNum : 0;
    const tickerBadge = a.ticker ? `<span class="badge saving">${escapeHtml(a.ticker)}</span>` : "";
    const statusMode = a.fxStatus === "unavailable" || a.marketDataStatus === "unavailable"
      ? "unavailable"
      : (a.marketDataStatus === "stale" || a.fxStatus === "stale" ? "stale" : (a.lastUnitPriceEur > 0 ? "fresh" : ""));
    const statusBadge = statusMode === "unavailable"
      ? `<span class="badge expense" style="font-size:10px;" title="Μη διαθέσιμη ισοτιμία ή τιμή αγοράς">FX Unavailable</span>`
      : (statusMode === "stale"
        ? `<span class="badge withdrawal" style="font-size:10px;" title="Καθυστερημένη/παλαιότερη τιμή ή ισοτιμία">Stale</span>`
        : (statusMode === "fresh"
          ? `<span class="badge income" style="font-size:10px;" title="Ενημερωμένη τιμή αγοράς">Fresh</span>`
          : ""));
    const dayBadge = (a.dayChangePct !== null && a.dayChangePct !== undefined && Number.isFinite(Number(a.dayChangePct)))
      ? `<span class="badge ${Number(a.dayChangePct) >= 0 ? "income" : "expense"}" style="font-size:10px;">${Number(a.dayChangePct) >= 0 ? "▲" : "▼"} ${Math.abs(Number(a.dayChangePct)).toFixed(2)}%</span>`
      : "";
    const unitsLine = unitsNum > 0
      ? `<div class="small" style="margin-top:4px;">Μερίδια: <strong>${unitsNum}</strong>${avgCost > 0 ? ` • Μ.Τ.Κ.: ${money(avgCost)}` : ""}${a.lastUnitPriceEur ? ` • Τιμή: <strong>${money(a.lastUnitPriceEur)}</strong>` : ""}</div>`
      : "";

    return `
      <div class="kpi-card">
        <div class="kpi-label">
          <div style="display:flex; flex-wrap:wrap; align-items:center; gap:4px;">
            <strong>${escapeHtml(a.name)}</strong> ${tickerBadge} ${statusBadge} ${dayBadge}
          </div>
          <div style="display:flex; gap:4px; flex-shrink:0;">
            <button type="button" class="secondary small-btn" data-aid="${escapeHtml(a.id)}" onclick="editPortfolioAsset(this.dataset.aid)" aria-label="Επεξεργασία θέσης" title="Επεξεργασία μεριδίων / κεφαλαίου">✏️</button>
            <button type="button" class="danger small-btn" data-aid="${escapeHtml(a.id)}" onclick="deletePortfolioAsset(this.dataset.aid)" aria-label="Διαγραφή θέσης" title="Διαγραφή">🗑️</button>
          </div>
        </div>
        <div class="metric privacy-sensitive" style="font-size:19px;">${money(currentNum)}</div>
        ${unitsLine}
        <div class="small" style="color:${diff >= 0 ? "var(--accent)" : "var(--danger)"}; font-weight:600; margin-top:4px;">
          ${diff >= 0 ? "+" : ""}${money(diff)} (${pct.toFixed(1)}%) • Βαρύτητα: ${weight.toFixed(1)}%
        </div>
        <div class="progress" style="height:5px; margin:6px 0 8px;">
          <div style="width:${Math.min(100, weight)}%; background:var(--primary);"></div>
        </div>
        <div style="display:flex; align-items:center; justify-content:space-between; gap:6px; flex-wrap:wrap;">
          <div style="display:flex; align-items:center; gap:5px;">
            <span class="small">Αξία (€):</span>
            <input type="number" step="0.01" min="0" value="${currentNum}" data-aid="${escapeHtml(a.id)}" onchange="updatePortfolioAssetValue(this.dataset.aid, this.value)" style="width:90px; padding:4px 7px;" />
          </div>
          <div style="display:flex; gap:4px;">
            <button type="button" class="secondary small-btn" data-aid="${escapeHtml(a.id)}" onclick="addDcaToPortfolioAsset(this.dataset.aid, 50)" title="Γρήγορη προσθήκη €50 DCA">+€50</button>
            <button type="button" class="secondary small-btn" data-aid="${escapeHtml(a.id)}" onclick="addDcaToPortfolioAsset(this.dataset.aid, 100)" title="Γρήγορη προσθήκη €100 DCA">+€100</button>
          </div>
        </div>
      </div>
    `;
  }).join("");
}

function applySimRatePreset(rateVal) {
  const inp = document.getElementById("simRate");
  if (inp) inp.value = rateVal;
  renderWealthSimulator();
}

function syncSimulatorWithPortfolio() {
  const total = (data.portfolioAssets || []).reduce((s, a) => s + (Number(a.current) || 0), 0);
  const inp = document.getElementById("simInitial");
  if (inp) inp.value = Math.round(total);
  renderWealthSimulator();
  showToast("🔄 Το αρχικό κεφάλαιο ενημερώθηκε από το χαρτοφυλάκιο!");
}

function renderWealthSimulator() {
  const initial = Math.max(0, Number(document.getElementById("simInitial")?.value) || 0);
  const monthly = Math.max(0, Number(document.getElementById("simMonthly")?.value) || 0);
  const rate = Math.min(30, Math.max(0, Number(document.getElementById("simRate")?.value) || 0)) / 100;
  const years = Math.min(45, Math.max(1, Number(document.getElementById("simYears")?.value) || 15));

  const labels = [];
  const totalSeries = [];
  const contribSeries = [];

  let balance = initial;
  let contributed = initial;
  const monthlyRate = Math.pow(1 + rate, 1 / 12) - 1;

  for (let y = 0; y <= years; y++) {
    labels.push(`Έτος ${y}`);
    totalSeries.push(Number(balance.toFixed(2)));
    contribSeries.push(Number(contributed.toFixed(2)));
    for (let m = 0; m < 12; m++) {
      balance = (balance + monthly) * (1 + monthlyRate);
      contributed += monthly;
    }
  }

  const finalBalance = totalSeries[totalSeries.length - 1];
  const finalContrib = contribSeries[contribSeries.length - 1];
  const interestEarned = finalBalance - finalContrib;
  const fireMonthly4Pct = (finalBalance * 0.04) / 12;

  const summary = document.getElementById("simSummaryText");
  if (summary) {
    summary.innerHTML = `<div>Σε <strong>${years} έτη</strong> θα έχεις <strong>${money(finalBalance)}</strong> (Εισφορές: ${money(finalContrib)} + Κέρδος Ανατοκισμού: <strong style="color:var(--accent);">${money(interestEarned)}</strong>).<div class="small" style="margin-top:4px;">🔥 Εκτιμώμενο παθητικό εισόδημα (κανόνας 4% FIRE): <strong>${money(fireMonthly4Pct)} / μήνα</strong></div></div>`;
  }

  const canvas = document.getElementById("wealthChart");
  if (!canvas || typeof Chart === "undefined") return;
  const theme = getChartThemeTokens();

  if (wealthChartInstance) {
    wealthChartInstance.data.labels = labels;
    wealthChartInstance.data.datasets[0].data = totalSeries;
    wealthChartInstance.data.datasets[1].data = contribSeries;
    wealthChartInstance.options.plugins.legend.labels.color = theme.textColor;
    wealthChartInstance.options.scales.x.ticks.color = theme.mutedColor;
    wealthChartInstance.options.scales.x.grid.color = theme.gridColor;
    wealthChartInstance.options.scales.y.ticks.color = theme.mutedColor;
    wealthChartInstance.options.scales.y.grid.color = theme.gridColor;
    wealthChartInstance.update("none");
    return;
  }

  wealthChartInstance = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Συνολική Αξία (€)",
          data: totalSeries,
          borderColor: "#10b981",
          backgroundColor: "rgba(16, 185, 129, 0.16)",
          borderWidth: 2.5,
          pointRadius: 2,
          fill: true,
          tension: 0.35
        },
        {
          label: "Ίδιες Εισφορές (€)",
          data: contribSeries,
          borderColor: "#3b82f6",
          borderWidth: 2,
          borderDash: [5, 5],
          pointRadius: 0,
          fill: false,
          tension: 0.2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: { ticks: { color: theme.mutedColor }, grid: { color: theme.gridColor } },
        y: {
          ticks: {
            color: theme.mutedColor,
            callback: (val) => `€${Number(val).toLocaleString("el-GR")}`
          },
          grid: { color: theme.gridColor }
        }
      },
      plugins: {
        legend: { position: "bottom", labels: { color: theme.textColor, usePointStyle: true } },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.dataset.label}: ${money(ctx.raw)}`
          }
        }
      }
    }
  });
}

function renderEReceiptsTracker() {
  const container = document.getElementById("eReceiptsPanelContent");
  if (!container) return;
  const ctx = getActivePeriodContext();
  const yr = (ctx.start || today()).slice(0, 4);
  setTextSafe("eReceiptsYearBadge", `Έτος ${yr}`);

  const yearTxs = filterTransactionsForRange(`${yr}-01-01`, `${yr}-12-31`, true)
    .filter(t => (t.owner || "me") === "me");

  const annualIncome = yearTxs
    .filter(t => t.type === "income" && t.category !== "Επιστροφή Χρημάτων")
    .reduce((s, t) => s + (Number(t.amount) || 0), 0);

  const split = getCoupleSplit();
  const requiredReceipts = Math.min(20000, annualIncome * 0.30);
  const qualifyingSpent = yearTxs
    .filter(t => t.type === "expense" && t.category !== "Ανάληψη" && t.category !== "Στέγαση" && t.paidBy !== "partner")
    .reduce((s, t) => {
      const amt = Number(t.amount) || 0;
      if (split.hasPartner && t.isShared && t.paidBy === "split") {
        return s + (amt * split.myPct) / 100;
      }
      return s + amt;
    }, 0);

  const pct = requiredReceipts > 0 ? Math.min(100, (qualifyingSpent / requiredReceipts) * 100) : 0;
  const remaining = Math.max(0, requiredReceipts - qualifyingSpent);
  const statusLine = requiredReceipts > 0
    ? (remaining <= 0
      ? `<span class="badge income">✅ Καλύφθηκε ο στόχος του 30%!</span>`
      : `<span class="small">Υπόλοιπο για κάλυψη: <strong>${money(remaining)}</strong></span>`)
    : `<span class="small">Καταχώρισε εισοδήματα για υπολογισμό του στόχου 30%.</span>`;

  container.innerHTML = `
    <div class="small" style="margin-bottom:8px;">
      Δηλωμένα έσοδα έτους ${yr}: <strong>${money(annualIncome)}</strong> • Απαιτούμενες ηλεκτρονικές αποδείξεις (30%): <strong>${money(requiredReceipts)}</strong>
    </div>
    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:6px;">
      <div class="metric primary privacy-sensitive" style="font-size:20px;">${money(qualifyingSpent)} <span class="small">(${pct.toFixed(1)}% του στόχου)</span></div>
      ${statusLine}
    </div>
    <div class="progress"><div style="width:${pct}%; background:${pct >= 100 ? "var(--accent)" : "var(--primary)"};"></div></div>
  `;
}


/* ==========================================================================
   9b. WEALTH SUB-TABS, LOANS & CREDIT CARDS MANAGEMENT + CHARTS
   ========================================================================== */
function setWealthSubtab(tabKey = "investments") {
  const map = { investments: "wealth", loans: "loans", cards: "cards" };
  switchTab(map[tabKey] || "wealth");
}

function getLiabilityTypeLabel(type) {
  if (type === "Loan") return "🏦 Δάνειο";
  if (type === "Credit Card") return "💳 Πιστωτική Κάρτα";
  return "📅 Δόσεις / Άλλο";
}

function simulateLoanAmortization(loan, maxMonths = 120) {
  let bal = Math.max(0, roundMoney(loan.remainingBalance || 0));
  const rate = Math.max(0, Number(loan.interestRate) || 0);
  const monthlyRate = (rate / 100) / 12;
  const payment = Math.max(0, roundMoney(loan.monthlyPayment || 0));

  if (bal <= 0) {
    return { balances: [0], months: 0, totalInterest: 0, stalled: false };
  }
  if (payment <= 0) {
    return { balances: [bal], months: null, totalInterest: 0, stalled: false };
  }

  const balances = [bal];
  let totalInterestCents = 0;
  let months = 0;
  let stalled = false;

  while (bal > 0.005 && months < maxMonths) {
    const interest = roundMoney(bal * monthlyRate);
    if (payment <= interest && monthlyRate > 0) {
      stalled = true;
      break;
    }
    const principal = Math.min(bal, roundMoney(payment - interest));
    bal = fromCents(Math.max(0, toCents(bal) - toCents(principal)));
    totalInterestCents += toCents(interest);
    months++;
    balances.push(bal);
  }

  return {
    balances,
    months,
    totalInterest: fromCents(totalInterestCents),
    stalled,
    capped: bal > 0.005 && !stalled
  };
}

// --- LOANS CRUD ---
function saveLoanLiabilityItem() {
  const editId = document.getElementById("editingLoanId")?.value || "";
  const name = (document.getElementById("loanName")?.value || "").trim();
  const type = document.getElementById("loanType")?.value === "Other" ? "Other" : "Loan";
  const initialRaw = document.getElementById("loanInitial")?.value;
  const remainingRaw = document.getElementById("loanRemaining")?.value;
  const rateRaw = document.getElementById("loanInterestRate")?.value;
  const monthlyRaw = document.getElementById("loanMonthlyPayment")?.value;
  const startDate = (document.getElementById("loanStartDate")?.value || "").trim();
  const endDate = (document.getElementById("loanEndDate")?.value || "").trim();

  if (!name) {
    showModal("Συμπλήρωσε το όνομα του δανείου / δόσης.");
    return;
  }
  const remCheck = validateFinancialAmount(remainingRaw, { min: 0, max: 1e9, allowZero: true });
  if (!remCheck.ok) {
    showModal(`Υπόλοιπο κεφαλαίου: ${remCheck.error}`);
    return;
  }
  const remainingBalance = remCheck.value;
  const initialAmount = (initialRaw !== "" && initialRaw !== null && Number(initialRaw) > 0)
    ? roundMoney(Math.max(remainingBalance, Number(initialRaw)))
    : remainingBalance;
  const interestRate = Math.min(100, Math.max(0, Number(rateRaw) || 0));
  const monthlyPayment = Math.max(0, roundMoney(Number(monthlyRaw) || 0));

  if (startDate && !validateFinancialDate(startDate).ok) {
    showModal("Μη έγκυρη ημερομηνία έναρξης.");
    return;
  }
  if (endDate && !validateFinancialDate(endDate).ok) {
    showModal("Μη έγκυρη ημερομηνία λήξης.");
    return;
  }

  if (!Array.isArray(data.liabilities)) data.liabilities = [];
  const nowTs = Date.now();

  if (editId) {
    const idx = data.liabilities.findIndex(l => l.id === editId);
    if (idx !== -1) {
      data.liabilities[idx] = {
        ...data.liabilities[idx],
        name,
        type,
        initialAmount,
        remainingBalance,
        interestRate,
        monthlyPayment,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        _updatedAt: nowTs
      };
    }
    showToast(`✅ Το δάνειο «${name}» ενημερώθηκε!`);
  } else {
    const includeInReserve = Boolean(document.getElementById("loanIncludeInReserve")?.checked);
    const reserveOffsetAmount = (includeInReserve && remainingBalance > 0) ? remainingBalance : 0;
    if (reserveOffsetAmount > 0) {
      data.profile.initialSavings = fromCents(toCents(data.profile.initialSavings || 0) + toCents(reserveOffsetAmount));
    }
    data.liabilities.push({
      id: generateId("liab"),
      name,
      type,
      initialAmount,
      remainingBalance,
      interestRate,
      monthlyPayment,
      reserveOffsetAmount: reserveOffsetAmount > 0 ? reserveOffsetAmount : undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      _updatedAt: nowTs
    });
    showToast(includeInReserve
      ? `🏦 Το δάνειο «${name}» προστέθηκε (ισοσταθμισμένο με το αρχικό αποθεματικό)!`
      : `🏦 Το δάνειο «${name}» προστέθηκε!`);
  }

  data.settings.stateUpdatedAt = nowTs;
  cancelLoanEditor();
  persist();
  render();
}

function editLoanLiabilityItem(id) {
  const l = (data.liabilities || []).find(item => item.id === id);
  if (!l) return;
  document.getElementById("editingLoanId").value = l.id;
  document.getElementById("loanName").value = l.name || "";
  document.getElementById("loanType").value = l.type === "Other" ? "Other" : "Loan";
  document.getElementById("loanInitial").value = Number(l.initialAmount) > 0 ? l.initialAmount : "";
  document.getElementById("loanRemaining").value = Number(l.remainingBalance ?? 0);
  document.getElementById("loanInterestRate").value = Number(l.interestRate) > 0 ? l.interestRate : "";
  document.getElementById("loanMonthlyPayment").value = Number(l.monthlyPayment) > 0 ? l.monthlyPayment : "";
  document.getElementById("loanStartDate").value = l.startDate || "";
  document.getElementById("loanEndDate").value = l.endDate || "";
  setTextSafe("saveLoanBtn", "💾 Αποθήκευση");
  const cancelBtn = document.getElementById("cancelLoanEditBtn");
  if (cancelBtn) cancelBtn.style.display = "inline-flex";
  const incWrap = document.getElementById("loanIncludeInReserveWrap");
  if (incWrap) incWrap.style.display = "none";
  document.getElementById("loanName").focus();
}

function cancelLoanEditor() {
  ["editingLoanId", "loanName", "loanInitial", "loanRemaining", "loanInterestRate", "loanMonthlyPayment", "loanStartDate", "loanEndDate"].forEach(fid => {
    const el = document.getElementById(fid);
    if (el) el.value = "";
  });
  const typeEl = document.getElementById("loanType");
  if (typeEl) typeEl.value = "Loan";
  setTextSafe("saveLoanBtn", "➕ Προσθήκη Δανείου");
  const cancelBtn = document.getElementById("cancelLoanEditBtn");
  if (cancelBtn) cancelBtn.style.display = "none";
  const incCb = document.getElementById("loanIncludeInReserve");
  if (incCb) incCb.checked = false;
  const incWrap = document.getElementById("loanIncludeInReserveWrap");
  if (incWrap) incWrap.style.display = "inline-flex";
}

// --- CREDIT CARDS CRUD ---
function saveCreditCardItem() {
  const editId = document.getElementById("editingCardId")?.value || "";
  const name = (document.getElementById("cardName")?.value || "").trim();
  const limitRaw = document.getElementById("cardLimit")?.value;
  const balanceRaw = document.getElementById("cardBalance")?.value;
  const instRaw = document.getElementById("cardInstallmentBalance")?.value;
  const rateRaw = document.getElementById("cardInterestRate")?.value;
  const monthlyRaw = document.getElementById("cardMonthlyPayment")?.value;
  const stmtDayRaw = document.getElementById("cardStatementDay")?.value;
  const dueDayRaw = document.getElementById("cardDueDay")?.value;
  const instMonthlyRaw = document.getElementById("cardInstallmentMonthly")?.value;
  const instCountRaw = document.getElementById("cardInstallmentCount")?.value;

  if (!name) {
    showModal("Συμπλήρωσε το όνομα της πιστωτικής κάρτας.");
    return;
  }
  const limCheck = validateFinancialAmount(limitRaw, { min: 1, max: 1e9 });
  if (!limCheck.ok) {
    showModal(`Πιστωτικό όριο: ${limCheck.error}`);
    return;
  }
  const balCheck = validateFinancialAmount(balanceRaw, { min: 0, max: 1e9, allowZero: true });
  if (!balCheck.ok) {
    showModal(`Συνολικό υπόλοιπο: ${balCheck.error}`);
    return;
  }

  const creditLimit = limCheck.value;
  const remainingBalance = balCheck.value;
  const installmentBalance = Math.min(remainingBalance, Math.max(0, roundMoney(Number(instRaw) || 0)));
  const interestRate = Math.min(100, Math.max(0, Number(rateRaw) || 0));
  const monthlyPayment = Math.max(0, roundMoney(Number(monthlyRaw) || 0));
  const statementDay = Number(stmtDayRaw) >= 1 && Number(stmtDayRaw) <= 31 ? Math.round(Number(stmtDayRaw)) : undefined;
  const dueDay = Number(dueDayRaw) >= 1 && Number(dueDayRaw) <= 31 ? Math.round(Number(dueDayRaw)) : undefined;
  const installmentMonthly = Math.min(installmentBalance, Math.max(0, roundMoney(Number(instMonthlyRaw) || 0)));
  const installmentRemainingCount = installmentBalance > 0 && Number(instCountRaw) > 0 ? Math.min(120, Math.round(Number(instCountRaw))) : 0;

  if (!Array.isArray(data.liabilities)) data.liabilities = [];
  const nowTs = Date.now();

  if (editId) {
    const idx = data.liabilities.findIndex(l => l.id === editId);
    if (idx !== -1) {
      data.liabilities[idx] = {
        ...data.liabilities[idx],
        name,
        type: "Credit Card",
        creditLimit,
        initialAmount: creditLimit,
        remainingBalance,
        installmentBalance,
        installmentMonthly: installmentMonthly > 0 ? installmentMonthly : undefined,
        installmentRemainingCount: installmentRemainingCount > 0 ? installmentRemainingCount : undefined,
        interestRate,
        monthlyPayment,
        statementDay,
        dueDay,
        _updatedAt: nowTs
      };
    }
    showToast(`✅ Η πιστωτική «${name}» ενημερώθηκε!`);
  } else {
    data.liabilities.push({
      id: generateId("liab"),
      name,
      type: "Credit Card",
      creditLimit,
      initialAmount: creditLimit,
      remainingBalance,
      installmentBalance,
      interestRate,
      monthlyPayment,
      statementDay,
      dueDay,
      _updatedAt: nowTs
    });
    showToast(`💳 Η πιστωτική «${name}» προστέθηκε!`);
  }

  data.settings.stateUpdatedAt = nowTs;
  cancelCreditCardEditor();
  persist();
  render();
}

function editCreditCardItem(id) {
  const c = (data.liabilities || []).find(item => item.id === id);
  if (!c) return;
  document.getElementById("editingCardId").value = c.id;
  document.getElementById("cardName").value = c.name || "";
  document.getElementById("cardLimit").value = Number(c.creditLimit || c.initialAmount) > 0 ? Number(c.creditLimit || c.initialAmount) : "";
  document.getElementById("cardBalance").value = Number(c.remainingBalance ?? 0);
  document.getElementById("cardInstallmentBalance").value = Number(c.installmentBalance) > 0 ? Number(c.installmentBalance) : "";
  document.getElementById("cardInterestRate").value = Number(c.interestRate) > 0 ? Number(c.interestRate) : "";
  document.getElementById("cardMonthlyPayment").value = Number(c.monthlyPayment) > 0 ? Number(c.monthlyPayment) : "";
  document.getElementById("cardStatementDay").value = Number(c.statementDay) > 0 ? Number(c.statementDay) : "";
  document.getElementById("cardDueDay").value = Number(c.dueDay) > 0 ? Number(c.dueDay) : "";
  const imEl = document.getElementById("cardInstallmentMonthly");
  if (imEl) imEl.value = Number(c.installmentMonthly) > 0 ? Number(c.installmentMonthly) : "";
  const icEl = document.getElementById("cardInstallmentCount");
  if (icEl) icEl.value = Number(c.installmentRemainingCount) > 0 ? Number(c.installmentRemainingCount) : "";
  setTextSafe("saveCardBtn", "💾 Αποθήκευση");
  const cancelBtn = document.getElementById("cancelCardEditBtn");
  if (cancelBtn) cancelBtn.style.display = "inline-flex";
  document.getElementById("cardName").focus();
}

function cancelCreditCardEditor() {
  ["editingCardId", "cardName", "cardLimit", "cardBalance", "cardInstallmentBalance", "cardInstallmentMonthly", "cardInstallmentCount", "cardInterestRate", "cardMonthlyPayment", "cardStatementDay", "cardDueDay"].forEach(fid => {
    const el = document.getElementById(fid);
    if (el) el.value = "";
  });
  setTextSafe("saveCardBtn", "➕ Προσθήκη Πιστωτικής");
  const cancelBtn = document.getElementById("cancelCardEditBtn");
  if (cancelBtn) cancelBtn.style.display = "none";
}

function deleteLiabilityItem(id) {
  const l = (data.liabilities || []).find(item => item.id === id);
  if (!l) return;
  const offsetAmt = Math.max(0, roundMoney(Number(l.reserveOffsetAmount) || 0));
  const extraNote = offsetAmt > 0
    ? `\n\n(Θα αφαιρεθεί αυτόματα και η ισοστάθμιση αποθεματικού ${money(offsetAmt)} που είχε προστεθεί κατά τη δημιουργία.)`
    : "";
  showModal(`Διαγραφή της οφειλής «${l.name}» (${money(l.remainingBalance)});${extraNote}`, true, (ok) => {
    if (!ok) return;
    if (offsetAmt > 0) {
      data.profile.initialSavings = fromCents(Math.max(0, toCents(data.profile.initialSavings || 0) - toCents(offsetAmt)));
      data.settings.stateUpdatedAt = Date.now();
    }
    data.liabilities = (data.liabilities || []).filter(item => item.id !== id);
    recordEntityDeletion(id);
    persist();
    render();
    showToast(offsetAmt > 0
      ? `🗑️ Η οφειλή διαγράφηκε και επανήλθε το αποθεματικό (-${money(offsetAmt)}).`
      : "🗑️ Η οφειλή διαγράφηκε.");
  }, "Διαγραφή Οφειλής");
}

// --- PAYMENT MODAL (PRINCIPAL vs INTEREST) ---
function openLiabilityPaymentModal(id) {
  const l = (data.liabilities || []).find(item => item.id === id);
  if (!l) return;
  const rem = Math.max(0, roundMoney(l.remainingBalance));
  const instBal = l.type === "Credit Card" ? Math.min(rem, Math.max(0, roundMoney(l.installmentBalance || 0))) : 0;
  const interestBearingBal = l.type === "Credit Card" ? Math.max(0, fromCents(toCents(rem) - toCents(instBal))) : rem;
  const monthly = Math.max(0, roundMoney(l.monthlyPayment));
  const rate = Math.max(0, Number(l.interestRate) || 0);

  let estInterest = rate > 0 && interestBearingBal > 0 ? roundMoney((interestBearingBal * (rate / 100)) / 12) : 0;
  let estPrincipal = 0;
  if (monthly > 0) {
    estInterest = Math.min(estInterest, monthly);
    estPrincipal = Math.min(rem, roundMoney(Math.max(0, monthly - estInterest)));
  } else {
    estPrincipal = rem;
  }

  document.getElementById("payLiabilityId").value = l.id;
  document.getElementById("payLiabilityPrincipal").value = estPrincipal > 0 ? estPrincipal.toFixed(2) : "";
  document.getElementById("payLiabilityInterest").value = estInterest > 0 ? estInterest.toFixed(2) : "0.00";
  document.getElementById("payLiabilityDate").value = today();
  document.getElementById("payLiabilityDesc").value = l.type === "Credit Card" ? `Πληρωμή κάρτας: ${l.name}` : `Δόση: ${l.name}`;

  const instWrap = document.getElementById("payLiabilityInstallmentWrap");
  const instInp = document.getElementById("payLiabilityInstallmentPrincipal");
  if (instWrap && instInp) {
    if (l.type === "Credit Card" && instBal > 0) {
      const estInst = Number(l.installmentMonthly) > 0
        ? Math.min(instBal, estPrincipal, roundMoney(l.installmentMonthly))
        : (Number(l.installmentRemainingCount) > 0
          ? Math.min(instBal, estPrincipal, roundMoney(instBal / Number(l.installmentRemainingCount)))
          : 0);
      instWrap.style.display = "block";
      instInp.value = estInst > 0 ? estInst.toFixed(2) : "0.00";
    } else {
      instWrap.style.display = "none";
      instInp.value = "0.00";
    }
  }

  const infoBar = document.getElementById("payLiabilityInfoBar");
  if (infoBar) {
    const extraCardInfo = l.type === "Credit Card" && instBal > 0
      ? ` (Άτοκες δόσεις: ${money(instBal)} • Κυλιόμενο: ${money(interestBearingBal)})`
      : "";
    infoBar.innerHTML = `<div><strong>${escapeHtml(l.name)}</strong> (${getLiabilityTypeLabel(l.type)})<div class="small">Τρέχον υπόλοιπο: <strong>${money(rem)}</strong>${extraCardInfo}${rate > 0 ? ` • Επιτόκιο: ${rate}%` : ""}</div></div>`;
  }

  recalcLiabilityPaymentPreview();
  document.getElementById("liabilityPaymentModal").style.display = "flex";
}

function closeLiabilityPaymentModal() {
  const m = document.getElementById("liabilityPaymentModal");
  if (m) m.style.display = "none";
}

function recalcLiabilityPaymentPreview() {
  const id = document.getElementById("payLiabilityId")?.value || "";
  const l = (data.liabilities || []).find(item => item.id === id);
  const hint = document.getElementById("payLiabilityImpactHint");
  if (!l || !hint) return;

  const rem = Math.max(0, roundMoney(l.remainingBalance));
  const principal = Math.min(rem, Math.max(0, roundMoney(Number(document.getElementById("payLiabilityPrincipal")?.value) || 0)));
  const interest = Math.max(0, roundMoney(Number(document.getElementById("payLiabilityInterest")?.value) || 0));
  const totalOutflow = fromCents(toCents(principal) + toCents(interest));
  const newRem = fromCents(Math.max(0, toCents(rem) - toCents(principal)));

  hint.innerHTML = `
    <div>💰 Συνολική εκταμίευση: <strong>${money(totalOutflow)}</strong></div>
    <div>📉 Νέο υπόλοιπο: <strong>${money(newRem)}</strong> (μείωση κεφαλαίου ${money(principal)})</div>
    <div>⚖️ Επίδραση στην Καθαρή Θέση (Net Worth): <strong style="color:${interest > 0 ? "var(--danger)" : "var(--accent)"};">-${money(interest)}</strong> <span class="small">(μόνο οι τόκοι μειώνουν το Net Worth)</span></div>
  `;
}

function executeLiabilityPayment() {
  const id = document.getElementById("payLiabilityId")?.value || "";
  const l = (data.liabilities || []).find(item => item.id === id);
  if (!l) return;

  const principalRaw = Number(document.getElementById("payLiabilityPrincipal")?.value) || 0;
  const interestRaw = Number(document.getElementById("payLiabilityInterest")?.value) || 0;
  const dateVal = (document.getElementById("payLiabilityDate")?.value || today()).trim();
  const descVal = (document.getElementById("payLiabilityDesc")?.value || `Πληρωμή: ${l.name}`).trim();

  const pCheck = validateFinancialAmount(principalRaw, { min: 0, max: 1e9, allowZero: true });
  const iCheck = validateFinancialAmount(interestRaw, { min: 0, max: 1e9, allowZero: true });
  const dCheck = validateFinancialDate(dateVal);

  if (!pCheck.ok || !iCheck.ok || !dCheck.ok) {
    showModal("Έλεγξε τα ποσά κεφαλαίου/τόκων και την ημερομηνία πληρωμής.");
    return;
  }

  const currentRem = Math.max(0, roundMoney(l.remainingBalance));
  const principal = Math.min(currentRem, pCheck.value);
  const interest = iCheck.value;
  const totalOutflow = fromCents(toCents(principal) + toCents(interest));

  if (totalOutflow <= 0) {
    showModal("Συμπλήρωσε ποσό κεφαλαίου ή τόκων μεγαλύτερο από €0.");
    return;
  }

  const snapshotBefore = deepClone(data);
  const dirtyBefore = new Set(dirtyTxIds);
  const nowTs = Date.now();

  const currentInstBal = l.type === "Credit Card" ? Math.min(currentRem, Math.max(0, roundMoney(l.installmentBalance || 0))) : 0;
  const rawInstPrincipal = l.type === "Credit Card" ? Math.max(0, roundMoney(Number(document.getElementById("payLiabilityInstallmentPrincipal")?.value) || 0)) : 0;
  const appliedInstPrincipal = l.type === "Credit Card" ? Math.min(currentInstBal, principal, rawInstPrincipal) : 0;

  try {
    l.remainingBalance = fromCents(Math.max(0, toCents(currentRem) - toCents(principal)));
    if (l.type === "Credit Card") {
      const nextInst = fromCents(Math.max(0, toCents(currentInstBal) - toCents(appliedInstPrincipal)));
      l.installmentBalance = Math.min(l.remainingBalance, nextInst);
      if (appliedInstPrincipal > 0 && Number(l.installmentRemainingCount) > 0) {
        l.installmentRemainingCount = l.installmentBalance <= 0
          ? 0
          : Math.max(0, Math.round(Number(l.installmentRemainingCount)) - 1);
      }
    }
    l._updatedAt = nowTs;

    const txId = generateId("tx");
    data.transactions.push({
      id: txId,
      owner: "me",
      type: "expense",
      category: "Λογαριασμοί",
      amount: totalOutflow,
      date: dCheck.value,
      description: descVal,
      linkedLiabilityId: l.id,
      linkedLiabilityType: l.type,
      liabilityPrincipal: principal,
      liabilityInterest: interest,
      liabilityInstallmentPrincipal: appliedInstPrincipal > 0 ? appliedInstPrincipal : undefined,
      _updatedAt: nowTs
    });
    markTxDirty(txId);
    data.settings.stateUpdatedAt = nowTs;

    const saved = persist();
    if (!saved) {
      data = snapshotBefore;
      dirtyTxIds = dirtyBefore;
      showToast("⚠️ Αποτυχία αποθήκευσης πληρωμής — έγινε επαναφορά.");
      return;
    }

    closeLiabilityPaymentModal();
    render();
    showToast(`✅ Καταχωρήθηκε πληρωμή ${money(totalOutflow)} (Κεφάλαιο ${money(principal)} / Τόκοι ${money(interest)})!`);
  } catch {
    data = snapshotBefore;
    dirtyTxIds = dirtyBefore;
    showToast("⚠️ Σφάλμα κατά την καταχώριση πληρωμής.");
  }
}

// --- RENDER LOANS TAB & AMORTIZATION CHART ---
function renderLoansTab() {
  const grid = document.getElementById("loansGrid");
  const badge = document.getElementById("loansSummaryBadge");
  const analytics = document.getElementById("loansAnalyticsBlock");
  if (!grid) return;

  const loans = (Array.isArray(data.liabilities) ? data.liabilities : []).filter(l => l && l.type !== "Credit Card");
  const totalRem = fromCents(loans.reduce((s, l) => s + toCents(Math.max(0, Number(l.remainingBalance) || 0)), 0));
  const totalMonthly = fromCents(loans.reduce((s, l) => s + toCents(Math.max(0, Number(l.monthlyPayment) || 0)), 0));

  const sims = loans.map(l => ({ loan: l, sim: simulateLoanAmortization(l, 120) }));
  const validMonths = sims.map(x => x.sim.months).filter(m => typeof m === "number" && m > 0);
  const maxMonths = validMonths.length > 0 ? Math.max(...validMonths) : 0;
  const estTotalInterest = fromCents(sims.reduce((s, x) => s + toCents(x.sim.totalInterest || 0), 0));
  const anyCapped = sims.some(x => x.sim.capped);

  setTextSafe(
    "loansSummaryLine",
    loans.length > 0
      ? `Συνολικό υπόλοιπο: ${money(totalRem)} • Μηνιαίες δόσεις: ${money(totalMonthly)} • Αφαιρείται αυτόματα από την Καθαρή Θέση.`
      : "Δεν έχουν καταχωρηθεί δάνεια ή δόσεις. Πρόσθεσε ένα δάνειο για να δεις την πορεία αποπληρωμής δόσεων."
  );

  if (badge) {
    badge.style.display = totalRem > 0 ? "inline-flex" : "none";
    badge.textContent = `-${money(totalRem)}`;
  }

  if (loans.length === 0) {
    if (analytics) analytics.style.display = "none";
    grid.innerHTML = `<div class="small">Κανένα ενεργό δάνειο. Κατά την εισαγωγή αρχείου Τράπεζας/Revolut, οι χρεώσεις δανείων και δόσεων εντοπίζονται αυτόματα πριν την ενσωμάτωση.</div>`;
    return;
  }

  if (analytics) {
    analytics.style.display = "block";
    setTextSafe("loansTotalRemainingCard", money(totalRem));
    setTextSafe("loansTotalMonthlyCard", `${money(totalMonthly)}/μήνα`);
    setTextSafe("loansMaxInstallmentsCard", maxMonths > 0 ? `${maxMonths}${anyCapped ? "+" : ""} δόσεις` : "—");
    setTextSafe("loansEstInterestCard", money(estTotalInterest));
    setTextSafe("loansChartNote", maxMonths > 0 ? (anyCapped ? "Προβολή έως 120 μήνες" : `Εξόφληση σε ${maxMonths} μήνες`) : "Συμπλήρωσε «Μηνιαία Δόση» για προβολή καμπύλης");

    const canvas = document.getElementById("loansChart");
    const isVisible = document.getElementById("tab-loans")?.classList.contains("active");
    if (canvas && typeof Chart !== "undefined" && isVisible) {
      const theme = getChartThemeTokens();
      const horizon = Math.max(1, maxMonths);
      const labels = [];
      const series = [];
      for (let m = 0; m <= horizon; m++) {
        labels.push(m === 0 ? "Σήμερα" : `Μήνας ${m}`);
        let sumM = 0;
        sims.forEach(({ loan, sim }) => {
          if (sim.months === null) {
            sumM += Math.max(0, roundMoney(loan.remainingBalance || 0));
          } else {
            const idx = Math.min(m, sim.balances.length - 1);
            sumM += sim.balances[idx] || 0;
          }
        });
        series.push(roundMoney(sumM));
      }

      if (loansChartInstance) {
        loansChartInstance.data.labels = labels;
        loansChartInstance.data.datasets[0].data = series;
        loansChartInstance.options.plugins.legend.labels.color = theme.textColor;
        loansChartInstance.options.scales.x.ticks.color = theme.mutedColor;
        loansChartInstance.options.scales.x.grid.color = theme.gridColor;
        loansChartInstance.options.scales.y.ticks.color = theme.mutedColor;
        loansChartInstance.options.scales.y.grid.color = theme.gridColor;
        loansChartInstance.update("none");
      } else {
        loansChartInstance = new Chart(canvas, {
          type: "line",
          data: {
            labels,
            datasets: [{
              label: "Υπόλοιπο Κεφαλαίου Δανείων (€)",
              data: series,
              borderColor: "#f43f5e",
              backgroundColor: "rgba(244, 63, 94, 0.16)",
              borderWidth: 2.5,
              pointRadius: horizon <= 24 ? 3 : 0,
              fill: true,
              tension: 0.25
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: "index", intersect: false },
            scales: {
              x: { ticks: { color: theme.mutedColor, maxTicksLimit: 10 }, grid: { color: theme.gridColor } },
              y: {
                beginAtZero: true,
                ticks: { color: theme.mutedColor, callback: (v) => `€${Number(v).toLocaleString("el-GR")}` },
                grid: { color: theme.gridColor }
              }
            },
            plugins: {
              legend: { position: "bottom", labels: { color: theme.textColor, usePointStyle: true } },
              tooltip: { callbacks: { label: (ctx) => ` Υπόλοιπο: ${money(ctx.raw)}` } }
            }
          }
        });
      }
    }
  }

  grid.innerHTML = sims.map(({ loan: l, sim }) => {
    const initAmt = Math.max(0, roundMoney(l.initialAmount || l.remainingBalance || 0));
    const remAmt = Math.max(0, roundMoney(l.remainingBalance || 0));
    const paidAmt = Math.max(0, fromCents(toCents(initAmt) - toCents(remAmt)));
    const paidPct = initAmt > 0 ? Math.min(100, Math.max(0, (paidAmt / initAmt) * 100)) : (remAmt === 0 ? 100 : 0);
    const rateStr = Number(l.interestRate) > 0 ? `${Number(l.interestRate).toFixed(2)}%` : "0%";
    const monthlyStr = Number(l.monthlyPayment) > 0 ? `${money(l.monthlyPayment)}/μήνα` : "—";
    const instBadge = sim.stalled
      ? `<span class="badge expense" style="font-size:10px;">⚠️ Δόση ≤ Τόκων</span>`
      : (typeof sim.months === "number" && sim.months > 0
        ? `<span class="badge saving" style="font-size:10px;">~${sim.months}${sim.capped ? "+" : ""} δόσεις</span>`
        : "");

    return `
      <div class="kpi-card">
        <div class="kpi-label">
          <div style="display:flex; flex-wrap:wrap; align-items:center; gap:5px;">
            <strong>${escapeHtml(l.name)}</strong>
            <span class="badge expense" style="font-size:10px;">${getLiabilityTypeLabel(l.type)}</span>
            ${instBadge}
          </div>
          <div style="display:flex; gap:4px; flex-shrink:0;">
            <button type="button" class="secondary small-btn" data-lid="${escapeHtml(l.id)}" onclick="editLoanLiabilityItem(this.dataset.lid)" aria-label="Επεξεργασία δανείου" title="Επεξεργασία">✏️</button>
            <button type="button" class="danger small-btn" data-lid="${escapeHtml(l.id)}" onclick="deleteLiabilityItem(this.dataset.lid)" aria-label="Διαγραφή δανείου" title="Διαγραφή">🗑️</button>
          </div>
        </div>
        <div class="metric red privacy-sensitive" style="font-size:20px;">${money(remAmt)}</div>
        <div class="small" style="margin-top:4px;">
          Αρχικό: <strong>${money(initAmt)}</strong> • Εξοφλήθηκε: <strong>${paidPct.toFixed(0)}%</strong>
        </div>
        <div class="progress" style="height:6px; margin:6px 0 8px;">
          <div style="width:${paidPct}%; background:var(--accent);"></div>
        </div>
        <div class="small" style="margin-bottom:10px;">
          Δόση: <strong>${monthlyStr}</strong> • Επιτόκιο: <strong>${rateStr}</strong>${l.endDate ? ` • Λήξη: ${escapeHtml(l.endDate)}` : ""}
        </div>
        <button type="button" class="secondary small-btn" style="width:100%;" data-lid="${escapeHtml(l.id)}" onclick="openLiabilityPaymentModal(this.dataset.lid)" ${remAmt <= 0 ? "disabled" : ""}>
          ${remAmt <= 0 ? "✅ Εξοφλημένο" : "💸 Καταχώριση Πληρωμής Δόσης"}
        </button>
      </div>
    `;
  }).join("");
}

// --- RENDER CREDIT CARDS TAB & UTILIZATION CHART ---
function renderCreditCardsTab() {
  const grid = document.getElementById("creditCardsGrid");
  const badge = document.getElementById("cardsSummaryBadge");
  const analytics = document.getElementById("cardsAnalyticsBlock");
  if (!grid) return;

  const cards = (Array.isArray(data.liabilities) ? data.liabilities : []).filter(l => l && l.type === "Credit Card");
  const totalBalance = fromCents(cards.reduce((s, c) => s + toCents(Math.max(0, Number(c.remainingBalance) || 0)), 0));
  const totalInst = fromCents(cards.reduce((s, c) => s + toCents(Math.min(Math.max(0, Number(c.remainingBalance) || 0), Math.max(0, Number(c.installmentBalance) || 0))), 0));
  const totalRevolving = fromCents(Math.max(0, toCents(totalBalance) - toCents(totalInst)));
  const totalLimit = fromCents(cards.reduce((s, c) => s + toCents(Math.max(0, Number(c.creditLimit || c.initialAmount) || 0)), 0));
  const availableLimit = fromCents(Math.max(0, toCents(totalLimit) - toCents(totalBalance)));
  const utilPct = totalLimit > 0 ? (totalBalance / totalLimit) * 100 : 0;

  setTextSafe(
    "cardsSummaryLine",
    cards.length > 0
      ? `Υπόλοιπο: ${money(totalBalance)} από όριο ${money(totalLimit)} (${utilPct.toFixed(1)}% χρήση) • Άτοκες δόσεις: ${money(totalInst)} • Κυλιόμενο: ${money(totalRevolving)}`
      : "Δεν έχουν καταχωρηθεί πιστωτικές κάρτες. Πρόσθεσε τις κάρτες σου για έλεγχο ορίου, άτοκων δόσεων και τόκων."
  );

  if (badge) {
    badge.style.display = totalBalance > 0 ? "inline-flex" : "none";
    badge.textContent = `-${money(totalBalance)}`;
  }

  if (cards.length === 0) {
    if (analytics) analytics.style.display = "none";
    grid.innerHTML = `<div class="small">Καμία καταχωρισμένη πιστωτική κάρτα. Οι πιστωτικές κάρτες διαχειρίζονται ξεχωριστά από τα δάνεια λόγω πιστωτικού ορίου, άτοκων δόσεων και κυλιόμενου επιτοκίου.</div>`;
    return;
  }

  if (analytics) {
    analytics.style.display = "block";
    setTextSafe("cardsTotalBalanceCard", money(totalBalance));
    setTextSafe("cardsSplitSubLine", `Κυλιόμενο: ${money(totalRevolving)} • Άτοκες: ${money(totalInst)}`);
    setTextSafe("cardsTotalLimitCard", money(totalLimit));
    setTextSafe("cardsAvailableLimitCard", money(availableLimit));

    const utilEl = document.getElementById("cardsUtilizationCard");
    if (utilEl) {
      utilEl.textContent = `${utilPct.toFixed(1)}%`;
      utilEl.className = `metric ${utilPct <= 30 ? "accent" : (utilPct <= 70 ? "" : "red")}`;
    }
    setTextSafe(
      "cardsUtilizationHint",
      utilPct <= 30 ? "🟢 Υγιής χρήση (<30%)" : (utilPct <= 70 ? "🟡 Μέτρια χρήση (30–70%)" : "🔴 Υψηλή χρήση (>70%)")
    );

    const canvas = document.getElementById("creditCardsChart");
    const isVisible = document.getElementById("tab-cards")?.classList.contains("active");
    if (canvas && typeof Chart !== "undefined" && isVisible) {
      const theme = getChartThemeTokens();
      const labels = cards.map(c => c.name);
      const revData = cards.map(c => {
        const b = Math.max(0, roundMoney(c.remainingBalance || 0));
        const inst = Math.min(b, Math.max(0, roundMoney(c.installmentBalance || 0)));
        return fromCents(Math.max(0, toCents(b) - toCents(inst)));
      });
      const instData = cards.map(c => Math.min(Math.max(0, roundMoney(c.remainingBalance || 0)), Math.max(0, roundMoney(c.installmentBalance || 0))));
      const availData = cards.map(c => {
        const lim = Math.max(0, roundMoney(c.creditLimit || c.initialAmount || 0));
        const b = Math.max(0, roundMoney(c.remainingBalance || 0));
        return fromCents(Math.max(0, toCents(lim) - toCents(b)));
      });

      if (creditCardsChartInstance) {
        creditCardsChartInstance.data.labels = labels;
        creditCardsChartInstance.data.datasets[0].data = revData;
        creditCardsChartInstance.data.datasets[1].data = instData;
        creditCardsChartInstance.data.datasets[2].data = availData;
        creditCardsChartInstance.options.plugins.legend.labels.color = theme.textColor;
        creditCardsChartInstance.options.scales.x.ticks.color = theme.mutedColor;
        creditCardsChartInstance.options.scales.x.grid.color = theme.gridColor;
        creditCardsChartInstance.options.scales.y.ticks.color = theme.textColor;
        creditCardsChartInstance.options.scales.y.grid.color = theme.gridColor;
        creditCardsChartInstance.update("none");
      } else {
        creditCardsChartInstance = new Chart(canvas, {
          type: "bar",
          data: {
            labels,
            datasets: [
              { label: "Κυλιόμενο / Λογαριασμός (€)", data: revData, backgroundColor: "#f43f5e", borderRadius: 4 },
              { label: "Άτοκες Δόσεις (€)", data: instData, backgroundColor: "#f59e0b", borderRadius: 4 },
              { label: "Διαθέσιμο Όριο (€)", data: availData, backgroundColor: "rgba(16, 185, 129, 0.28)", borderColor: "#10b981", borderWidth: 1, borderRadius: 4 }
            ]
          },
          options: {
            indexAxis: "y",
            responsive: true,
            maintainAspectRatio: false,
            scales: {
              x: {
                stacked: true,
                ticks: { color: theme.mutedColor, callback: (v) => `€${Number(v).toLocaleString("el-GR")}` },
                grid: { color: theme.gridColor }
              },
              y: { stacked: true, ticks: { color: theme.textColor }, grid: { color: theme.gridColor } }
            },
            plugins: {
              legend: { position: "bottom", labels: { color: theme.textColor, usePointStyle: true } },
              tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${money(ctx.raw)}` } }
            }
          }
        });
      }
    }
  }

  grid.innerHTML = cards.map(c => {
    const lim = Math.max(0, roundMoney(c.creditLimit || c.initialAmount || 0));
    const bal = Math.max(0, roundMoney(c.remainingBalance || 0));
    const inst = Math.min(bal, Math.max(0, roundMoney(c.installmentBalance || 0)));
    const rev = fromCents(Math.max(0, toCents(bal) - toCents(inst)));
    const avail = fromCents(Math.max(0, toCents(lim) - toCents(bal)));
    const pct = lim > 0 ? Math.min(100, (bal / lim) * 100) : 0;
    const utilColor = pct <= 30 ? "var(--accent)" : (pct <= 70 ? "var(--warn)" : "var(--danger)");
    const rateStr = Number(c.interestRate) > 0 ? `${Number(c.interestRate).toFixed(2)}%` : "0%";
    const cycleInfo = [
      c.statementDay ? `Έκδοση: ${c.statementDay}η` : "",
      c.dueDay ? `Πληρωμή: ${c.dueDay}η` : ""
    ].filter(Boolean).join(" • ");

    return `
      <div class="kpi-card">
        <div class="kpi-label">
          <div style="display:flex; flex-wrap:wrap; align-items:center; gap:5px;">
            <strong>${escapeHtml(c.name)}</strong>
            <span class="badge ${pct > 70 ? "expense" : (pct > 30 ? "withdrawal" : "income")}" style="font-size:10px;">${pct.toFixed(0)}% ορίου</span>
          </div>
          <div style="display:flex; gap:4px; flex-shrink:0;">
            <button type="button" class="secondary small-btn" data-lid="${escapeHtml(c.id)}" onclick="editCreditCardItem(this.dataset.lid)" aria-label="Επεξεργασία κάρτας" title="Επεξεργασία">✏️</button>
            <button type="button" class="danger small-btn" data-lid="${escapeHtml(c.id)}" onclick="deleteLiabilityItem(this.dataset.lid)" aria-label="Διαγραφή κάρτας" title="Διαγραφή">🗑️</button>
          </div>
        </div>
        <div class="metric red privacy-sensitive" style="font-size:20px;">${money(bal)}</div>
        <div class="small" style="margin-top:4px;">
          Όριο: <strong>${money(lim)}</strong> • Διαθέσιμο: <strong style="color:var(--accent);">${money(avail)}</strong>
        </div>
        <div class="progress" style="height:6px; margin:6px 0 8px;">
          <div style="width:${pct}%; background:${utilColor};"></div>
        </div>
        <div class="small" style="margin-bottom:4px;">
          Κυλιόμενο: <strong>${money(rev)}</strong> • Άτοκες δόσεις: <strong>${money(inst)}</strong>${Number(c.installmentRemainingCount) > 0 ? ` (${Number(c.installmentRemainingCount)} δόσεις${Number(c.installmentMonthly) > 0 ? ` × ${money(c.installmentMonthly)}` : ""})` : ""}
        </div>
        <div class="small" style="margin-bottom:10px;">
          Επιτόκιο: <strong>${rateStr}</strong>${cycleInfo ? ` • ${cycleInfo}` : ""}
        </div>
        <button type="button" class="secondary small-btn" style="width:100%;" data-lid="${escapeHtml(c.id)}" onclick="openLiabilityPaymentModal(this.dataset.lid)" ${bal <= 0 ? "disabled" : ""}>
          ${bal <= 0 ? "✅ Μηδενικό Υπόλοιπο" : "💸 Καταχώριση Πληρωμής Κάρτας"}
        </button>
      </div>
    `;
  }).join("");
}

function renderLiabilities() {
  renderLoansTab();
  renderCreditCardsTab();
}

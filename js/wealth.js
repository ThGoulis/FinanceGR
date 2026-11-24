/* ==========================================================================
   9. PORTFOLIO (CLOUDFLARE WORKER LIVE QUOTES), ANALYTICS, FIRE & E-RECEIPTS
   ========================================================================== */
const CF_QUOTES_WORKER_URL = "https://financegr-quotes.tgoulis.workers.dev";
let activePortfolioFilter = "all";
let lastTestedQuote = null;

function toggleTickerLookupBox() {
  const box = document.getElementById("tickerLookupBox");
  if (!box) return;
  const isHidden = box.style.display === "none" || !box.style.display;
  box.style.display = isHidden ? "block" : "none";
  if (isHidden) {
    document.getElementById("testTickerInput")?.focus();
  }
}

function quickTestTicker(symbol) {
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

function convertPriceToEur(rawPrice, rawCurrency) {
  const px = Number(rawPrice);
  if (!(px > 0) || !Number.isFinite(px)) return null;
  const rawCurr = String(rawCurrency || "EUR").trim();
  const curr = rawCurr.toUpperCase();
  // Never value foreign-currency assets with hard-coded/stale FX assumptions.
  // The quotes Worker must supply priceEur (or a future timestamped FX rate).
  if (curr === "EUR") return { priceEur: px, currency: "EUR", fxSource: "quote_currency" };
  return null;
}

async function fetchCloudflareWorkerQuote(rawTicker) {
  const symbol = String(rawTicker || "").trim().toUpperCase();
  if (!symbol) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const url = `${CF_QUOTES_WORKER_URL}/?symbol=${encodeURIComponent(symbol)}`;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const json = await res.json();
    const rawPrice = Number(json?.price);
    if (!(rawPrice > 0)) {
      throw new Error("Μη έγκυρη τιμή");
    }

    const directEur = Number(json?.priceEur);
    const conv = Number.isFinite(directEur) && directEur > 0
      ? { priceEur: directEur, currency: String(json.currency || "EUR").trim(), fxSource: json?.fxSource || "worker_priceEur" }
      : convertPriceToEur(rawPrice, json?.currency || "EUR");

    if (!conv) {
      throw new Error(`Δεν υπάρχει αξιόπιστη ισοτιμία EUR για το νόμισμα ${json?.currency || "?"}. Ο quotes Worker πρέπει να επιστρέψει priceEur.`);
    }

    const prevCloseRaw = Number(json?.previousClose);
    let dayChangePct = null;
    let prevCloseEur = null;
    if (prevCloseRaw > 0) {
      dayChangePct = Number((((rawPrice - prevCloseRaw) / prevCloseRaw) * 100).toFixed(2));
      const fxRatio = conv.priceEur / rawPrice;
      prevCloseEur = Number((prevCloseRaw * fxRatio).toFixed(6));
    }

    return {
      ticker: json.ticker || symbol,
      name: json.name || json.ticker || symbol,
      exchange: json.exchange || "",
      priceEur: Number(conv.priceEur.toFixed(6)),
      prevCloseEur,
      dayChangePct,
      rawPrice,
      currency: conv.currency,
      marketTime: json.marketTime || new Date().toISOString()
    };
  } finally {
    clearTimeout(timer);
  }
}

async function runLiveTickerTest() {
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
      out.textContent = `❌ Δεν βρέθηκε τιμή για ${ticker} (${err?.message || "Σφάλμα σύνδεσης"}). Δοκίμασε VUAA.MI, VWCE.DE ή OPAP.AT.`;
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function refreshPortfolioMarketPrices(forceManual = false) {
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
      } else {
        try {
          const quote = await fetchCloudflareWorkerQuote(symbol);
          const prevPx = Number(asset.lastUnitPriceEur) || 0;
          const implausible = prevPx > 0 && quote && (quote.priceEur / prevPx > 5 || quote.priceEur / prevPx < 0.2);
          if (quote && quote.priceEur > 0 && !implausible) {
            unitPriceEur = quote.priceEur;
            dayChangePct = quote.dayChangePct;
            prevCloseEur = quote.prevCloseEur;
            data.settings.etfQuotesCache[symbol] = {
              priceEur: Number(unitPriceEur.toFixed(6)),
              prevCloseEur,
              dayChangePct,
              fetchedAt: Date.now()
            };
          }
        } catch (err) {
          console.warn(`Quote fetch failed for ${symbol}:`, err?.message || err);
        }
      }

      if (unitPriceEur && unitPriceEur > 0) {
        asset.lastUnitPriceEur = Number(unitPriceEur.toFixed(4));
        asset.prevCloseEur = prevCloseEur;
        asset.dayChangePct = dayChangePct;
        asset.lastPriceUpdatedAt = Date.now();
        asset.current = Number((unitPriceEur * Number(asset.units)).toFixed(2));
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
      showModal("Δεν βρέθηκε τιμή για τα συγκεκριμένα tickers. Έλεγξε τη μορφή (π.χ. VUAA.MI, VWCE.DE, OPAP.AT, VOO).");
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

function addDcaToPortfolioAsset(id, addEuro = 100) {
  const asset = data.portfolioAssets.find(a => a.id === id);
  const rawContribution = Number(addEuro);
  if (!asset || !Number.isFinite(rawContribution) || rawContribution <= 0 || rawContribution > 1e9) return false;
  const contribution = Number(rawContribution.toFixed(2));
  if (!(contribution > 0)) return false;

  const prevUnits = Math.max(0, Number(asset.units) || 0);
  const prevCurrent = Math.max(0, Number(asset.current) || 0);
  const unitPrice = Number(asset.lastUnitPriceEur) > 0
    ? Number(asset.lastUnitPriceEur)
    : (prevUnits > 0 && prevCurrent > 0 ? prevCurrent / prevUnits : 0);

  asset.invested = Number(((Number(asset.invested) || 0) + contribution).toFixed(2));
  if (unitPrice > 0) {
    asset.units = Number((prevUnits + contribution / unitPrice).toFixed(8));
  }
  // Preserve the pre-DCA valuation and add only the new contribution; do not
  // revalue existing units from a potentially stale lastUnitPriceEur cache.
  asset.current = Number((prevCurrent + contribution).toFixed(2));
  asset._updatedAt = Date.now();

  // DCA is an internal transfer: cash flow decreases while portfolio assets increase.
  // This keeps total Net Worth unchanged at the moment of contribution (before market movement).
  const txId = generateId("tx");
  data.transactions.push({
    id: txId,
    owner: "me",
    type: "saving",
    amount: Number(contribution.toFixed(2)),
    date: today(),
    category: "Επένδυση",
    source: "DCA",
    description: `DCA — ${asset.name || asset.ticker || "Επένδυση"}`,
    linkedPortfolioAssetId: asset.id,
    isShared: false,
    settled: true,
    _updatedAt: Date.now()
  });
  markTxDirty(txId);
  data.settings.stateUpdatedAt = Date.now();
  persist();
  render();
  showToast(`📈 +${money(contribution)} DCA στη θέση «${asset.name}»!`);
  return true;
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
  showModal("Διαγραφή αυτής της επενδυτικής θέσης;", true, (ok) => {
    if (!ok) return;
    data.portfolioAssets = data.portfolioAssets.filter(a => a.id !== id);
    recordEntityDeletion(id);
    persist();
    render();
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
            <strong>${escapeHtml(a.name)}</strong> ${tickerBadge} ${dayBadge}
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

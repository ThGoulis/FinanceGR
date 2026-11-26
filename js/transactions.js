/* ==========================================================================
   6. TRANSACTIONS, QUICK PRESETS & COUPLE SETTLEMENT
   ========================================================================== */
const selectedTxIds = new Set();
let txDisplayLimit = 100;
let txSharedManuallyTouched = false;

function onTransactionCategoryChange() {
  const editId = document.getElementById("editingTransactionId")?.value || "";
  const typeVal = document.getElementById("txType")?.value || "expense";
  const catVal = document.getElementById("category")?.value || "";
  const split = getCoupleSplit();
  if (!editId && split.hasPartner && typeVal === "expense" && !txSharedManuallyTouched) {
    const sharedCb = document.getElementById("txIsShared");
    if (sharedCb) {
      sharedCb.checked = catVal === "Στέγαση";
    }
  }
  updateSharedTxPreview();
}

function syncCategoryDropdown(typeVal, selectedCat = "") {
  const catSel = document.getElementById("category");
  if (!catSel) return;
  let list = EXPENSE_CATEGORIES;
  if (typeVal === "income") list = INCOME_CATEGORIES;
  else if (typeVal === "saving" || typeVal === "withdrawal") list = SAVING_CATEGORIES;

  catSel.innerHTML = list.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  if (selectedCat && list.includes(selectedCat)) {
    catSel.value = selectedCat;
  } else if (selectedCat) {
    catSel.insertAdjacentHTML("beforeend", `<option value="${escapeHtml(selectedCat)}">${escapeHtml(selectedCat)}</option>`);
    catSel.value = selectedCat;
  }
}

function syncTxCreditCardOptions(selectedCardId = "") {
  const wrap = document.getElementById("txCreditCardWrap");
  const sel = document.getElementById("txCreditCardId");
  if (!wrap || !sel) return;
  const txType = document.getElementById("txType")?.value || "expense";
  const cards = (Array.isArray(data.liabilities) ? data.liabilities : []).filter(l => l && l.type === "Credit Card");
  if (txType !== "expense" || cards.length === 0) {
    wrap.style.display = "none";
    sel.innerHTML = `<option value="">Όχι (Μετρητά / Χρεωστική)</option>`;
    sel.value = "";
    return;
  }
  wrap.style.display = "block";
  sel.innerHTML = `<option value="">Όχι (Μετρητά / Χρεωστική)</option>` +
    cards.map(c => `<option value="${escapeHtml(c.id)}">💳 ${escapeHtml(c.name)} (Υπόλοιπο: ${money(c.remainingBalance || 0)})</option>`).join("");
  sel.value = selectedCardId && cards.some(c => c.id === selectedCardId) ? selectedCardId : "";
}

function selectTransactionType(typeVal) {
  const hidden = document.getElementById("txType");
  if (hidden) hidden.value = typeVal;
  ["expense", "income", "saving", "withdrawal"].forEach(t => {
    document.getElementById(`typeBtn_${t}`)?.classList.toggle("active", t === typeVal);
  });
  syncCategoryDropdown(typeVal);
  const unexpWrap = document.getElementById("unexpectedWrap");
  if (unexpWrap) unexpWrap.style.display = typeVal === "expense" ? "flex" : "none";
  syncTxCreditCardOptions(document.getElementById("txCreditCardId")?.value || "");
  updateSharedTxPreview();
}

function applyQuickTxPreset(typeVal, catVal, amtVal, descVal) {
  selectTransactionType(typeVal);
  syncCategoryDropdown(typeVal, catVal);
  document.getElementById("amount").value = amtVal.toFixed(2);
  document.getElementById("description").value = descVal;
  const split = getCoupleSplit();
  const sharedCb = document.getElementById("txIsShared");
  if (sharedCb && split.hasPartner && typeVal === "expense") {
    sharedCb.checked = (catVal === "Στέγαση") || (catVal === "Τρόφιμα" && amtVal >= 10);
  }
  updateSharedTxPreview();
  document.getElementById("amount").focus();
}

function updateSharedTxPreview() {
  const split = getCoupleSplit();
  const ctrl = document.getElementById("sharedTxControls");
  const typeVal = document.getElementById("txType")?.value || "expense";
  if (!ctrl) return;

  if (!split.hasPartner || typeVal !== "expense") {
    ctrl.style.display = "none";
    return;
  }
  ctrl.style.display = "block";

  const isShared = Boolean(document.getElementById("txIsShared")?.checked);
  const details = document.getElementById("sharedTxDetails");
  if (details) details.style.display = isShared ? "block" : "none";

  if (isShared) {
    const amt = Math.max(0, Number(document.getElementById("amount")?.value) || 0);
    const myShare = (amt * split.myPct) / 100;
    const ptShare = (amt * split.partnerPct) / 100;
    setTextSafe(
      "sharedTxSplitHint",
      `Αναλογία: ${split.myName} ${split.myPct}% (${money(myShare)}) • ${split.partnerName} ${split.partnerPct}% (${money(ptShare)})`
    );
  }
}

function openTransactionModal(editId = null) {
  const modal = document.getElementById("transactionModal");
  const split = getCoupleSplit();
  document.getElementById("editingTransactionId").value = editId || "";
  txSharedManuallyTouched = Boolean(editId);
  const presetsRow = document.getElementById("quickPresetsRow");
  if (presetsRow) presetsRow.style.display = editId ? "none" : "flex";

  if (editId) {
    const tx = data.transactions.find(t => t.id === editId);
    if (!tx) return;
    setTextSafe("transactionFormTitle", "✏️ Επεξεργασία Συναλλαγής");
    selectTransactionType(tx.type || "expense");
    syncCategoryDropdown(tx.type || "expense", tx.category);
    document.getElementById("amount").value = tx.amount;
    document.getElementById("date").value = tx.date;
    document.getElementById("txSource").value = tx.source || "";
    document.getElementById("description").value = tx.description || "";
    document.getElementById("unexpected").checked = Boolean(tx.unexpected);
    document.getElementById("txIsShared").checked = Boolean(tx.isShared && split.hasPartner);
    document.getElementById("txPaidBy").value = tx.paidBy || "me";
    syncTxCreditCardOptions(tx.paidByCreditCardId || "");
  } else {
    setTextSafe("transactionFormTitle", "➕ Νέα Συναλλαγή");
    selectTransactionType("expense");
    document.getElementById("amount").value = "";
    document.getElementById("date").value = today();
    document.getElementById("txSource").value = "";
    document.getElementById("description").value = "";
    document.getElementById("unexpected").checked = false;
    const defaultCat = document.getElementById("category")?.value || "";
    document.getElementById("txIsShared").checked = Boolean(split.hasPartner && defaultCat === "Στέγαση");
    document.getElementById("txPaidBy").value = "me";
    syncTxCreditCardOptions("");
  }

  updateSharedTxPreview();
  modal.style.display = "flex";
  setTimeout(() => document.getElementById("amount")?.focus(), 60);
}

function closeTransactionModal() {
  document.getElementById("transactionModal").style.display = "none";
}

function addTransaction(keepOpen = false) {
  const editId = document.getElementById("editingTransactionId").value;
  const type = document.getElementById("txType").value || "expense";
  const amount = Number(document.getElementById("amount").value);
  const date = document.getElementById("date").value;
  const category = document.getElementById("category").value;
  const source = document.getElementById("txSource").value;
  const description = document.getElementById("description").value.trim() || category;
  const unexpected = type === "expense" && Boolean(document.getElementById("unexpected").checked);

  const amtCheck = validateFinancialAmount(amount, { min: 0.01, max: 1e9 });
  if (!amtCheck.ok) {
    showModal(amtCheck.error);
    return;
  }
  const dateCheck = validateFinancialDate(date);
  if (!dateCheck.ok) {
    showModal(dateCheck.error);
    return;
  }
  const catCheck = validateFinancialCategory(category);
  if (!catCheck.ok) {
    showModal(catCheck.error);
    return;
  }

  const split = getCoupleSplit();
  const isShared = split.hasPartner && type === "expense" && Boolean(document.getElementById("txIsShared").checked);
  const paidBy = isShared ? (document.getElementById("txPaidBy").value || "me") : undefined;
  const selectedCardId = type === "expense" ? String(document.getElementById("txCreditCardId")?.value || "").trim() : "";
  const validCard = selectedCardId
    ? (data.liabilities || []).find(l => l && l.id === selectedCardId && l.type === "Credit Card")
    : null;
  const paidByCreditCardId = validCard ? validCard.id : undefined;

  const nowTs = Date.now();
  const newAmt = amtCheck.value;

  if (editId) {
    const idx = data.transactions.findIndex(t => t.id === editId);
    if (idx !== -1) {
      const oldTx = data.transactions[idx];
      const oldEffect = oldTx.type === "saving" ? (Number(oldTx.amount) || 0) : (oldTx.type === "withdrawal" ? -(Number(oldTx.amount) || 0) : 0);
      const newEffect = type === "saving" ? newAmt : (type === "withdrawal" ? -newAmt : 0);
      const effectDelta = fromCents(toCents(newEffect) - toCents(oldEffect));
      let nextDcaAddedUnits = oldTx.dcaAddedUnits;
      let nextLinkedLiabilityId = oldTx.linkedLiabilityId;
      let nextLiabilityPrincipal = oldTx.liabilityPrincipal;
      let nextLiabilityInterest = oldTx.liabilityInterest;

      if (effectDelta !== 0) {
        if (oldTx.linkedGoalId) {
          const g = (data.goals || []).find(item => item.id === oldTx.linkedGoalId);
          if (g) {
            g.saved = Math.max(0, fromCents(toCents(g.saved || 0) + toCents(effectDelta)));
            data.settings.stateUpdatedAt = nowTs;
          }
        }
        if (oldTx.linkedAnnualBillId) {
          const b = (data.annualBills || []).find(item => item.id === oldTx.linkedAnnualBillId);
          if (b) {
            b.saved = Math.max(0, fromCents(toCents(b.saved || 0) + toCents(effectDelta)));
            data.settings.stateUpdatedAt = nowTs;
          }
        }
        if (oldTx.linkedPortfolioAssetId) {
          const asset = (data.portfolioAssets || []).find(a => a && a.id === oldTx.linkedPortfolioAssetId);
          if (asset) {
            const prevUnits = Math.max(0, Number(asset.units) || 0);
            const unitPx = Number(oldTx.dcaUnitPriceEur) > 0
              ? Number(oldTx.dcaUnitPriceEur)
              : (Number(asset.lastUnitPriceEur) > 0 ? Number(asset.lastUnitPriceEur) : 0);
            asset.invested = Math.max(0, fromCents(toCents(asset.invested || 0) + toCents(effectDelta)));
            if (unitPx > 0 && prevUnits > 0) {
              const deltaUnits = effectDelta / unitPx;
              asset.units = Math.max(0, Number((prevUnits + deltaUnits).toFixed(8)));
              const valuationPx = Number(asset.lastUnitPriceEur) > 0 ? Number(asset.lastUnitPriceEur) : unitPx;
              asset.current = asset.units > 0 ? roundMoney(asset.units * valuationPx) : 0;
              if (type === "saving") {
                nextDcaAddedUnits = Number((newAmt / unitPx).toFixed(8));
              }
            } else {
              asset.current = Math.max(0, fromCents(toCents(asset.current || 0) + toCents(effectDelta)));
            }
            asset._updatedAt = nowTs;
            data.settings.stateUpdatedAt = nowTs;
          }
        }
      }

      // Reconcile linked liability installment payment if edited
      if (oldTx.linkedLiabilityId) {
        const liab = (data.liabilities || []).find(l => l && l.id === oldTx.linkedLiabilityId);
        const oldPrincipal = Math.max(0, roundMoney(oldTx.liabilityPrincipal || 0));
        if (liab) {
          if (type === "expense") {
            const keptInterest = Math.min(newAmt, Math.max(0, roundMoney(oldTx.liabilityInterest || 0)));
            const newPrincipal = fromCents(Math.max(0, toCents(newAmt) - toCents(keptInterest)));
            const principalDeltaCents = toCents(newPrincipal) - toCents(oldPrincipal);
            if (principalDeltaCents !== 0) {
              liab.remainingBalance = fromCents(Math.max(0, toCents(liab.remainingBalance || 0) - principalDeltaCents));
              if (liab.type === "Credit Card" && Number(liab.installmentBalance) > liab.remainingBalance) {
                liab.installmentBalance = liab.remainingBalance;
              }
              liab._updatedAt = nowTs;
              data.settings.stateUpdatedAt = nowTs;
            }
            nextLiabilityPrincipal = newPrincipal;
            nextLiabilityInterest = keptInterest;
          } else {
            // Changed away from expense: restore old principal to liability
            if (oldPrincipal > 0) {
              liab.remainingBalance = fromCents(toCents(liab.remainingBalance || 0) + toCents(oldPrincipal));
              liab._updatedAt = nowTs;
              data.settings.stateUpdatedAt = nowTs;
            }
            nextLinkedLiabilityId = undefined;
            nextLiabilityPrincipal = undefined;
            nextLiabilityInterest = undefined;
          }
        }
      }

      // Reconcile credit card purchase balance if old or new tx is charged to a credit card
      const oldCardId = oldTx.type === "expense" ? (oldTx.paidByCreditCardId || "") : "";
      const newCardId = paidByCreditCardId || "";
      if (oldCardId && oldCardId === newCardId) {
        const amtDeltaCents = toCents(newAmt) - toCents(oldTx.amount || 0);
        if (amtDeltaCents !== 0) {
          const card = (data.liabilities || []).find(l => l && l.id === newCardId);
          if (card) {
            card.remainingBalance = fromCents(Math.max(0, toCents(card.remainingBalance || 0) + amtDeltaCents));
            card._updatedAt = nowTs;
            data.settings.stateUpdatedAt = nowTs;
          }
        }
      } else {
        if (oldCardId) {
          const oldCard = (data.liabilities || []).find(l => l && l.id === oldCardId);
          if (oldCard) {
            oldCard.remainingBalance = fromCents(Math.max(0, toCents(oldCard.remainingBalance || 0) - toCents(oldTx.amount || 0)));
            oldCard._updatedAt = nowTs;
            data.settings.stateUpdatedAt = nowTs;
          }
        }
        if (newCardId) {
          const newCard = (data.liabilities || []).find(l => l && l.id === newCardId);
          if (newCard) {
            newCard.remainingBalance = fromCents(toCents(newCard.remainingBalance || 0) + toCents(newAmt));
            newCard._updatedAt = nowTs;
            data.settings.stateUpdatedAt = nowTs;
          }
        }
      }

      data.transactions[idx] = {
        ...oldTx,
        type,
        amount: newAmt,
        date,
        category,
        source: validCard ? validCard.name : source,
        description,
        unexpected,
        isShared,
        paidBy,
        paidByCreditCardId,
        dcaAddedUnits: nextDcaAddedUnits,
        linkedLiabilityId: nextLinkedLiabilityId,
        liabilityPrincipal: nextLiabilityPrincipal,
        liabilityInterest: nextLiabilityInterest,
        _updatedAt: nowTs
      };
      markTxDirty(editId);
    }
    showToast("✅ Η συναλλαγή ενημερώθηκε!");
  } else {
    const newId = generateId("tx");
    if (validCard) {
      validCard.remainingBalance = fromCents(toCents(validCard.remainingBalance || 0) + toCents(newAmt));
      validCard._updatedAt = nowTs;
      data.settings.stateUpdatedAt = nowTs;
    }
    data.transactions.push({
      id: newId,
      owner: "me",
      type,
      amount: newAmt,
      date,
      category,
      source: validCard ? validCard.name : source,
      description,
      unexpected,
      isShared,
      paidBy,
      paidByCreditCardId,
      settled: false,
      _updatedAt: nowTs
    });
    markTxDirty(newId);
    showToast(validCard ? `✅ Καταχωρίστηκε αγορά με ${validCard.name}!` : "✅ Η συναλλαγή καταχωρίστηκε!");
  }

  if (description && description !== category && description.length >= 3 && category !== "Άλλο" && category !== "Άλλο Έσοδο") {
    const normKey = extractMerchantKey(description);
    if (normKey && normKey.length >= 3) {
      data.merchantRules[normKey] = { category, isShared };
      data.settings.stateUpdatedAt = Date.now();
    }
  }

  persist();
  render();

  if (keepOpen) {
    document.getElementById("editingTransactionId").value = "";
    document.getElementById("amount").value = "";
    document.getElementById("description").value = "";
    document.getElementById("amount").focus();
  } else {
    closeTransactionModal();
  }
}

function reverseLinkedEntityEffectsForTx(tx, nowTs = Date.now()) {
  if (!tx || typeof tx !== "object") return false;
  let entityStateChanged = false;

  if (tx.recurringId && tx.date && tx.date.length >= 7) {
    const rec = (data.recurring || []).find(r => r && r.id === tx.recurringId);
    if (rec) {
      if (!rec.skippedMonths || typeof rec.skippedMonths !== "object") rec.skippedMonths = {};
      rec.skippedMonths[tx.date.slice(0, 7)] = true;
      entityStateChanged = true;
    }
  }

  const reverseDelta = tx.type === "saving" ? -(Number(tx.amount) || 0) : (tx.type === "withdrawal" ? (Number(tx.amount) || 0) : 0);

  if (tx.linkedGoalId && reverseDelta !== 0) {
    const g = (data.goals || []).find(item => item && item.id === tx.linkedGoalId);
    if (g) {
      g.saved = Math.max(0, fromCents(toCents(g.saved || 0) + toCents(reverseDelta)));
      entityStateChanged = true;
    }
  }

  if (tx.linkedAnnualBillId && reverseDelta !== 0) {
    const b = (data.annualBills || []).find(item => item && item.id === tx.linkedAnnualBillId);
    if (b) {
      b.saved = Math.max(0, fromCents(toCents(b.saved || 0) + toCents(reverseDelta)));
      entityStateChanged = true;
    }
  }

  if (tx.linkedPortfolioAssetId && reverseDelta !== 0) {
    const asset = (data.portfolioAssets || []).find(a => a && a.id === tx.linkedPortfolioAssetId);
    if (asset) {
      asset.invested = Math.max(0, fromCents(toCents(asset.invested || 0) + toCents(reverseDelta)));
      const prevUnits = Math.max(0, Number(asset.units) || 0);
      const removedUnits = Number(tx.dcaAddedUnits) > 0
        ? Number(tx.dcaAddedUnits)
        : (Number(tx.dcaUnitPriceEur) > 0 ? Math.abs(reverseDelta) / Number(tx.dcaUnitPriceEur) : 0);
      if (prevUnits > 0 && removedUnits > 0) {
        const nextUnits = Math.max(0, Number((prevUnits - (tx.type === "saving" ? removedUnits : -removedUnits)).toFixed(8)));
        const valuationPx = Number(asset.lastUnitPriceEur) > 0
          ? Number(asset.lastUnitPriceEur)
          : (Number(tx.dcaUnitPriceEur) > 0 ? Number(tx.dcaUnitPriceEur) : (prevUnits > 0 ? (Number(asset.current) || 0) / prevUnits : 0));
        asset.units = nextUnits;
        asset.current = nextUnits > 0 && valuationPx > 0 ? roundMoney(nextUnits * valuationPx) : 0;
      } else {
        asset.current = Math.max(0, fromCents(toCents(asset.current || 0) + toCents(reverseDelta)));
      }
      asset._updatedAt = nowTs;
      entityStateChanged = true;
    }
  }

  if (tx.linkedLiabilityId && Number(tx.liabilityPrincipal) > 0) {
    const l = (data.liabilities || []).find(item => item && item.id === tx.linkedLiabilityId);
    if (l) {
      l.remainingBalance = fromCents(toCents(l.remainingBalance || 0) + toCents(tx.liabilityPrincipal));
      if (l.type === "Credit Card" && Number(tx.liabilityInstallmentPrincipal) > 0) {
        l.installmentBalance = Math.min(
          l.remainingBalance,
          fromCents(toCents(l.installmentBalance || 0) + toCents(tx.liabilityInstallmentPrincipal))
        );
        if (l.installmentRemainingCount !== undefined) {
          l.installmentRemainingCount = Math.round(Number(l.installmentRemainingCount) || 0) + 1;
        }
      }
      l._updatedAt = nowTs;
      entityStateChanged = true;
    }
  }

  if (tx.paidByCreditCardId && Number(tx.amount) > 0) {
    const card = (data.liabilities || []).find(item => item && item.id === tx.paidByCreditCardId);
    if (card) {
      if (tx.type === "expense") {
        card.remainingBalance = fromCents(Math.max(0, toCents(card.remainingBalance || 0) - toCents(tx.amount)));
      } else if (tx.type === "income") {
        card.remainingBalance = fromCents(toCents(card.remainingBalance || 0) + toCents(tx.amount));
      }
      card._updatedAt = nowTs;
      entityStateChanged = true;
    }
  }

  return entityStateChanged;
}

function deleteTransaction(txId) {
  const tx = data.transactions.find(t => t.id === txId);
  if (!tx) return;
  showModal(`Διαγραφή συναλλαγής «${tx.description}» (${money(tx.amount)});`, true, (ok) => {
    if (!ok) return;
    const nowTs = Date.now();
    if (reverseLinkedEntityEffectsForTx(tx, nowTs)) {
      data.settings.stateUpdatedAt = nowTs;
    }
    data.transactions = data.transactions.filter(t => t.id !== txId);
    data.deletedTxIds[txId] = nowTs;
    markTxDirty(txId);
    persist();
    render();
    showToast("🗑️ Η συναλλαγή διαγράφηκε.");
  }, "Διαγραφή Συναλλαγής");
}

function toggleTransactionShared(txId) {
  const split = getCoupleSplit();
  if (!split.hasPartner) return;
  const tx = data.transactions.find(t => t.id === txId);
  if (!tx || tx.type !== "expense") return;

  tx.isShared = !tx.isShared;
  tx.paidBy = tx.isShared ? (tx.owner === "partner" ? "partner" : "me") : undefined;
  tx.settled = false;
  tx._lastModifiedByDevice = data.settings.deviceId;
  tx._updatedAt = Date.now();
  markTxDirty(txId);

  const mKey = extractMerchantKey(tx.originalBankDesc || tx.description || "");
  if (mKey && mKey.length >= 3 && tx.category && tx.category !== "Άλλο") {
    data.merchantRules[mKey] = { category: tx.category, isShared: tx.isShared };
    data.settings.stateUpdatedAt = Date.now();
  }

  persist();
  render();
  showToast(tx.isShared ? "👫 Ορίστηκε ως Κοινό Έξοδο (απομνημονεύτηκε)" : "👤 Μετατράπηκε σε Προσωπικό Έξοδο (απομνημονεύτηκε)");
}

function toggleTransactionSettled(txId) {
  const tx = data.transactions.find(t => t.id === txId);
  if (!tx || !tx.isShared) return;
  tx.settled = !tx.settled;
  tx._updatedAt = Date.now();
  if (tx.owner === "partner") {
    tx._settlementPatch = true;
  }
  markTxDirty(txId);
  persist();
  render();
  showToast(tx.settled ? "✓ Σημειώθηκε ως εξοφλημένο" : "Επανήλθε σε εκκρεμότητα");
}

function settleAllSharedExpenses() {
  const split = getCoupleSplit();
  if (!split.hasPartner) return;
  const ctx = getActivePeriodContext();
  const unsettled = filterTransactionsForRange(ctx.start, ctx.end, true)
    .filter(t => t.type === "expense" && t.isShared && !t.settled && t.paidBy !== "split");
  if (unsettled.length === 0) {
    showToast("Όλα τα κοινά έξοδα της περιόδου είναι ήδη εξοφλημένα!");
    return;
  }
  showModal(`Να σημανθούν οι ${unsettled.length} εκκρεμείς κοινές κινήσεις της περιόδου (${ctx.label}) ως εξοφλημένες;`, true, (ok) => {
    if (!ok) return;
    const nowTs = Date.now();
    unsettled.forEach(t => {
      t.settled = true;
      t._updatedAt = nowTs;
      if (t.owner === "partner") t._settlementPatch = true;
      markTxDirty(t.id);
    });
    persist();
    render();
    showToast("✅ Τα κοινά έξοδα της περιόδου εξοφλήθηκαν!");
  }, "Εκκαθάριση Κοινών Περιόδου");
}

function getFilteredTransactionsList() {
  const searchNorm = normalizeText(document.getElementById("filterSearch")?.value || "");
  const scope = document.getElementById("filterScope")?.value || "selectedPeriod";
  const sourceFilter = document.getElementById("filterSource")?.value || "all";
  const typeFilter = document.getElementById("filterType")?.value || "all";
  const catFilter = document.getElementById("filterCategory")?.value || "all";
  const sharedFilter = document.getElementById("filterShared")?.value || "all";
  const sortMode = document.getElementById("filterSort")?.value || "date_desc";
  const onlyUnexpected = Boolean(document.getElementById("filterOnlyUnexpected")?.checked);

  const ctx = getActivePeriodContext();
  const split = getCoupleSplit();
  const memberView = data.settings?.memberView || "all";

  let baseList = scope === "selectedPeriod"
    ? filterTransactionsForRange(ctx.start, ctx.end, false)
    : [...(data.transactions || [])];

  baseList = filterTransactionsByMemberView(baseList, memberView, split);

  const filtered = baseList.filter(t => {
    if (sourceFilter !== "all") {
      const src = t.source || "";
      if (sourceFilter === "manual" && src !== "") return false;
      if (sourceFilter !== "manual" && src !== sourceFilter) return false;
    }
    if (typeFilter !== "all" && t.type !== typeFilter) return false;
    if (catFilter !== "all" && t.category !== catFilter) return false;
    if (split.hasPartner && sharedFilter !== "all") {
      if (sharedFilter === "shared" && !t.isShared) return false;
      if (sharedFilter === "personal" && t.isShared) return false;
      if (sharedFilter === "unsettled" && (!t.isShared || t.settled || t.paidBy === "split")) return false;
    }
    if (onlyUnexpected && !t.unexpected) return false;
    if (searchNorm) {
      const hay = normalizeText(`${t.description || ""} ${t.category || ""} ${t.source || ""}`);
      if (!hay.includes(searchNorm)) return false;
    }
    return true;
  }).sort((a, b) => {
    if (sortMode === "date_asc") return (a.date || "").localeCompare(b.date || "");
    if (sortMode === "amount_desc") return (Number(b.amount) || 0) - (Number(a.amount) || 0);
    if (sortMode === "amount_asc") return (Number(a.amount) || 0) - (Number(b.amount) || 0);
    return (b.date || "").localeCompare(a.date || "");
  });

  return { baseList, filtered, split, memberView };
}

function updateTxBulkBarUI(visibleList) {
  const bar = document.getElementById("txBulkActionsBar");
  const countEl = document.getElementById("txBulkSelectedCount");
  const sharedBtns = document.getElementById("txBulkSharedBtns");
  const selectAllCb = document.getElementById("txSelectAll");
  const split = getCoupleSplit();

  // Remove stale IDs no longer in data.transactions
  const existingIds = new Set((data.transactions || []).map(t => t.id));
  for (const id of Array.from(selectedTxIds)) {
    if (!existingIds.has(id)) selectedTxIds.delete(id);
  }

  if (selectAllCb) {
    selectAllCb.checked = visibleList.length > 0 && visibleList.every(t => selectedTxIds.has(t.id));
  }

  if (!bar) return;
  const cnt = selectedTxIds.size;
  bar.style.display = cnt > 0 ? "flex" : "none";
  if (countEl) countEl.textContent = `${cnt} επιλεγμένες`;
  if (sharedBtns) sharedBtns.style.display = split.hasPartner ? "inline-flex" : "none";

  const bulkCatSel = document.getElementById("txBulkCategorySelect");
  if (bulkCatSel && bulkCatSel.options.length === 0) {
    bulkCatSel.innerHTML = ALL_CATEGORIES.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  }
}

function toggleTxSelection(txId, checked) {
  if (checked) selectedTxIds.add(txId);
  else selectedTxIds.delete(txId);
  const { filtered } = getFilteredTransactionsList();
  updateTxBulkBarUI(filtered.slice(0, txDisplayLimit));
}

function toggleAllVisibleTxSelection(checked) {
  const { filtered } = getFilteredTransactionsList();
  const visible = filtered.slice(0, txDisplayLimit);
  visible.forEach(t => {
    if (checked) selectedTxIds.add(t.id);
    else selectedTxIds.delete(t.id);
  });
  renderTransactionsTable();
}

function clearTxSelection() {
  selectedTxIds.clear();
  renderTransactionsTable();
}

function applyBulkTxShared(makeShared) {
  const split = getCoupleSplit();
  if (!split.hasPartner || selectedTxIds.size === 0) return;
  const nowTs = Date.now();
  let changed = 0;

  (data.transactions || []).forEach(tx => {
    if (!selectedTxIds.has(tx.id) || tx.type !== "expense") return;
    tx.isShared = Boolean(makeShared);
    tx.paidBy = tx.isShared ? (tx.owner === "partner" ? "partner" : "me") : undefined;
    tx.settled = false;
    tx._lastModifiedByDevice = data.settings.deviceId;
    tx._updatedAt = nowTs;
    markTxDirty(tx.id);
    const mKey = extractMerchantKey(tx.originalBankDesc || tx.description || "");
    if (mKey && mKey.length >= 3 && tx.category && tx.category !== "Άλλο") {
      data.merchantRules[mKey] = { category: tx.category, isShared: tx.isShared };
    }
    changed++;
  });

  if (changed > 0) {
    data.settings.stateUpdatedAt = nowTs;
    selectedTxIds.clear();
    persist();
    render();
    showToast(makeShared
      ? `👫 Ορίστηκαν ${changed} έξοδα ως Κοινά!`
      : `👤 Ορίστηκαν ${changed} έξοδα ως Προσωπικά!`);
  }
}

function applyBulkTxCategory() {
  const newCat = document.getElementById("txBulkCategorySelect")?.value;
  if (!newCat || selectedTxIds.size === 0) return;
  const nowTs = Date.now();
  let changed = 0;

  (data.transactions || []).forEach(tx => {
    if (!selectedTxIds.has(tx.id)) return;
    tx.category = newCat;
    if (SAVING_CATEGORIES.includes(newCat)) tx.type = "saving";
    else if (INCOME_CATEGORIES.includes(newCat)) tx.type = "income";
    else tx.type = "expense";
    tx._updatedAt = nowTs;
    markTxDirty(tx.id);
    const mKey = extractMerchantKey(tx.originalBankDesc || tx.description || "");
    if (mKey && mKey.length >= 3 && newCat !== "Άλλο" && newCat !== "Άλλο Έσοδο") {
      data.merchantRules[mKey] = { category: newCat, isShared: Boolean(tx.isShared) };
    }
    changed++;
  });

  if (changed > 0) {
    data.settings.stateUpdatedAt = nowTs;
    selectedTxIds.clear();
    persist();
    render();
    showToast(`✅ Ενημερώθηκε η κατηγορία «${newCat}» σε ${changed} συναλλαγές.`);
  }
}

function deleteBulkSelectedTx() {
  if (selectedTxIds.size === 0) return;
  const count = selectedTxIds.size;
  showModal(`Μαζική διαγραφή ${count} επιλεγμένων συναλλαγών;`, true, (ok) => {
    if (!ok) return;
    const nowTs = Date.now();
    const toRemove = new Set(selectedTxIds);
    let anyEntityChanged = false;
    (data.transactions || []).forEach(t => {
      if (t && toRemove.has(t.id) && reverseLinkedEntityEffectsForTx(t, nowTs)) {
        anyEntityChanged = true;
      }
    });
    if (anyEntityChanged) {
      data.settings.stateUpdatedAt = nowTs;
    }
    data.transactions = (data.transactions || []).filter(t => !toRemove.has(t.id));
    toRemove.forEach(id => {
      data.deletedTxIds[id] = nowTs;
      markTxDirty(id);
    });
    selectedTxIds.clear();
    persist();
    render();
    showToast(`🗑️ Διαγράφηκαν ${count} συναλλαγές.`);
  }, "Μαζική Διαγραφή");
}

function loadMoreTransactions() {
  txDisplayLimit += 100;
  renderTransactionsTable();
}

function renderTransactionsTable() {
  const tbody = document.getElementById("transactionsTableBody");
  if (!tbody) return;

  const { baseList, filtered, split, memberView } = getFilteredTransactionsList();

  const sharedFilterSel = document.getElementById("filterShared");
  if (sharedFilterSel) {
    sharedFilterSel.style.display = split.hasPartner ? "" : "none";
    if (!split.hasPartner) sharedFilterSel.value = "all";
  }

  const chipsContainer = document.getElementById("sourcesBreakdownChips");
  if (chipsContainer) {
    const bySource = {};
    baseList.filter(t => t.type === "expense" && !t.isInternalTransfer).forEach(t => {
      const src = t.source || "Μετρητά";
      bySource[src] = (bySource[src] || 0) + getEffectiveTxAmountForMemberView(t, memberView, split);
    });
    chipsContainer.innerHTML = Object.entries(bySource)
      .map(([src, sum]) => `<span class="badge">${escapeHtml(src)}: ${money(sum)}</span>`)
      .join("");
  }

  const visible = filtered.slice(0, txDisplayLimit);
  setTextSafe(
    "filteredSummaryText",
    filtered.length > visible.length
      ? `Εμφανίζονται ${visible.length} από ${filtered.length} συναλλαγές`
      : `${filtered.length} συναλλαγές`
  );

  updateTxBulkBarUI(visible);

  const loadMoreWrap = document.getElementById("txLoadMoreWrap");
  if (loadMoreWrap) {
    loadMoreWrap.style.display = filtered.length > visible.length ? "flex" : "none";
  }

  if (visible.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="small" style="text-align:center; padding:20px;">Δεν βρέθηκαν συναλλαγές με αυτά τα κριτήρια.</td></tr>`;
    return;
  }

  const typeBadgeMap = {
    income: `<span class="badge income">🟢 Έσοδο</span>`,
    expense: `<span class="badge expense">🔴 Έξοδο</span>`,
    saving: `<span class="badge saving">🔵 Αποταμ.</span>`,
    withdrawal: `<span class="badge withdrawal">🟠 Ανάληψη</span>`
  };

  tbody.innerHTML = visible.map(t => {
    const effAmt = getEffectiveTxAmountForMemberView(t, memberView, split);
    const sign = t.type === "income" ? "+" : (t.type === "expense" ? "-" : "");
    const amtColor = t.type === "income" ? "var(--accent)" : (t.type === "expense" ? "var(--danger)" : "var(--primary)");
    const ownerBadge = split.hasPartner
      ? `<span class="badge">${t.owner === "partner" ? `👤 ${escapeHtml(split.partnerName)}` : `👤 ${escapeHtml(split.myName)}`}</span>`
      : "";
    const sharedBadge = t.isShared
      ? `<span class="badge shared">👫 Κοινό${t.settled ? " ✓" : ""}</span>`
      : "";
    const srcBadge = t.source ? `<span class="badge">${escapeHtml(t.source)}</span>` : "";
    const isChecked = selectedTxIds.has(t.id);

    return `
      <tr>
        <td><input type="checkbox" ${isChecked ? "checked" : ""} data-txid="${escapeHtml(t.id)}" data-change="toggleTxSelection" aria-label="Επιλογή συναλλαγής" /></td>
        <td>${escapeHtml(t.date)}</td>
        <td>${typeBadgeMap[t.type] || ""} ${ownerBadge} ${sharedBadge} ${srcBadge}</td>
        <td><strong>${escapeHtml(t.category)}</strong></td>
        <td class="col-desc">${escapeHtml(t.description || "")}${t.unexpected ? ' <span class="badge withdrawal">⚡ Έκτακτο</span>' : ""}</td>
        <td class="amount-cell" style="text-align:right; font-weight:700; color:${amtColor};">${sign}${money(effAmt)}</td>
        <td class="col-actions" style="text-align:right; white-space:nowrap;">
          ${split.hasPartner && t.type === "expense" ? `<button type="button" class="secondary small-btn" data-txid="${escapeHtml(t.id)}" data-click="toggleTransactionShared" aria-label="Εναλλαγή κοινού εξόδου" title="Κοινό / Προσωπικό">👫</button>` : ""}
          ${t.isShared ? `<button type="button" class="secondary small-btn" data-txid="${escapeHtml(t.id)}" data-click="toggleTransactionSettled" aria-label="Εξόφληση" title="Εξόφληση">${t.settled ? "↩️" : "✓"}</button>` : ""}
          <button type="button" class="secondary small-btn" data-txid="${escapeHtml(t.id)}" data-click="openTransactionModal" aria-label="Επεξεργασία συναλλαγής" title="Επεξεργασία">✏️</button>
          <button type="button" class="danger small-btn" data-txid="${escapeHtml(t.id)}" data-click="deleteTransaction" aria-label="Διαγραφή συναλλαγής" title="Διαγραφή">🗑️</button>
        </td>
      </tr>
    `;
  }).join("");
}

function drillDownToTransactions(opts = {}) {
  txDisplayLimit = 100;
  selectedTxIds.clear();
  switchTab("transactions");
  document.getElementById("filterScope").value = opts.scope || "selectedPeriod";
  document.getElementById("filterSource").value = opts.source || "all";
  document.getElementById("filterType").value = opts.type || "all";
  document.getElementById("filterCategory").value = opts.category || "all";
  const sharedSel = document.getElementById("filterShared");
  if (sharedSel) sharedSel.value = opts.shared || "all";
  document.getElementById("filterSearch").value = opts.search || "";
  document.getElementById("filterOnlyUnexpected").checked = Boolean(opts.onlyUnexpected);
  renderTransactionsTable();
}

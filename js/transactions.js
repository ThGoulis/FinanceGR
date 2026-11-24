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

function selectTransactionType(typeVal) {
  const hidden = document.getElementById("txType");
  if (hidden) hidden.value = typeVal;
  ["expense", "income", "saving", "withdrawal"].forEach(t => {
    document.getElementById(`typeBtn_${t}`)?.classList.toggle("active", t === typeVal);
  });
  syncCategoryDropdown(typeVal);
  const unexpWrap = document.getElementById("unexpectedWrap");
  if (unexpWrap) unexpWrap.style.display = typeVal === "expense" ? "flex" : "none";
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

  if (!amount || amount <= 0) {
    showModal("Πληκτρολόγησε ένα έγκυρο ποσό μεγαλύτερο από €0.");
    return;
  }
  if (!date) {
    showModal("Επίλεξε ημερομηνία συναλλαγής.");
    return;
  }
  if (!parseFlexibleDate(date) || amount > 1e9) {
    showModal("Έλεγξε την ημερομηνία και το ποσό (μέγιστο €1.000.000.000).");
    return;
  }

  const split = getCoupleSplit();
  const isShared = split.hasPartner && type === "expense" && Boolean(document.getElementById("txIsShared").checked);
  const paidBy = isShared ? (document.getElementById("txPaidBy").value || "me") : undefined;

  if (editId) {
    const idx = data.transactions.findIndex(t => t.id === editId);
    if (idx !== -1) {
      const oldTx = data.transactions[idx];
      const newAmt = Number(amount.toFixed(2));
      const oldEffect = oldTx.type === "saving" ? (Number(oldTx.amount) || 0) : (oldTx.type === "withdrawal" ? -(Number(oldTx.amount) || 0) : 0);
      const newEffect = type === "saving" ? newAmt : (type === "withdrawal" ? -newAmt : 0);
      const effectDelta = Number((newEffect - oldEffect).toFixed(2));
      if (effectDelta !== 0) {
        if (oldTx.linkedGoalId) {
          const g = (data.goals || []).find(item => item.id === oldTx.linkedGoalId);
          if (g) {
            g.saved = Math.max(0, Number(((Number(g.saved) || 0) + effectDelta).toFixed(2)));
            data.settings.stateUpdatedAt = Date.now();
          }
        }
        if (oldTx.linkedAnnualBillId) {
          const b = (data.annualBills || []).find(item => item.id === oldTx.linkedAnnualBillId);
          if (b) {
            b.saved = Math.max(0, Number(((Number(b.saved) || 0) + effectDelta).toFixed(2)));
            data.settings.stateUpdatedAt = Date.now();
          }
        }
      }
      data.transactions[idx] = {
        ...oldTx,
        type,
        amount: newAmt,
        date,
        category,
        source,
        description,
        unexpected,
        isShared,
        paidBy,
        _updatedAt: Date.now()
      };
      markTxDirty(editId);
    }
    showToast("✅ Η συναλλαγή ενημερώθηκε!");
  } else {
    const newId = generateId("tx");
    data.transactions.push({
      id: newId,
      owner: "me",
      type,
      amount: Number(amount.toFixed(2)),
      date,
      category,
      source,
      description,
      unexpected,
      isShared,
      paidBy,
      settled: false,
      _updatedAt: Date.now()
    });
    markTxDirty(newId);
    showToast("✅ Η συναλλαγή καταχωρίστηκε!");
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

function deleteTransaction(txId) {
  const tx = data.transactions.find(t => t.id === txId);
  if (!tx) return;
  showModal(`Διαγραφή συναλλαγής «${tx.description}» (${money(tx.amount)});`, true, (ok) => {
    if (!ok) return;
    let entityStateChanged = false;
    if (tx.recurringId && tx.date && tx.date.length >= 7) {
      const rec = (data.recurring || []).find(r => r.id === tx.recurringId);
      if (rec) {
        if (!rec.skippedMonths || typeof rec.skippedMonths !== "object") rec.skippedMonths = {};
        rec.skippedMonths[tx.date.slice(0, 7)] = true;
        entityStateChanged = true;
      }
    }
    const reverseDelta = tx.type === "saving" ? -(Number(tx.amount) || 0) : (tx.type === "withdrawal" ? (Number(tx.amount) || 0) : 0);
    if (tx.linkedGoalId && reverseDelta !== 0) {
      const g = (data.goals || []).find(item => item.id === tx.linkedGoalId);
      if (g) {
        g.saved = Math.max(0, Number(((Number(g.saved) || 0) + reverseDelta).toFixed(2)));
        entityStateChanged = true;
      }
    }
    if (tx.linkedAnnualBillId && reverseDelta !== 0) {
      const b = (data.annualBills || []).find(item => item.id === tx.linkedAnnualBillId);
      if (b) {
        b.saved = Math.max(0, Number(((Number(b.saved) || 0) + reverseDelta).toFixed(2)));
        entityStateChanged = true;
      }
    }
    if (entityStateChanged) {
      data.settings.stateUpdatedAt = Date.now();
    }
    data.transactions = data.transactions.filter(t => t.id !== txId);
    data.deletedTxIds[txId] = Date.now();
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
        <td><input type="checkbox" ${isChecked ? "checked" : ""} data-txid="${escapeHtml(t.id)}" onchange="toggleTxSelection(this.dataset.txid, this.checked)" aria-label="Επιλογή συναλλαγής" /></td>
        <td>${escapeHtml(t.date)}</td>
        <td>${typeBadgeMap[t.type] || ""} ${ownerBadge} ${sharedBadge} ${srcBadge}</td>
        <td><strong>${escapeHtml(t.category)}</strong></td>
        <td class="col-desc">${escapeHtml(t.description || "")}${t.unexpected ? ' <span class="badge withdrawal">⚡ Έκτακτο</span>' : ""}</td>
        <td class="amount-cell" style="text-align:right; font-weight:700; color:${amtColor};">${sign}${money(effAmt)}</td>
        <td class="col-actions" style="text-align:right; white-space:nowrap;">
          ${split.hasPartner && t.type === "expense" ? `<button type="button" class="secondary small-btn" data-txid="${escapeHtml(t.id)}" onclick="toggleTransactionShared(this.dataset.txid)" aria-label="Εναλλαγή κοινού εξόδου" title="Κοινό / Προσωπικό">👫</button>` : ""}
          ${t.isShared ? `<button type="button" class="secondary small-btn" data-txid="${escapeHtml(t.id)}" onclick="toggleTransactionSettled(this.dataset.txid)" aria-label="Εξόφληση" title="Εξόφληση">${t.settled ? "↩️" : "✓"}</button>` : ""}
          <button type="button" class="secondary small-btn" data-txid="${escapeHtml(t.id)}" onclick="openTransactionModal(this.dataset.txid)" aria-label="Επεξεργασία συναλλαγής" title="Επεξεργασία">✏️</button>
          <button type="button" class="danger small-btn" data-txid="${escapeHtml(t.id)}" onclick="deleteTransaction(this.dataset.txid)" aria-label="Διαγραφή συναλλαγής" title="Διαγραφή">🗑️</button>
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

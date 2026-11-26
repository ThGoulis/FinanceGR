/* ==========================================================================
   CENTRALIZED EVENT DELEGATION (STRICT CSP — ZERO INLINE HANDLERS)
   ========================================================================== */
let _financeGrEventsBound = false;

function initFinanceGrEventDelegation() {
  if (_financeGrEventsBound) return;
  _financeGrEventsBound = true;

  const parseBoolArg = (el) => el?.dataset?.arg === "true";

  const BACKDROP_CLOSE_HANDLERS = {
    closeCloudSyncModal: () => closeCloudSyncModal(),
    closeCoupleMergeModal: () => closeCoupleMergeModal(),
    closeLiabilityPaymentModal: () => closeLiabilityPaymentModal(),
    closeMobileMoreDrawer: () => closeMobileMoreDrawer(),
    closePaydayModal: () => closePaydayModal(),
    closePrivacySecurityModal: () => closePrivacySecurityModal(),
    closeShareModal: () => closeShareModal(),
    closeTransactionModal: () => closeTransactionModal()
  };

  const MOBILE_DRAWER_OPENERS = {
    exportJSON: () => exportJSON(),
    openBankImportModal: () => openBankImportModal(),
    openCloudSyncModal: () => openCloudSyncModal(),
    openCoupleMergeModal: () => openCoupleMergeModal(),
    openPrivacySecurityModal: () => openPrivacySecurityModal(),
    openShareModal: () => openShareModal()
  };

  const CLICK_HANDLERS = {
    addDcaToPortfolioAsset: (el) => addDcaToPortfolioAsset(el.dataset.aid, Number(el.dataset.arg)),
    addTransaction: (el) => addTransaction(parseBoolArg(el)),
    applyAutoBudgetAllocation: () => applyAutoBudgetAllocation(),
    applyBulkBankCategory: () => applyBulkBankCategory(),
    applyBulkBankShared: (el) => applyBulkBankShared(parseBoolArg(el)),
    applyBulkTxCategory: () => applyBulkTxCategory(),
    applyBulkTxShared: (el) => applyBulkTxShared(parseBoolArg(el)),
    applyDetectedAccountHolder: (el) => applyDetectedAccountHolder(el.dataset.holder),
    applyManualColumnMapping: () => applyManualColumnMapping(),
    applySimRatePreset: (el) => applySimRatePreset(Number(el.dataset.arg)),
    applyTestedTickerToForm: () => applyTestedTickerToForm(),
    applyWelcomePersona: (el) => applyWelcomePersona(Number(el.dataset.income), Number(el.dataset.payday), Number(el.dataset.goal)),
    cancelAnnualBillEditor: () => cancelAnnualBillEditor(),
    cancelCreditCardEditor: () => cancelCreditCardEditor(),
    cancelLoanEditor: () => cancelLoanEditor(),
    cancelPortfolioAssetEditor: () => cancelPortfolioAssetEditor(),
    cancelRecurringEditor: () => cancelRecurringEditor(),
    clearBankPreviewSearch: () => clearBankPreviewSearch(),
    clearDemoDataAndStartFresh: (el) => clearDemoDataAndStartFresh(parseBoolArg(el)),
    clearTxSelection: () => clearTxSelection(),
    closeAutoBudgetPreview: () => closeAutoBudgetPreview(),
    closeBankImportModal: () => closeBankImportModal(),
    closeCloudSyncModal: () => closeCloudSyncModal(),
    closeCoupleMergeModal: () => closeCoupleMergeModal(),
    closeLiabilityPaymentModal: () => closeLiabilityPaymentModal(),
    closeMobileMoreDrawer: () => closeMobileMoreDrawer(),
    closePaydayModal: () => closePaydayModal(),
    closePrivacySecurityModal: () => closePrivacySecurityModal(),
    closeShareModal: () => closeShareModal(),
    closeTransactionModal: () => closeTransactionModal(),
    completeWelcomeSetup: () => completeWelcomeSetup(),
    confirmBankImport: () => confirmBankImport(),
    confirmDeleteMyAccountGDPR: () => confirmDeleteMyAccountGDPR(),
    confirmResetAllData: () => confirmResetAllData(),
    connectCloudSyncRoom: () => connectCloudSyncRoom(),
    contributeGoal: (el) => contributeGoal(el.dataset.gid, Number(el.dataset.arg)),
    contributeGoalCustom: (el) => contributeGoalCustom(el.dataset.gid),
    copyShareUrl: () => copyShareUrl(),
    deleteAnnualBill: (el) => deleteAnnualBill(el.dataset.bid),
    deleteBulkSelectedTx: () => deleteBulkSelectedTx(),
    deleteGoal: (el) => deleteGoal(el.dataset.gid),
    deleteLiabilityItem: (el) => deleteLiabilityItem(el.dataset.lid),
    deleteMerchantRule: (el) => deleteMerchantRule(el.dataset.rulekey),
    deletePortfolioAsset: (el) => deletePortfolioAsset(el.dataset.aid),
    deleteRecurringItem: (el) => deleteRecurringItem(el.dataset.recid),
    deleteTransaction: (el) => deleteTransaction(el.dataset.txid),
    disconnectCloudSyncRoom: () => disconnectCloudSyncRoom(),
    dismissFirstUseGuide: () => dismissFirstUseGuide(),
    downloadQrCodePng: () => downloadQrCodePng(),
    drillDownCategory: (el) => drillDownToTransactions({ category: el.dataset.cat, type: "expense" }),
    drillDownMerchant: (el) => drillDownToTransactions({ search: el.dataset.merchant, type: "expense" }),
    editAnnualBill: (el) => editAnnualBill(el.dataset.bid),
    editCreditCardItem: (el) => editCreditCardItem(el.dataset.lid),
    editLoanLiabilityItem: (el) => editLoanLiabilityItem(el.dataset.lid),
    editPortfolioAsset: (el) => editPortfolioAsset(el.dataset.aid),
    editRecurringItem: (el) => editRecurringItem(el.dataset.recid),
    executeLiabilityPayment: () => executeLiabilityPayment(),
    executePaydayAllocation: () => executePaydayAllocation(),
    exportCSV: () => exportCSV(),
    exportJSON: () => exportJSON(),
    exportPartnerMergeFile: (el) => exportPartnerMergeFile(parseBoolArg(el)),
    filterBankRowsByStatus: (el) => filterBankRowsByStatus(el.dataset.arg),
    filterSimilarBankRows: (el) => filterSimilarBankRows(el.dataset.rowid),
    generateNewSyncRoomCode: () => generateNewSyncRoomCode(),
    ignoreDetectedSubscription: (el) => ignoreDetectedSubscription(el.dataset.subkey),
    importCSV: () => importCSV(),
    importJSON: () => importJSON(),
    importPartnerMergeFile: () => importPartnerMergeFile(),
    inviteRoomMemberViaFunction: () => inviteRoomMemberViaFunction(),
    loadDemoData: () => loadDemoData(),
    loadDemoShowcaseData: () => loadDemoShowcaseData(),
    loadMoreTransactions: () => loadMoreTransactions(),
    manualSyncNow: () => manualSyncNow(),
    markBankRowAsSalary: (el) => markBankRowAsSalary(el.dataset.rowid),
    mobileDrawerAndOpen: (el) => {
      closeMobileMoreDrawer();
      const fn = MOBILE_DRAWER_OPENERS[el.dataset.arg];
      if (fn) fn();
    },
    mobileDrawerNavigateTab: (el) => mobileDrawerNavigateTab(el.dataset.arg),
    openBankImportModal: () => openBankImportModal(),
    openCloudSyncModal: () => openCloudSyncModal(),
    openCoupleMergeModal: () => openCoupleMergeModal(),
    openLiabilityPaymentModal: (el) => openLiabilityPaymentModal(el.dataset.lid),
    openPaydayModal: () => openPaydayModal(),
    openPrivacySecurityModal: () => openPrivacySecurityModal(),
    openShareModal: () => openShareModal(),
    openTransactionModal: (el) => openTransactionModal(el.dataset.txid || null),
    payAnnualBill: (el) => payAnnualBill(el.dataset.bid),
    previewAutoBudgetAllocation: () => previewAutoBudgetAllocation(),
    promoteSubToRecurring: (el) => promoteSubToRecurring(el.dataset.subtitle, el.dataset.subcat, Number(el.dataset.subamt)),
    quickTestTicker: (el) => quickTestTicker(el.dataset.sym || el.dataset.arg || ""),
    refreshPortfolioMarketPrices: (el) => refreshPortfolioMarketPrices(parseBoolArg(el)),
    removeRoomMemberByUid: (el) => removeRoomMemberByUid(el.dataset.uid, el.dataset.email),
    removeRoomMemberViaFunction: () => removeRoomMemberViaFunction(),
    reopenFirstUseGuide: () => reopenFirstUseGuide(),
    reserveForAnnualBill: (el) => reserveForAnnualBill(el.dataset.bid, Number(el.dataset.arg)),
    runLiveTickerTest: () => runLiveTickerTest(),
    saveProfileSettings: () => saveProfileSettings(),
    selectOnlyVisibleBankRows: () => selectOnlyVisibleBankRows(),
    selectTransactionType: (el) => selectTransactionType(el.dataset.arg),
    setAutoBudgetCategoryPreset: (el) => setAutoBudgetCategoryPreset(el.dataset.arg),
    setPeriodMode: (el) => setPeriodMode(el.dataset.arg),
    setPlanningSubfilter: (el) => setPlanningSubfilter(el.dataset.arg),
    setPortfolioFilter: (el) => setPortfolioFilter(el.dataset.arg),
    settleAllSharedExpenses: () => settleAllSharedExpenses(),
    shareSocial: (el) => shareSocial(el.dataset.arg),
    signInWithEmailFirebase: (el) => signInWithEmailFirebase(parseBoolArg(el)),
    signInWithGoogleFirebase: () => signInWithGoogleFirebase(),
    signOutFirebase: () => signOutFirebase(),
    skipWelcomeSetup: () => skipWelcomeSetup(),
    startWithBankStatementImport: () => startWithBankStatementImport(),
    switchTab: (el) => switchTab(el.dataset.arg),
    syncSimulatorWithPortfolio: () => syncSimulatorWithPortfolio(),
    toggleDarkMode: () => toggleDarkMode(),
    toggleDetectedSubsCollapse: () => toggleDetectedSubsCollapse(),
    toggleFirstUseCollapse: () => toggleFirstUseCollapse(),
    toggleManualColumnMapper: () => toggleManualColumnMapper(),
    toggleMerchantRuleShared: (el) => toggleMerchantRuleShared(el.dataset.rulekey),
    toggleMobileMoreDrawer: () => toggleMobileMoreDrawer(),
    toggleNwBreakdown: () => toggleNwBreakdown(),
    toggleOverviewMoreInsights: () => toggleOverviewMoreInsights(),
    togglePrivacyMode: () => togglePrivacyMode(),
    toggleSkipRecurringForMonth: (el) => toggleSkipRecurringForMonth(el.dataset.recid),
    toggleSyncPinVisibility: (el) => toggleSyncPinVisibility(el.dataset.arg, el),
    toggleTickerLookupBox: () => toggleTickerLookupBox(),
    toggleTransactionSettled: (el) => toggleTransactionSettled(el.dataset.txid),
    toggleTransactionShared: (el) => toggleTransactionShared(el.dataset.txid),
    unlinkPartnerProfile: () => unlinkPartnerProfile(),
    unlockSessionCloudPin: () => unlockSessionCloudPin()
  };

  const CHANGE_HANDLERS = {
    handleBankFileUpload: (_el, ev) => handleBankFileUpload(ev),
    onBankCreditCardSelectChange: () => onBankCreditCardSelectChange(),
    onBankSourceOverrideChange: () => onBankSourceOverrideChange(),
    onMemberViewChange: () => onMemberViewChange(),
    onPeriodSelectorChange: () => onPeriodSelectorChange(),
    onSyncModeSelectChange: () => onSyncModeSelectChange(),
    onTransactionCategoryChange: () => onTransactionCategoryChange(),
    onTxSharedManualToggle: () => {
      txSharedManuallyTouched = true;
      updateSharedTxPreview();
    },
    previewProfileSplit: () => previewProfileSplit(),
    refreshPendingAutoBudget: () => {
      if (pendingAutoBudgetPlan) previewAutoBudgetAllocation(true);
    },
    renderBankPreviewTable: () => renderBankPreviewTable(),
    renderPortfolio: () => renderPortfolio(),
    renderTransactionsTable: () => renderTransactionsTable(),
    syncRecCategoryOptions: () => syncRecCategoryOptions(),
    toggleAllBankRows: (el) => toggleAllBankRows(Boolean(el.checked)),
    toggleAllVisibleTxSelection: (el) => toggleAllVisibleTxSelection(Boolean(el.checked)),
    toggleAnonymousTelemetry: (el) => toggleAnonymousTelemetry(Boolean(el.checked)),
    toggleAutoBudgetCategory: (el) => toggleAutoBudgetCategory(el.dataset.abcat, Boolean(el.checked)),
    toggleBankRowSelection: (el) => toggleBankRowSelection(el.dataset.rowid, Boolean(el.checked)),
    toggleBankRowShared: (el) => toggleBankRowShared(el.dataset.rowid, Boolean(el.checked)),
    toggleTxSelection: (el) => toggleTxSelection(el.dataset.txid, Boolean(el.checked)),
    updateBankRowCategory: (el) => updateBankRowCategory(el.dataset.rowid, el.value),
    updateBankRowDebtAction: (el) => updateBankRowDebtAction(el.dataset.rowid, el.value),
    updateBankRowDebtInterest: (el) => updateBankRowDebtInterest(el.dataset.rowid, el.value),
    updateBankRowDescription: (el) => updateBankRowDescription(el.dataset.rowid, el.value),
    updateCategoryBudget: (el) => updateCategoryBudget(el.dataset.cat, el.value),
    updatePortfolioAssetValue: (el) => updatePortfolioAssetValue(el.dataset.aid, el.value),
    updateSharedTxPreview: () => updateSharedTxPreview()
  };

  const INPUT_HANDLERS = {
    debouncedRenderBankPreviewTable: () => debouncedRenderBankPreviewTable(),
    debouncedRenderTransactionsTable: () => debouncedRenderTransactionsTable(),
    previewProfileSplit: () => previewProfileSplit(),
    recalcLiabilityPaymentPreview: () => recalcLiabilityPaymentPreview(),
    renderWealthSimulator: () => renderWealthSimulator(),
    updateSharedTxPreview: () => updateSharedTxPreview(),
    updateSyncPinStrengthHint: () => updateSyncPinStrengthHint()
  };

  const SUBMIT_HANDLERS = {
    addGoal: () => addGoal(),
    saveAnnualBill: () => saveAnnualBill(),
    saveCreditCardItem: () => saveCreditCardItem(),
    saveLoanLiabilityItem: () => saveLoanLiabilityItem(),
    savePortfolioAsset: () => savePortfolioAsset(),
    saveRecurringItem: () => saveRecurringItem()
  };

  const KEYDOWN_HANDLERS = {
    testTickerEnter: (_el, ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        runLiveTickerTest();
      }
    }
  };

  const DRAG_HANDLERS = {
    handleBankDragOver: (_el, ev) => handleBankDragOver(ev),
    handleBankDragLeave: (_el, ev) => handleBankDragLeave(ev),
    handleBankDrop: (_el, ev) => handleBankDrop(ev)
  };

  document.addEventListener("click", (event) => {
    const rawTarget = event.target;
    if (!(rawTarget instanceof Element)) return;

    // 1. Direct modal backdrop close (target itself is the backdrop)
    const backdropAction = rawTarget.dataset?.backdropClose;
    if (backdropAction && BACKDROP_CLOSE_HANDLERS[backdropAction]) {
      BACKDROP_CLOSE_HANDLERS[backdropAction](rawTarget, event);
      return;
    }

    // 2. Respect data-stop-prop boundaries (e.g. inline budget input inside clickable card)
    const stopEl = rawTarget.closest("[data-stop-prop]");
    const clickEl = rawTarget.closest("[data-click]");
    if (!clickEl) return;
    if (stopEl && clickEl.contains(stopEl) && stopEl !== clickEl) return;

    const action = clickEl.dataset.click;
    const handler = CLICK_HANDLERS[action];
    if (handler) {
      handler(clickEl, event);
    }
  });

  document.addEventListener("change", (event) => {
    const rawTarget = event.target;
    if (!(rawTarget instanceof Element)) return;
    const el = rawTarget.closest("[data-change]");
    if (!el) return;
    const handler = CHANGE_HANDLERS[el.dataset.change];
    if (handler) handler(el, event);
  });

  document.addEventListener("input", (event) => {
    const rawTarget = event.target;
    if (!(rawTarget instanceof Element)) return;
    const el = rawTarget.closest("[data-input]");
    if (!el) return;
    const handler = INPUT_HANDLERS[el.dataset.input];
    if (handler) handler(el, event);
  });

  document.addEventListener("submit", (event) => {
    const rawTarget = event.target;
    if (!(rawTarget instanceof Element)) return;
    const form = rawTarget.closest("form[data-submit]");
    if (!form) return;
    event.preventDefault();
    const handler = SUBMIT_HANDLERS[form.dataset.submit];
    if (handler) handler(form, event);
  });

  document.addEventListener("keydown", (event) => {
    const rawTarget = event.target;
    if (!(rawTarget instanceof Element)) return;
    const el = rawTarget.closest("[data-keydown]");
    if (!el) return;
    const handler = KEYDOWN_HANDLERS[el.dataset.keydown];
    if (handler) handler(el, event);
  });

  ["dragover", "dragleave", "drop"].forEach((evType) => {
    document.addEventListener(evType, (event) => {
      const rawTarget = event.target;
      if (!(rawTarget instanceof Element)) return;
      const el = rawTarget.closest(`[data-${evType}]`);
      if (!el) return;
      const handler = DRAG_HANDLERS[el.dataset[evType]];
      if (handler) handler(el, event);
    });
  });
}

if (typeof document !== "undefined") {
  initFinanceGrEventDelegation();
}

/* ==========================================================================
   13. MASTER RENDER LOOP
   ========================================================================== */
function render() {
  applyThemeAndPrivacy();
  updateBackupStatusUI();
  populatePeriodSelectors();
  const teleCb = document.getElementById("anonymousTelemetryToggle");
  if (teleCb) {
    teleCb.checked = data.settings?.anonymousTelemetryEnabled !== false;
  }
  const demoBanner = document.getElementById("demoModeActiveBanner");
  if (demoBanner) {
    demoBanner.style.display = data.settings?.isDemoData ? "flex" : "none";
  }
  renderFirstUseGuide();

  const split = getCoupleSplit();
  const memberSel = document.getElementById("memberViewSelect");
  if (memberSel) {
    memberSel.style.display = split.hasPartner ? "inline-block" : "none";
    if (split.hasPartner) {
      memberSel.options[1].text = `👤 ${split.myName}`;
      memberSel.options[2].text = `👤 ${split.partnerName}`;
      memberSel.value = data.settings.memberView || "all";
    } else {
      data.settings.memberView = "all";
    }
  }
  const memberView = data.settings.memberView || "all";

  const ctx = getActivePeriodContext();
  setTextSafe("activePeriodBadge", `${ctx.label}${split.hasPartner ? ` • 👫 ${split.myName} (${split.myPct}%) & ${split.partnerName} (${split.partnerPct}%)` : ""}`);

  const totals = getPeriodTotals(ctx.start, ctx.end, memberView, split);

  // Net Worth is a point-in-time snapshot and must not change with the report period selector.
  const isPartnerOnlyView = split.hasPartner && memberView === "partner";
  const isSharedOnlyView = split.hasPartner && memberView === "shared";
  const netWorthSnapshot = computeNetWorthSnapshot(memberView, split, today());
  const { cashReserve, goalsTotal, portfolioTotal, cashFlow, netWorth } = netWorthSnapshot;

  setTextSafe(
    "netWorthTitleLabel",
    isPartnerOnlyView
      ? `💎 Σωρευτική Καθαρή Ροή (${split.partnerName})`
      : (isSharedOnlyView ? "💎 Σωρευτικό Ισοζύγιο Κοινών Κινήσεων" : "💎 Συνολική Καθαρή Θέση (Net Worth)")
  );
  setTextSafe("netWorthMetric", money(netWorth));
  setTextSafe(
    "netWorthPeriodSubtitle",
    isPartnerOnlyView
      ? `Έως ${netWorthSnapshot.asOfDate} • Σωρευτικές κινήσεις συντρόφου και μερίδιο κοινών συναλλαγών`
      : (isSharedOnlyView
        ? `Έως ${netWorthSnapshot.asOfDate} • Μόνο κοινές κινήσεις, χωρίς μη καταχωρισμένα περιουσιακά στοιχεία`
        : `Έως ${netWorthSnapshot.asOfDate} • Ανεξάρτητο από την επιλεγμένη περίοδο • Το αρχικό αποθεματικό θεωρείται υπόλοιπο πριν από την πρώτη καταχωρισμένη συναλλαγή${split.hasPartner && memberView === "all" ? " • Τα περιουσιακά στοιχεία αφορούν τον κύριο χρήστη, η ροή όλο το νοικοκυριό" : ""} • Δεν αφαιρούνται μη καταχωρισμένες υποχρεώσεις`)
  );
  setTextSafe("nwReserve", money(cashReserve));
  setTextSafe("nwGoalsTotal", money(goalsTotal));
  setTextSafe("nwPortfolio", money(portfolioTotal));
  setTextSafe("nwCashLabel", "💵 Σωρευτική Ταμειακή Ροή");
  setTextSafe("nwMonthCash", money(cashFlow));
  const liabTot = Number(netWorthSnapshot.liabilitiesTotal) || 0;
  setTextSafe("nwLiabilities", liabTot > 0 ? `-${money(liabTot)}` : money(0));

  // 4 Main KPIs + Hero Stat Chips (Savings Rate & Emergency Runway)
  const netSaving = Math.max(0, totals.saving - totals.withdrawal);
  const yearMult = ctx.mode === "year" ? 12 : 1;
  let declaredBaseIncome = (Number(data.profile.monthlyIncome) || 0) * yearMult;
  if (split.hasPartner) {
    if (memberView === "partner") declaredBaseIncome = (Number(data.profile.partnerIncome) || 0) * yearMult;
    else if (memberView === "all") declaredBaseIncome = ((Number(data.profile.monthlyIncome) || 0) + (Number(data.profile.partnerIncome) || 0)) * yearMult;
  }
  const hasSalaryInPeriod = filterTransactionsForRange(ctx.start, ctx.end, true).some(isRegularSalaryTx);
  const effectiveIncomeBase = (!ctx.isClosed && !hasSalaryInPeriod && declaredBaseIncome > 0)
    ? Math.max(totals.income, declaredBaseIncome)
    : (totals.income > 0 ? totals.income : declaredBaseIncome);
  const savingsRatePct = effectiveIncomeBase > 0 ? Math.max(0, (netSaving / effectiveIncomeBase) * 100) : 0;
  const histAvg = (() => {
    const nowD = new Date();
    let sum = 0, cnt = 0;
    for (let i = 1; i <= 3; i++) {
      const d = new Date(nowD.getFullYear(), nowD.getMonth() - i, 1);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      const e = getPeriodTotals(`${ym}-01`, `${ym}-${String(last).padStart(2, "0")}`, memberView, split).expense;
      if (e > 0) { sum += e; cnt++; }
    }
    return cnt ? sum / cnt : 0;
  })();
  const periodMonthly = totals.expense / yearMult;
  const monthlyExpenseRef = (ctx.isCurrent && histAvg > 0) ? histAvg : (periodMonthly > 0 ? periodMonthly : (Number(data.profile.monthlyIncome) * 0.7 || 0));
  const liquidTotal = cashReserve + goalsTotal + Math.max(0, cashFlow);
  const runwayMonths = monthlyExpenseRef > 0 ? (liquidTotal / monthlyExpenseRef) : 0;

  setTextSafe("heroSavingsRateChip", `📈 Ποσοστό Αποταμίευσης: ${savingsRatePct.toFixed(0)}%`);
  setTextSafe("heroRunwayChip", runwayMonths > 0 ? `🛡️ Μαξιλάρι: ${runwayMonths.toFixed(1)} μήνες` : "🛡️ Μαξιλάρι: €0");

  setTextSafe("incomeMetric", money(totals.income));
  setTextSafe("incomeSub", totals.income > 0 ? "Καταγεγραμμένα έσοδα" : `Δηλωμένο: ${money(declaredBaseIncome)}`);

  setTextSafe("expenseMetric", money(totals.expense));
  setTextSafe("expenseSub", totals.unexpected > 0 ? `Εκ των οποίων έκτακτα: ${money(totals.unexpected)}` : "Σύνολο δαπανών περιόδου");

  setTextSafe("savingMetric", money(netSaving));
  const goalApplies = !split.hasPartner || memberView === "all" || memberView === "me";
  const saveGoal = goalApplies ? (Number(data.profile.savingGoal) || 0) * yearMult : 0;
  setTextSafe("savingSub", saveGoal > 0 ? `Στόχος περιόδου: ${money(saveGoal)}` : "Αποταμίευση & Επενδύσεις");

  // Safe-to-Spend Calculation
  const safeLabelEl = document.getElementById("safeToSpendLabel");
  const safeMetricEl = document.getElementById("safeToSpendMetric");
  if (isSharedOnlyView) {
    const mySharedPart = (totals.expense * split.myPct) / 100;
    const ptSharedPart = (totals.expense * split.partnerPct) / 100;
    if (safeLabelEl) safeLabelEl.textContent = "👫 Επιμερισμός Κοινών Περιόδου";
    if (safeMetricEl) {
      safeMetricEl.textContent = `${money(mySharedPart)} / ${money(ptSharedPart)}`;
      safeMetricEl.className = "metric primary privacy-sensitive";
    }
    setTextSafe("safeToSpendSub", `${split.myName} (${split.myPct}%) • ${split.partnerName} (${split.partnerPct}%)`);
  } else {
    const remainingSavingCommitment = ctx.isClosed ? 0 : Math.max(0, saveGoal - totals.saving);
    const upcomingRecurring = computeUpcomingRecurringExpenses(ctx, memberView, split);
    const freeCash = Number((effectiveIncomeBase + totals.withdrawal - totals.expense - totals.saving - remainingSavingCommitment - upcomingRecurring).toFixed(2));

    if (ctx.isClosed) {
      if (safeLabelEl) safeLabelEl.textContent = "🏁 Τελικό Υπόλοιπο Περιόδου";
      if (safeMetricEl) {
        safeMetricEl.textContent = money(freeCash);
        safeMetricEl.className = `metric ${freeCash >= 0 ? "accent" : "red"} privacy-sensitive`;
      }
      setTextSafe("safeToSpendSub", "Κλειστή περίοδος (ολοκληρώθηκε)");
    } else {
      const dailySafe = freeCash / Math.max(1, ctx.remainingDays);
      if (safeLabelEl) safeLabelEl.textContent = "⚡ Safe-to-Spend (Ημερήσιο)";
      if (safeMetricEl) {
        safeMetricEl.textContent = `${money(dailySafe)} / ημέρα`;
        safeMetricEl.className = `metric ${freeCash < 0 ? "red" : (dailySafe < 10 ? "warn" : "accent")} privacy-sensitive`;
      }
      const recurringNote = upcomingRecurring > 0 ? ` (μετά από ${money(upcomingRecurring)} επερχόμενα πάγια)` : "";
      setTextSafe("safeToSpendSub", `${money(freeCash)} διαθέσιμα${recurringNote} • ${ctx.remainingDays} ημέρες`);
    }
  }

  // Profile Summary Bar
  const profText = document.getElementById("profileSummaryText");
  if (profText) {
    const greet = data.profile.userName ? `👋 Γεια σου, <strong>${escapeHtml(data.profile.userName)}</strong>` : "👤 <strong>Προφίλ Χρήστη</strong>";
    const incStr = Number(data.profile.monthlyIncome) > 0 ? ` • Εισόδημα: <strong>${money(data.profile.monthlyIncome)}</strong>` : "";
    const partnerStr = split.hasPartner ? ` • 👫 Σύντροφος: <strong>${escapeHtml(split.partnerName)}</strong> (${split.myPct}% / ${split.partnerPct}%)` : "";
    profText.innerHTML = `${greet}${incStr}${partnerStr}`;
  }

  // Smart Salary Banner
  const salaryBanner = document.getElementById("smartSalaryBanner");
  if (salaryBanner) {
    const shouldShow = Number(data.profile.monthlyIncome) > 0 && !hasSalaryInPeriod && ctx.mode !== "year";
    salaryBanner.style.display = shouldShow ? "flex" : "none";
  }

  // Sync Settings inputs
  if (document.activeElement?.tagName !== "INPUT") {
    document.getElementById("userName").value = data.profile.userName || "";
    document.getElementById("monthlyIncome").value = data.profile.monthlyIncome || "";
    document.getElementById("savingGoal").value = data.profile.savingGoal || "";
    document.getElementById("initialSavings").value = data.profile.initialSavings || "";
    document.getElementById("paydayDay").value = data.profile.paydayDay || 25;
    document.getElementById("partnerName").value = data.profile.partnerName || "";
    document.getElementById("partnerIncome").value = data.profile.partnerIncome || "";
    document.getElementById("splitMode").value = data.profile.splitMode || "auto";
    document.getElementById("customUserSharePct").value = data.profile.customUserSharePct ?? 50;
    const unlinkBtn = document.getElementById("unlinkPartnerSettingsBtn");
    if (unlinkBtn) unlinkBtn.style.display = split.hasPartner ? "inline-flex" : "none";
    previewProfileSplit();
  }

  renderAnomalyAlert(totals, split, memberView);
  renderCoupleSettlement(ctx, split);
  renderCharts(totals, split, memberView);
  render503020(totals);
  renderTopMerchants(ctx, split, memberView);
  renderTransactionsTable();
  renderBudgets(totals);
  renderSubscriptionDetector();
  renderRecurringTable();
  renderGoals();
  renderAnnualBills();
  renderPortfolio();
  if (typeof renderLiabilities === "function") renderLiabilities();

  renderEReceiptsTracker();
  renderMerchantRulesManager();
  if (typeof updateTickerGuardUI === "function") updateTickerGuardUI();
}

/* ==========================================================================
   14. INITIALIZATION & LIFECYCLE SYNC
   ========================================================================== */
let appInitialized = false;

async function syncCycleNow(silent = true) {
  if (!data.settings?.cloudSync?.enabled) return;
  await pullCloudSyncNow(silent);
  if (data.settings?.cloudSync?.pendingPush || dirtyTxIds.size > 0 || fullSyncNeeded) {
    await pushCloudSyncNow();
  }
}

async function initFinanceGRApp() {
  if (appInitialized) return;
  appInitialized = true;

  const monthInp = document.getElementById("activeMonth");
  if (monthInp && !monthInp.value) {
    monthInp.value = currentYearMonth();
  }

  const filterCat = document.getElementById("filterCategory");
  if (filterCat) {
    filterCat.innerHTML = `<option value="all">Όλες οι Κατηγορίες</option>` +
      ALL_CATEGORIES.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  }
  const annualCat = document.getElementById("annualCategory");
  if (annualCat) {
    annualCat.innerHTML = EXPENSE_CATEGORIES.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  }

  syncRecCategoryOptions();
  selectTransactionType("expense");
  setPeriodMode(data.settings?.periodMode || "month");
  setPlanningSubfilter(data.settings?.planningSubfilter || "all");

  window.addEventListener("resize", () => updateBackupStatusUI());
  window.addEventListener("online", () => {
    if (data.settings?.cloudSync?.enabled) {
      syncCycleNow(true);
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && data.settings?.cloudSync?.enabled) {
      syncCycleNow(true);
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeMobileMoreDrawer();
      const customModal = document.getElementById("customModal");
      if (customModal && customModal.style.display === "flex") {
        customModal.style.display = "none";
        return;
      }
      ["transactionModal", "paydayModal", "bankImportModal", "cloudSyncModal", "coupleMergeModal", "shareModal", "liabilityPaymentModal", "privacySecurityModal", "welcomeSetupModal"].forEach(id => {
        const el = document.getElementById(id);
        if (el && el.style.display === "flex") el.style.display = "none";
      });
    }
    if (e.key === "Enter" && document.getElementById("transactionModal")?.style.display === "flex") {
      const tag = document.activeElement?.tagName;
      const type = document.activeElement?.type;
      if (tag === "INPUT" && ["text", "number", "date"].includes(type)) {
        e.preventDefault();
        addTransaction(false);
      }
    }
  });

  const nowD = new Date();
  const prevD = new Date(nowD.getFullYear(), nowD.getMonth() - 1, 1);
  const prevYm = `${prevD.getFullYear()}-${String(prevD.getMonth() + 1).padStart(2, "0")}`;
  const addedPrev = applyRecurringTransactionsForMonth(prevYm);
  const addedCur = applyRecurringTransactionsForMonth(currentYearMonth());
  if (addedPrev || addedCur) {
    persist(true, true);
  }

  if (typeof initFirebaseAuthIfConfigured === "function") {
    initFirebaseAuthIfConfigured();
  }
  if (typeof trackZeroKnowledgeEvent === "function") {
    trackZeroKnowledgeEvent("session_start", { oncePerSession: true });
  }

  render();

  if (!data.settings?.onboardingCompleted && !hasMeaningfulStateData(data)) {
    document.getElementById("welcomeSetupModal").style.display = "flex";
  }

  if (data.settings?.cloudSync?.enabled) {
    await syncCycleNow(true);
  }

  if ((data.portfolioAssets || []).some(a => a.ticker && Number(a.units) > 0)) {
    refreshPortfolioMarketPrices(false);
  }

  setInterval(() => {
    if (data.settings?.cloudSync?.enabled && !document.hidden) {
      syncCycleNow(true);
    }
  }, 15000);
}

if (document.readyState === "complete") {
  initFinanceGRApp();
} else {
  window.addEventListener("load", initFinanceGRApp);
}
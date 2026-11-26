/* ==========================================================================
   4. PERIODS (MONTH / PAYDAY CYCLE / YEAR) & COUPLE SPLIT
   ========================================================================== */
function getCoupleSplit() {
  const p = data.profile || {};
  const hasPartner = Boolean((p.partnerName && p.partnerName.trim()) || Number(p.partnerIncome) > 0);
  if (!hasPartner) {
    return {
      hasPartner: false,
      myName: p.userName?.trim() || "Εσύ",
      partnerName: "",
      myPct: 100,
      partnerPct: 0
    };
  }
  let myPct = 50;
  if (p.splitMode === "custom" && p.customUserSharePct !== "" && p.customUserSharePct !== null && p.customUserSharePct !== undefined) {
    const rawPct = Number(p.customUserSharePct);
    myPct = Number.isFinite(rawPct) ? Math.min(100, Math.max(0, rawPct)) : 50;
  } else {
    const myInc = Math.max(0, Number(p.monthlyIncome) || 0);
    const ptInc = Math.max(0, Number(p.partnerIncome) || 0);
    const total = myInc + ptInc;
    myPct = total > 0 ? Number(((myInc / total) * 100).toFixed(1)) : 50;
  }
  const partnerPct = Number((100 - myPct).toFixed(1));
  return {
    hasPartner: true,
    myName: p.userName?.trim() || "Εσύ",
    partnerName: p.partnerName?.trim() || "Σύντροφος",
    myPct,
    partnerPct
  };
}

function isRegularSalaryTx(t) {
  if (!t || t.type !== "income" || t.category !== "Μισθός" || !parseIsoDate(t.date)) return false;
  if ((t.owner || "me") !== "me") return false;
  const descNorm = normalizeText(t.description || "");
  return !hasBonusKeyword(descNorm);
}

function buildPaydayCycles() {
  const salaries = (data.transactions || [])
    .filter(isRegularSalaryTx)
    .sort((a, b) => a.date.localeCompare(b.date))
    .filter((t, i, arr) => i === 0 || daysBetweenIso(arr[i - 1].date, t.date) >= 10);

  const paydayDay = Math.min(31, Math.max(1, Number(data.profile.paydayDay) || 25));
  const cycles = [];

  if (salaries.length === 0) {
    const now = new Date();
    const curClamp = Math.min(paydayDay, new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate());
    const baseD = new Date(now.getFullYear(), now.getDate() >= curClamp ? now.getMonth() : now.getMonth() - 1, 1);
    const clampDay = (y, m) => Math.min(paydayDay, new Date(y, m + 1, 0).getDate());
    const startD = new Date(baseD.getFullYear(), baseD.getMonth(), clampDay(baseD.getFullYear(), baseD.getMonth()));
    const nextStart = new Date(baseD.getFullYear(), baseD.getMonth() + 1, clampDay(baseD.getFullYear(), baseD.getMonth() + 1));
    const endD = new Date(nextStart.getFullYear(), nextStart.getMonth(), nextStart.getDate() - 1);
    const startIso = `${startD.getFullYear()}-${String(startD.getMonth() + 1).padStart(2, "0")}-${String(startD.getDate()).padStart(2, "0")}`;
    const endIso = `${endD.getFullYear()}-${String(endD.getMonth() + 1).padStart(2, "0")}-${String(endD.getDate()).padStart(2, "0")}`;
    cycles.push({
      id: `${startIso}_${endIso}`,
      start: startIso,
      end: endIso,
      label: `${startIso.slice(8, 10)}/${startIso.slice(5, 7)} – ${endIso.slice(8, 10)}/${endIso.slice(5, 7)}/${endIso.slice(0, 4)}`
    });
    return cycles;
  }

  for (let i = 0; i < salaries.length; i++) {
    const startIso = salaries[i].date;
    let endIso;
    if (i + 1 < salaries.length) {
      endIso = addDaysIso(salaries[i + 1].date, -1);
    } else {
      const sDate = parseIsoDate(startIso);
      const nextMonth = new Date(sDate.getFullYear(), sDate.getMonth() + 1, Math.min(paydayDay, new Date(sDate.getFullYear(), sDate.getMonth() + 2, 0).getDate()) - 1);
      endIso = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, "0")}-${String(nextMonth.getDate()).padStart(2, "0")}`;
      if (endIso < startIso) endIso = addDaysIso(startIso, 30);
    }
    cycles.push({
      id: `${startIso}_${endIso}`,
      start: startIso,
      end: endIso,
      label: `${startIso.slice(8, 10)}/${startIso.slice(5, 7)} – ${endIso.slice(8, 10)}/${endIso.slice(5, 7)}/${endIso.slice(0, 4)}`
    });
  }
  return cycles.reverse();
}

function getActivePeriodContext() {
  const mode = data.settings?.periodMode || "month";
  const todayIso = today();

  if (mode === "year") {
    const yr = document.getElementById("activeYearSelect")?.value || todayIso.slice(0, 4);
    const start = `${yr}-01-01`;
    const end = `${yr}-12-31`;
    const isClosed = end < todayIso;
    const isCurrent = todayIso >= start && todayIso <= end;
    const remainingDays = isCurrent ? Math.max(1, daysBetweenIso(todayIso, end) + 1) : Math.max(1, daysBetweenIso(start, end) + 1);
    return { mode: "year", key: yr, start, end, label: `Έτος ${yr}`, remainingDays, isClosed, isCurrent };
  }

  if (mode === "cycle") {
    const cycles = buildPaydayCycles();
    const sel = document.getElementById("activeCycleSelect");
    const chosenId = sel?.value;
    const active = cycles.find(c => c.id === chosenId) || cycles[0];
    const isClosed = active.end < todayIso;
    const isCurrent = todayIso >= active.start && todayIso <= active.end;
    const remainingDays = isCurrent
      ? Math.max(1, daysBetweenIso(todayIso, active.end) + 1)
      : Math.max(1, daysBetweenIso(active.start, active.end) + 1);
    return { mode: "cycle", key: active.id, start: active.start, end: active.end, label: `Κύκλος ${active.label}`, remainingDays, isClosed, isCurrent };
  }

  const ym = document.getElementById("activeMonth")?.value || currentYearMonth();
  const [y, m] = ym.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const start = `${ym}-01`;
  const end = `${ym}-${String(lastDay).padStart(2, "0")}`;
  const isClosed = end < todayIso;
  const isCurrent = ym === currentYearMonth();
  const remainingDays = isCurrent ? Math.max(1, lastDay - new Date().getDate() + 1) : lastDay;
  return { mode: "month", key: ym, start, end, label: `Μήνας ${ym}`, remainingDays, isClosed, isCurrent };
}

function setPeriodMode(mode) {
  data.settings.periodMode = mode;
  document.getElementById("modeMonthBtn")?.classList.toggle("active", mode === "month");
  document.getElementById("modeCycleBtn")?.classList.toggle("active", mode === "cycle");
  document.getElementById("modeYearBtn")?.classList.toggle("active", mode === "year");

  const monthInp = document.getElementById("activeMonth");
  const cycleSel = document.getElementById("activeCycleSelect");
  const yearSel = document.getElementById("activeYearSelect");

  if (monthInp) monthInp.style.display = mode === "month" ? "inline-block" : "none";
  if (cycleSel) cycleSel.style.display = mode === "cycle" ? "inline-block" : "none";
  if (yearSel) yearSel.style.display = mode === "year" ? "inline-block" : "none";

  populatePeriodSelectors();
  persist(true, true);
  render();
}

function populatePeriodSelectors() {
  const cycleSel = document.getElementById("activeCycleSelect");
  if (cycleSel) {
    const prevVal = cycleSel.value;
    const cycles = buildPaydayCycles();
    cycleSel.innerHTML = cycles.map(c => `<option value="${escapeHtml(c.id)}">💰 ${escapeHtml(c.label)}</option>`).join("");
    if (prevVal && cycles.some(c => c.id === prevVal)) cycleSel.value = prevVal;
  }

  const yearSel = document.getElementById("activeYearSelect");
  if (yearSel) {
    const prevYr = yearSel.value || today().slice(0, 4);
    const yearsSet = new Set([today().slice(0, 4)]);
    (data.transactions || []).forEach(t => {
      if (t.date && t.date.length >= 4) yearsSet.add(t.date.slice(0, 4));
    });
    const years = Array.from(yearsSet).sort().reverse();
    yearSel.innerHTML = years.map(y => `<option value="${y}">📆 ${y}</option>`).join("");
    if (years.includes(prevYr)) yearSel.value = prevYr;
  }
}

function onPeriodSelectorChange() {
  render();
}

function onMemberViewChange() {
  const val = document.getElementById("memberViewSelect")?.value || "all";
  data.settings.memberView = val;
  persist(true, true);
  render();
}

function filterTransactionsForRange(startIso, endIso, excludeInternal = true) {
  return (data.transactions || []).filter(t => {
    if (!t || !t.date) return false;
    if (excludeInternal && t.isInternalTransfer) return false;
    return t.date >= startIso && t.date <= endIso;
  });
}

function filterTransactionsByMemberView(txList, memberView, split) {
  if (!split.hasPartner || memberView === "all") return txList;
  if (memberView === "shared") return txList.filter(t => Boolean(t.isShared));
  if (memberView === "me") {
    return txList.filter(t => (t.owner || "me") === "me" || Boolean(t.isShared));
  }
  if (memberView === "partner") {
    return txList.filter(t => t.owner === "partner" || Boolean(t.isShared));
  }
  return txList;
}

function getEffectiveTxAmountForMemberView(t, memberView, split) {
  const baseAmt = Number(t.amount) || 0;
  if (!split.hasPartner || !t.isShared) return baseAmt;
  if (memberView === "all" || memberView === "shared") return baseAmt;
  if (memberView === "me") return Number(((baseAmt * split.myPct) / 100).toFixed(2));
  if (memberView === "partner") return Number(((baseAmt * split.partnerPct) / 100).toFixed(2));
  return baseAmt;
}

function getPeriodTotals(startIso, endIso, memberView = "all", split = null) {
  const activeSplit = split || getCoupleSplit();
  const rangeTxs = filterTransactionsForRange(startIso, endIso, true);
  const txs = filterTransactionsByMemberView(rangeTxs, memberView, activeSplit);

  return txs.reduce((acc, t) => {
    const amt = getEffectiveTxAmountForMemberView(t, memberView, activeSplit);
    if (t.type === "income") {
      acc.income += amt;
    } else if (t.type === "expense") {
      const linkedLiab = t.linkedLiabilityId
        ? (data.liabilities || []).find(l => l && l.id === t.linkedLiabilityId)
        : null;
      const isCreditCardPayment = Boolean(
        t.linkedLiabilityId &&
        (t.linkedLiabilityType === "Credit Card" || linkedLiab?.type === "Credit Card")
      );
      if (isCreditCardPayment) {
        // Credit card purchases are already counted in period expenses when bought.
        // Only the interest portion of a card payment is a new period expense; principal is debt repayment.
        const rawTotal = Math.max(0.01, Number(t.amount) || amt);
        const scale = amt / rawTotal;
        const principalPart = roundMoney(Math.max(0, Number(t.liabilityPrincipal) || 0) * scale);
        const interestPart = roundMoney(Math.max(0, Number(t.liabilityInterest) || 0) * scale);
        acc.creditCardRepayment += principalPart;
        if (interestPart > 0) {
          acc.expense += interestPart;
          if (NEEDS_CATEGORIES.includes(t.category)) acc.needs += interestPart;
          if (WANTS_CATEGORIES.includes(t.category)) acc.wants += interestPart;
          acc.byCategory[t.category] = (acc.byCategory[t.category] || 0) + interestPart;
        }
      } else {
        acc.expense += amt;
        if (t.unexpected) acc.unexpected += amt;
        if (NEEDS_CATEGORIES.includes(t.category)) acc.needs += amt;
        if (WANTS_CATEGORIES.includes(t.category)) acc.wants += amt;
        acc.byCategory[t.category] = (acc.byCategory[t.category] || 0) + amt;
      }
    } else if (t.type === "saving") {
      acc.saving += amt;
      if (t.category === "Επένδυση") {
        acc.investmentSaving += amt;
      } else if (t.category === "Κουμπαράς Στόχου" || t.linkedGoalId) {
        acc.goalSaving += amt;
      } else {
        acc.cashSaving += amt;
      }
    } else if (t.type === "withdrawal") {
      acc.withdrawal += amt;
    }
    return acc;
  }, {
    income: 0,
    expense: 0,
    unexpected: 0,
    saving: 0,
    cashSaving: 0,
    goalSaving: 0,
    investmentSaving: 0,
    withdrawal: 0,
    needs: 0,
    wants: 0,
    creditCardRepayment: 0,
    byCategory: {}
  });
}

function computeCashReserveBalance(asOfDate = today(), allowNegative = false) {
  const initial = Math.max(0, Number(data.profile.initialSavings) || 0);
  let delta = 0;
  (data.transactions || []).forEach(t => {
    if (!t || !t.date || t.date > asOfDate || t.isInternalTransfer) return;
    if ((t.owner || "me") !== "me") return;
    const amt = Number(t.amount) || 0;
    if (!Number.isFinite(amt) || amt <= 0) return;
    if (t.type === "saving") {
      if (t.category === "Επένδυση" || t.category === "Κουμπαράς Στόχου" || t.linkedGoalId) return;
      delta += amt;
    } else if (t.type === "withdrawal") {
      if (t.category === "Επένδυση" || t.category === "Κουμπαράς Στόχου" || t.linkedGoalId) return;
      delta -= amt;
    }
  });
  const balance = Number((initial + delta).toFixed(2));
  return allowNegative ? balance : Math.max(0, balance);
}

// Cumulative cash flow is used by Net Worth, not the currently selected report period.
// Savings/withdrawals are treated as transfers between asset buckets and are therefore
// included with opposite signs so that goal jars and investment holdings are not counted twice.
function computeLifetimeCashFlow(memberView = "all", split = null, asOfDate = today()) {
  const activeSplit = split || getCoupleSplit();
  const eligible = (data.transactions || []).filter(t =>
    t && t.date && t.date <= asOfDate && !t.isInternalTransfer
  );
  const txs = filterTransactionsByMemberView(eligible, memberView, activeSplit);
  const total = txs.reduce((sum, t) => {
    // Credit card purchases increase the card liability instead of reducing bank cash immediately.
    // Excluding them from lifetime cashFlow prevents double-counting in Net Worth (Assets - Liabilities).
    if (t.paidByCreditCardId) return sum;
    const amount = getEffectiveTxAmountForMemberView(t, memberView, activeSplit);
    if (!Number.isFinite(amount) || amount <= 0) return sum;
    if (t.type === "income" || t.type === "withdrawal") return sum + amount;
    if (t.type === "expense" || t.type === "saving") return sum - amount;
    return sum;
  }, 0);
  return Number(total.toFixed(2));
}

function computeNetWorthSnapshot(memberView = "all", split = null, asOfDate = today()) {
  const activeSplit = split || getCoupleSplit();
  const partnerOnly = activeSplit.hasPartner && memberView === "partner";
  const sharedOnly = activeSplit.hasPartner && memberView === "shared";
  const includePrimaryUserAssets = !partnerOnly && !sharedOnly;
  const cashReserve = includePrimaryUserAssets ? computeCashReserveBalance(asOfDate, true) : 0;
  const goalsTotal = includePrimaryUserAssets
    ? fromCents((data.goals || []).reduce((sumCents, goal) => sumCents + toCents(goal.saved), 0))
    : 0;
  const portfolioTotal = includePrimaryUserAssets
    ? fromCents((data.portfolioAssets || []).reduce((sumCents, asset) => sumCents + toCents(asset.current), 0))
    : 0;
  const cashFlow = computeLifetimeCashFlow(memberView, activeSplit, asOfDate);
  const liabilitiesTotal = computeLiabilitiesBalance(asOfDate, memberView, activeSplit);
  const assetsTotalCents = toCents(cashReserve) + toCents(goalsTotal) + toCents(portfolioTotal) + toCents(cashFlow);
  const netWorth = fromCents(assetsTotalCents - toCents(liabilitiesTotal));
  return { asOfDate, cashReserve, goalsTotal, portfolioTotal, cashFlow, liabilitiesTotal, netWorth };
}

function matchRecurringItemsForMonth(ym, txPool = null, splitOverride = null) {
  const split = splitOverride || getCoupleSplit();
  const recurringList = (data.recurring || []).filter(r => r && !r.skippedMonths?.[ym]);
  const monthTxs = (txPool || data.transactions || []).filter(t =>
    t && !t.isInternalTransfer && (t.date || "").startsWith(ym)
  );

  const matchedByRecId = new Map();
  const consumedTxIds = new Set();

  const isEligibleOwner = (r, t) =>
    (t.owner || "me") === "me" || (split.hasPartner && Boolean(r.isShared) && Boolean(t.isShared));

  const amountMatches = (r, t) =>
    Math.abs((Number(t.amount) || 0) - (Number(r.amount) || 0)) < 0.02;

  const merchantKeyMatches = (r, t) => {
    const rKey = extractMerchantKey(r.title || "");
    if (!rKey) return false;
    const tKey1 = extractMerchantKey(t.description || "");
    const tKey2 = t.originalBankDesc ? extractMerchantKey(t.originalBankDesc) : "";
    return [tKey1, tKey2].filter(Boolean).some(tk => rKey === tk || rKey.includes(tk) || tk.includes(rKey));
  };

  recurringList.forEach(r => {
    const hit = monthTxs.find(t => !consumedTxIds.has(t.id) && t.recurringId === r.id);
    if (hit) {
      matchedByRecId.set(r.id, hit);
      consumedTxIds.add(hit.id);
    }
  });

  recurringList.forEach(r => {
    if (matchedByRecId.has(r.id)) return;
    const hit = monthTxs.find(t =>
      !consumedTxIds.has(t.id) &&
      isEligibleOwner(r, t) &&
      t.type === r.type &&
      amountMatches(r, t) &&
      merchantKeyMatches(r, t)
    );
    if (hit) {
      matchedByRecId.set(r.id, hit);
      consumedTxIds.add(hit.id);
    }
  });

  recurringList.forEach(r => {
    if (matchedByRecId.has(r.id)) return;
    const hit = monthTxs.find(t =>
      !consumedTxIds.has(t.id) &&
      isEligibleOwner(r, t) &&
      t.type === r.type &&
      t.category === r.category &&
      amountMatches(r, t)
    );
    if (hit) {
      matchedByRecId.set(r.id, hit);
      consumedTxIds.add(hit.id);
    }
  });

  return matchedByRecId;
}

function computeUpcomingRecurringExpenses(ctx, memberView, split) {
  if (ctx.isClosed) return 0;
  const todayIso = today();
  const rangeTxs = filterTransactionsForRange(ctx.start, ctx.end, true)
    .filter(t => t.type === "expense");
  let upcomingSum = 0;

  const monthsToCheck = new Set();
  const sDate = parseIsoDate(ctx.start);
  const eDate = parseIsoDate(ctx.end);
  if (sDate && eDate) {
    const cur = new Date(sDate.getFullYear(), sDate.getMonth(), 1);
    while (cur <= eDate) {
      monthsToCheck.add(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}`);
      cur.setMonth(cur.getMonth() + 1);
    }
  }

  for (const ym of monthsToCheck) {
    const [y, m] = ym.split("-").map(Number);
    const maxDay = new Date(y, m, 0).getDate();
    const matchedByRecId = matchRecurringItemsForMonth(ym, rangeTxs, split);

    (data.recurring || []).forEach(r => {
      if (r.type !== "expense") return;
      if (r.skippedMonths?.[ym]) return;

      const dStr = String(Math.min(maxDay, Math.max(1, Number(r.day) || 1))).padStart(2, "0");
      const dueIso = `${ym}-${dStr}`;
      if (dueIso < ctx.start || dueIso > ctx.end) return;
      if (dueIso <= todayIso) return;

      if (matchedByRecId.has(r.id)) return;

      const isShared = split.hasPartner && Boolean(r.isShared);
      if (split.hasPartner) {
        if (memberView === "shared" && !isShared) return;
        if (memberView === "partner" && !isShared) return;
      }

      const rawAmt = Number(r.amount) || 0;
      const effAmt = (split.hasPartner && isShared && memberView === "me")
        ? (rawAmt * split.myPct) / 100
        : (split.hasPartner && isShared && memberView === "partner" ? (rawAmt * split.partnerPct) / 100 : rawAmt);

      upcomingSum += effAmt;
    });
  }

  return Number(upcomingSum.toFixed(2));
}

/* ==========================================================================
   5. NAVIGATION, FIRST-USE GUIDE & THEME
   ========================================================================== */
function switchTab(tabName) {
  document.querySelectorAll(".nav-tab").forEach(btn => {
    const active = btn.dataset.tab === tabName;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });
  document.querySelectorAll(".mob-nav-item").forEach(btn => {
    const isWealthGroup = btn.dataset.tab === "wealth" && ["wealth", "loans", "cards"].includes(tabName);
    btn.classList.toggle("active", btn.dataset.tab === tabName || isWealthGroup);
  });
  document.querySelectorAll("[data-mwealth]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.mwealth === tabName);
  });
  const topSettingsBtn = document.getElementById("topSettingsBtn");
  if (topSettingsBtn) {
    topSettingsBtn.style.borderColor = tabName === "settings" ? "var(--primary)" : "";
    topSettingsBtn.style.background = tabName === "settings" ? "var(--primary-soft)" : "";
  }
  document.querySelectorAll(".tab-panel").forEach(p => {
    p.classList.toggle("active", p.id === `tab-${tabName}`);
  });
  if (tabName === "wealth") {
    renderPortfolio();
    renderWealthSimulator();
  } else if (tabName === "loans") {
    if (typeof renderLoansTab === "function") renderLoansTab();
  } else if (tabName === "cards") {
    if (typeof renderCreditCardsTab === "function") renderCreditCardsTab();
  } else if (tabName === "settings") {
    if (typeof renderEReceiptsTracker === "function") renderEReceiptsTracker();
  }
}

function toggleDarkMode() {
  data.settings.darkMode = !data.settings.darkMode;
  applyThemeAndPrivacy();
  persist(true, true);
  render();
}

function togglePrivacyMode() {
  data.settings.privacyMode = !data.settings.privacyMode;
  applyThemeAndPrivacy();
  persist(true, true);
}

function applyThemeAndPrivacy() {
  document.body.classList.toggle("dark", Boolean(data.settings?.darkMode));
  document.body.classList.toggle("privacy-blur", Boolean(data.settings?.privacyMode));
  const darkBtn = document.getElementById("darkBtn");
  if (darkBtn) darkBtn.textContent = data.settings?.darkMode ? "☀️" : "🌙";
  const privBtn = document.getElementById("privacyBtn");
  if (privBtn) privBtn.textContent = data.settings?.privacyMode ? "🙈" : "👁️";
}

function renderFirstUseGuide() {
  const panel = document.getElementById("firstUseGuidePanel");
  if (!panel) return;
  if (data.settings?.firstUseDismissed) {
    panel.style.display = "none";
    return;
  }
  panel.style.display = "block";

  const step1Done = Boolean((data.profile.userName && data.profile.userName.trim()) || Number(data.profile.monthlyIncome) > 0);
  const step2Done = (data.transactions || []).length > 0;
  const step3Done = Boolean(data.settings?.cloudSync?.enabled);
  const doneCount = [step1Done, step2Done, step3Done].filter(Boolean).length;

  setTextSafe("firstUseProgressBadge", `${doneCount}/3 ολοκληρώθηκαν`);
  setTextSafe("step1Check", step1Done ? "✅" : "⬜");
  setTextSafe("step2Check", step2Done ? "✅" : "⬜");
  setTextSafe("step3Check", step3Done ? "✅" : "⬜");

  const collapsed = Boolean(data.settings?.firstUseCollapsed);
  const body = document.getElementById("firstUseGuideBody");
  const btn = document.getElementById("toggleFirstUseBtn");
  if (body) body.style.display = collapsed ? "none" : "block";
  if (btn) btn.textContent = collapsed ? "▼ Επέκταση" : "▲ Σύμπτυξη";
}

function toggleFirstUseCollapse() {
  data.settings.firstUseCollapsed = !data.settings.firstUseCollapsed;
  persist(true, true);
  renderFirstUseGuide();
}

function dismissFirstUseGuide() {
  data.settings.firstUseDismissed = true;
  persist(true, true);
  renderFirstUseGuide();
}

function reopenFirstUseGuide() {
  data.settings.firstUseDismissed = false;
  data.settings.firstUseCollapsed = false;
  persist(true, true);
  switchTab("overview");
  renderFirstUseGuide();
}

function loadDemoData() {
  showModal(
    "Φόρτωση ενδεικτικών δεδομένων επίδειξης (Demo); Αν έχεις ενεργό Cloud Sync, θα τεθεί προσωρινά σε παύση ώστε να μην επηρεαστεί το δωμάτιό σου.",
    true,
    (ok) => {
      if (!ok) return;
      if (data.settings?.cloudSync) {
        data.settings.cloudSync.enabled = false;
      }
      const ym = currentYearMonth();
      data.profile = {
        ...data.profile,
        userName: "Αλέξανδρος",
        monthlyIncome: 1450,
        savingGoal: 250,
        initialSavings: 2400,
        paydayDay: 25,
        typicalPayday: 25,
        partnerName: "Μαρία",
        partnerIncome: 1150,
        splitMode: "auto",
        customUserSharePct: 55.8
      };
      data.budgets = {
        ...data.budgets,
        "Στέγαση": 600,
        "Λογαριασμοί": 180,
        "Τρόφιμα": 350,
        "Μεταφορές": 120,
        "Διασκέδαση": 180
      };
      data.transactions = [
        { id: generateId("tx"), owner: "me", type: "income", category: "Μισθός", amount: 1450, date: `${ym}-01`, description: "Μισθοδοσία", source: "Πειραιώς", _updatedAt: Date.now() },
        { id: generateId("tx"), owner: "me", type: "expense", category: "Στέγαση", amount: 580, date: `${ym}-02`, description: "Ενοίκιο Σπιτιού", source: "Πειραιώς", isShared: true, paidBy: "me", settled: false, _updatedAt: Date.now() },
        { id: generateId("tx"), owner: "me", type: "expense", category: "Τρόφιμα", amount: 94.50, date: `${ym}-05`, description: "Σκλαβενίτης", source: "Revolut", isShared: true, paidBy: "me", settled: false, _updatedAt: Date.now() },
        { id: generateId("tx"), owner: "partner", type: "expense", category: "Λογαριασμοί", amount: 88.00, date: `${ym}-07`, description: "ΔΕΗ Ρεύμα", source: "Εθνική", isShared: true, paidBy: "partner", settled: false, _updatedAt: Date.now() },
        { id: generateId("tx"), owner: "me", type: "expense", category: "Διασκέδαση", amount: 24.50, date: `${ym}-09`, description: "Καφές & Brunch", source: "Revolut", isShared: false, _updatedAt: Date.now() },
        { id: generateId("tx"), owner: "me", type: "saving", category: "Επένδυση", amount: 200, date: `${ym}-10`, description: "Αγορά VUAA ETF", source: "Revolut", _updatedAt: Date.now() }
      ];
      data.portfolioAssets = [
        { id: generateId("asset"), name: "VUAA (S&P 500)", ticker: "VUAA.MIL", type: "ETF", units: 15, invested: 1800, current: 2085 },
        { id: generateId("asset"), name: "XEON Euro Overnight", ticker: "XEON.DE", type: "Κατάθεση / XEON", units: 7, invested: 1000, current: 1032 }
      ];
      data.goals = [
        { id: generateId("goal"), title: "Καλοκαιρινές Διακοπές", target: 1200, saved: 540, targetDate: `${ym.slice(0, 4)}-07-15` }
      ];
      data.settings.stateUpdatedAt = Date.now();
      persist(true, false);
      render();
      showToast("🧪 Φορτώθηκαν τα ενδεικτικά δεδομένα Demo!");
    },
    "Φόρτωση Demo"
  );
}



function toggleMobileMoreDrawer(forceOpen = null) {
  const backdrop = document.getElementById("mobileMoreDrawerBackdrop");
  const btn = document.getElementById("mobileMenuBtn");
  if (!backdrop) return;
  const currentlyOpen = backdrop.classList.contains("open");
  const nextOpen = forceOpen !== null ? Boolean(forceOpen) : !currentlyOpen;
  backdrop.classList.toggle("open", nextOpen);
  if (btn) btn.setAttribute("aria-expanded", String(nextOpen));
}

function closeMobileMoreDrawer() {
  toggleMobileMoreDrawer(false);
}

function mobileDrawerNavigateTab(tabName) {
  closeMobileMoreDrawer();
  switchTab(tabName);
}

/* ==========================================================================
   8. PAYDAY ALLOCATION, BUDGETS, RECURRING, SUBSCRIPTIONS, GOALS & ANNUAL BILLS
   ========================================================================== */
function openPaydayModal() {
  const inp = document.getElementById("paydayIncomeInput");
  if (inp) inp.value = Number(data.profile.monthlyIncome) || "";
  document.getElementById("paydayModal").style.display = "flex";
}

function closePaydayModal() {
  document.getElementById("paydayModal").style.display = "none";
}

function executePaydayAllocation() {
  const incomeAmt = Number(document.getElementById("paydayIncomeInput")?.value);
  if (!incomeAmt || incomeAmt <= 0) {
    showModal("Εισήγαγε ένα έγκυρο ποσό μισθοδοσίας (> €0).");
    return;
  }

  const fundGoals = Boolean(document.getElementById("paydayFundGoalsToggle")?.checked);
  const dateIso = today();
  const nowTs = Date.now();
  let createdCount = 0;

  const salId = generateId("tx");
  data.transactions.push({
    id: salId,
    owner: "me",
    type: "income",
    category: "Μισθός",
    amount: Number(incomeAmt.toFixed(2)),
    date: dateIso,
    description: "Μισθοδοσία",
    _updatedAt: nowTs
  });
  markTxDirty(salId);
  createdCount++;

  const saveGoal = Math.max(0, Number(data.profile.savingGoal) || 0);
  if (saveGoal > 0) {
    const savId = generateId("tx");
    data.transactions.push({
      id: savId,
      owner: "me",
      type: "saving",
      category: "Αποταμίευση",
      amount: saveGoal,
      date: dateIso,
      description: "Αυτόματη Αποταμίευση Μισθού",
      _updatedAt: nowTs
    });
    markTxDirty(savId);
    createdCount++;
  }

  if (fundGoals) {
    (data.goals || []).forEach(g => {
      const rem = Math.max(0, (Number(g.target) || 0) - (Number(g.saved) || 0));
      if (rem <= 0) return;
      let monthsLeft = 1;
      if (g.targetDate && g.targetDate > dateIso) {
        monthsLeft = Math.max(1, Math.round(daysBetweenIso(dateIso, g.targetDate) / 30));
      }
      const step = Math.min(rem, Number((rem / monthsLeft).toFixed(2)));
      if (step > 0) {
        g.saved = Number(((Number(g.saved) || 0) + step).toFixed(2));
        const gTxId = generateId("tx");
        data.transactions.push({
          id: gTxId,
          owner: "me",
          type: "saving",
          category: "Κουμπαράς Στόχου",
          amount: step,
          date: dateIso,
          description: `Κουμπαράς: ${g.title}`,
          linkedGoalId: g.id,
          _updatedAt: nowTs
        });
        markTxDirty(gTxId);
        createdCount++;
      }
    });
    data.settings.stateUpdatedAt = nowTs;
  }

  persist();
  closePaydayModal();
  render();
  showToast(`💸 Ολοκληρώθηκε η κατανομή μισθού (${createdCount} κινήσεις)!`);
}

function setPlanningSubfilter(key) {
  data.settings.planningSubfilter = key;
  document.querySelectorAll("[data-subfilter]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.subfilter === key);
  });
  document.querySelectorAll(".planning-section").forEach(sec => {
    sec.style.display = (key === "all" || sec.dataset.section === key) ? "block" : "none";
  });
}

let pendingAutoBudgetPlan = null;
let selectedAutoBudgetCategories = null;

function getActiveBudgetScope(splitOverride = null) {
  const split = splitOverride || getCoupleSplit();
  if (!split.hasPartner) return "all";
  const view = data.settings?.memberView || "all";
  return ["all", "me", "partner", "shared"].includes(view) ? view : "all";
}

function getBudgetsMapForView(viewKey = null) {
  const scope = viewKey || getActiveBudgetScope();
  if (scope === "all") {
    if (!data.budgets || typeof data.budgets !== "object") data.budgets = {};
    return data.budgets;
  }
  if (!data.budgetsByView || typeof data.budgetsByView !== "object") {
    data.budgetsByView = { me: {}, partner: {}, shared: {} };
  }
  if (!data.budgetsByView[scope] || typeof data.budgetsByView[scope] !== "object") {
    data.budgetsByView[scope] = {};
  }
  return data.budgetsByView[scope];
}

function getBudgetScopeLabel(scope, split) {
  if (!split.hasPartner || scope === "all") return "🏠 Όλο το Νοικοκυριό";
  if (scope === "me") return `👤 ${split.myName} (${split.myPct}% κοινών)`;
  if (scope === "partner") return `👤 ${split.partnerName} (${split.partnerPct}% κοινών)`;
  if (scope === "shared") return "👫 Μόνο Κοινά Έξοδα";
  return "🏠 Όλο το Νοικοκυριό";
}

function roundToFive(val) {
  return Math.max(0, Math.round((Number(val) || 0) / 5) * 5);
}

function computeAutoBudgetPlan(options = {}) {
  const split = options.split || getCoupleSplit();
  const scope = options.scope || getActiveBudgetScope(split);
  const includeAnnual = options.includeAnnual !== undefined ? Boolean(options.includeAnnual) : true;
  const refDate = parseIsoDate(options.asOfDate || today()) || new Date();
  const currentMap = getBudgetsMapForView(scope);

  // Selected categories (defaults to all EXPENSE_CATEGORIES for backwards compatibility)
  const selectedSet = options.selectedCategories instanceof Set
    ? new Set(Array.from(options.selectedCategories).filter(c => EXPENSE_CATEGORIES.includes(c)))
    : (Array.isArray(options.selectedCategories)
      ? new Set(options.selectedCategories.filter(c => EXPENSE_CATEGORIES.includes(c)))
      : new Set(EXPENSE_CATEGORIES));

  // 1. Collect last 3 completed calendar months (with fallback to current month if needed)
  const monthSamples = [];
  for (let i = 1; i <= 3; i++) {
    const d = new Date(refDate.getFullYear(), refDate.getMonth() - i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    monthSamples.push(getPeriodTotals(`${ym}-01`, `${ym}-${String(lastDay).padStart(2, "0")}`, scope, split));
  }
  let activeMonths = monthSamples.filter(m => m.expense > 0);
  if (activeMonths.length === 0) {
    const curYm = `${refDate.getFullYear()}-${String(refDate.getMonth() + 1).padStart(2, "0")}`;
    const curLast = new Date(refDate.getFullYear(), refDate.getMonth() + 1, 0).getDate();
    const curTotals = getPeriodTotals(`${curYm}-01`, `${curYm}-${String(curLast).padStart(2, "0")}`, scope, split);
    if (curTotals.expense > 0) activeMonths = [curTotals];
  }

  const histAvgByCat = {};
  EXPENSE_CATEGORIES.forEach(cat => {
    if (activeMonths.length === 0) {
      histAvgByCat[cat] = 0;
    } else {
      const sum = activeMonths.reduce((acc, m) => acc + (Number(m.byCategory[cat]) || 0), 0);
      histAvgByCat[cat] = Number((sum / activeMonths.length).toFixed(2));
    }
  });
  const totalHistExpense = Object.values(histAvgByCat).reduce((s, v) => s + v, 0);

  // 2. Recurring fixed floors & optional annual bills monthly reserve (amount / 12)
  const floorsByCat = {};
  EXPENSE_CATEGORIES.forEach(cat => { floorsByCat[cat] = 0; });

  let recurringIncomeSum = 0;
  let recurringSavingSum = 0;

  (data.recurring || []).forEach(r => {
    const amt = Number(r.amount) || 0;
    if (amt <= 0) return;

    if (r.type === "income") {
      const isProfileSalaryDup = r.category === "Μισθός" && Number(data.profile.monthlyIncome) > 0;
      if (!isProfileSalaryDup && (scope === "all" || scope === "me")) recurringIncomeSum += amt;
      return;
    }
    if (r.type === "saving") {
      if (scope === "all" || scope === "me") recurringSavingSum += amt;
      return;
    }
    if (r.type !== "expense") return;

    const isShared = split.hasPartner && Boolean(r.isShared);
    let effAmt = 0;
    if (!split.hasPartner || scope === "all") {
      effAmt = amt;
    } else if (scope === "shared") {
      effAmt = isShared ? amt : 0;
    } else if (scope === "me") {
      effAmt = isShared ? (amt * split.myPct) / 100 : amt;
    } else if (scope === "partner") {
      effAmt = isShared ? (amt * split.partnerPct) / 100 : 0;
    }

    if (effAmt > 0 && Object.prototype.hasOwnProperty.call(floorsByCat, r.category)) {
      floorsByCat[r.category] = Number((floorsByCat[r.category] + effAmt).toFixed(2));
    }
  });

  let annualReserveTotal = 0;
  if (includeAnnual && (scope === "all" || scope === "me")) {
    (data.annualBills || []).forEach(b => {
      const monthlyReserve = (Number(b.amount) || 0) / 12;
      const cat = EXPENSE_CATEGORIES.includes(b.category) ? b.category : "Λογαριασμοί";
      if (monthlyReserve > 0) {
        floorsByCat[cat] = Number((floorsByCat[cat] + monthlyReserve).toFixed(2));
        annualReserveTotal += monthlyReserve;
      }
    });
  }

  // Separate locked (unselected) budgets from selected floors
  let lockedBudgetsTotal = 0;
  let selectedFloorsTotal = 0;
  EXPENSE_CATEGORIES.forEach(cat => {
    if (selectedSet.has(cat)) {
      selectedFloorsTotal += floorsByCat[cat];
    } else {
      lockedBudgetsTotal += Math.max(0, Number(currentMap[cat]) || 0);
    }
  });
  lockedBudgetsTotal = Number(lockedBudgetsTotal.toFixed(2));
  selectedFloorsTotal = Number(selectedFloorsTotal.toFixed(2));
  const totalFloors = selectedFloorsTotal;

  // 3. Income base & savings commitment for the selected scope
  const incomeActiveMonths = monthSamples.filter(m => m.income > 0);
  const histAvgIncome = incomeActiveMonths.length > 0
    ? incomeActiveMonths.reduce((s, m) => s + m.income, 0) / incomeActiveMonths.length
    : 0;

  let monthlyIncomeBase = 0;
  if (scope === "shared") {
    monthlyIncomeBase = 0;
  } else if (!split.hasPartner || scope === "me") {
    monthlyIncomeBase = (Number(data.profile.monthlyIncome) || 0) + recurringIncomeSum;
  } else if (scope === "partner") {
    monthlyIncomeBase = Number(data.profile.partnerIncome) || 0;
  } else {
    monthlyIncomeBase = (Number(data.profile.monthlyIncome) || 0) + (Number(data.profile.partnerIncome) || 0) + recurringIncomeSum;
  }

  if (scope !== "shared" && monthlyIncomeBase <= 0 && histAvgIncome > 0) {
    monthlyIncomeBase = Number(histAvgIncome.toFixed(2));
  }

  const savingsCommitment = (scope === "all" || scope === "me")
    ? Math.max(Number(data.profile.savingGoal) || 0, recurringSavingSum)
    : 0;

  const isSharedUncapped = scope === "shared" || monthlyIncomeBase <= 0;
  const availableForAllExpenses = isSharedUncapped ? 0 : Math.max(0, Number((monthlyIncomeBase - savingsCommitment).toFixed(2)));
  const availableForSelected = isSharedUncapped ? 0 : Math.max(0, Number((availableForAllExpenses - lockedBudgetsTotal).toFixed(2)));
  const deficit = isSharedUncapped ? 0 : Math.max(0, Number((selectedFloorsTotal + lockedBudgetsTotal - availableForAllExpenses).toFixed(2)));
  const remainingPool = isSharedUncapped ? 0 : Math.max(0, Number((availableForSelected - selectedFloorsTotal).toFixed(2)));

  // 4. Allocate ONLY across selected categories
  const rawBudgets = {};
  let usedFallback503020 = false;
  let compressed = false;

  EXPENSE_CATEGORIES.forEach(cat => {
    if (!selectedSet.has(cat)) {
      rawBudgets[cat] = Math.max(0, Number(currentMap[cat]) || 0);
    }
  });

  const selectedList = EXPENSE_CATEGORIES.filter(cat => selectedSet.has(cat));

  if (selectedList.length > 0) {
    if (isSharedUncapped) {
      selectedList.forEach(cat => {
        rawBudgets[cat] = Math.max(floorsByCat[cat], histAvgByCat[cat]);
      });
    } else if (remainingPool <= 0) {
      selectedList.forEach(cat => {
        rawBudgets[cat] = floorsByCat[cat];
      });
    } else {
      const varNeeds = {};
      let sumVar = 0;
      selectedList.forEach(cat => {
        const v = Math.max(0, histAvgByCat[cat] - floorsByCat[cat]);
        varNeeds[cat] = v;
        sumVar += v;
      });

      if (sumVar > 0) {
        if (sumVar <= remainingPool) {
          selectedList.forEach(cat => {
            rawBudgets[cat] = floorsByCat[cat] + varNeeds[cat];
          });
        } else {
          const weights = {};
          compressed = true;
          let weightSum = 0;
          selectedList.forEach(cat => {
            const factor = WANTS_CATEGORIES.includes(cat) ? 0.7 : 1.0;
            weights[cat] = varNeeds[cat] * factor;
            weightSum += weights[cat];
          });
          selectedList.forEach(cat => {
            const extra = weightSum > 0 ? (remainingPool * weights[cat]) / weightSum : 0;
            rawBudgets[cat] = floorsByCat[cat] + extra;
          });
        }
      } else {
        usedFallback503020 = true;
        const defaultWeights = {
          "Στέγαση": floorsByCat["Στέγαση"] > 0 ? 0 : 20,
          "Τρόφιμα": 24,
          "Λογαριασμοί": 12,
          "Μεταφορές": 10,
          "Υγεία": 6,
          "Διασκέδαση": 16,
          "Έκτακτο έξοδο": 6,
          "Άλλο": 4,
          "Ανάληψη": 2
        };
        const weightSum = selectedList.reduce((s, cat) => s + (defaultWeights[cat] || 0), 0);
        selectedList.forEach(cat => {
          const extra = weightSum > 0 ? (remainingPool * (defaultWeights[cat] || 0)) / weightSum : 0;
          rawBudgets[cat] = floorsByCat[cat] + extra;
        });
      }
    }
  }

  // 5. Round selected categories to multiples of €5 while respecting floors
  const proposedBudgets = {};
  EXPENSE_CATEGORIES.forEach(cat => {
    if (!selectedSet.has(cat)) {
      proposedBudgets[cat] = Math.max(0, Number(currentMap[cat]) || 0);
    } else {
      const floorMin = floorsByCat[cat] > 0 ? Math.ceil(floorsByCat[cat] / 5) * 5 : 0;
      proposedBudgets[cat] = Math.max(floorMin, roundToFive(rawBudgets[cat]));
    }
  });

  if (!isSharedUncapped && deficit === 0 && availableForSelected > 0 && selectedList.length > 0 && (compressed || usedFallback503020)) {
    const targetRounded = Math.floor(availableForSelected / 5) * 5;
    const currentSelectedSum = selectedList.reduce((s, cat) => s + proposedBudgets[cat], 0);
    const residual = targetRounded - currentSelectedSum;
    if (residual !== 0) {
      const preferredSinks = ["Έκτακτο έξοδο", "Άλλο", ...selectedList];
      const sinkCat = preferredSinks.find(c => {
        if (!selectedSet.has(c)) return false;
        const floorMin = floorsByCat[c] > 0 ? Math.ceil(floorsByCat[c] / 5) * 5 : 0;
        return proposedBudgets[c] + residual >= floorMin;
      });
      if (sinkCat) {
        proposedBudgets[sinkCat] += residual;
      }
    }
  }

  const totalProposedSelected = selectedList.reduce((s, cat) => s + proposedBudgets[cat], 0);
  const totalProposed = EXPENSE_CATEGORIES.reduce((s, cat) => s + proposedBudgets[cat], 0);
  const unallocatedSurplus = !isSharedUncapped && availableForAllExpenses > totalProposed
    ? Number((availableForAllExpenses - totalProposed).toFixed(2))
    : 0;
  const cfg = data.settings?.cloudSync;
  const sharedOnlyWarning = Boolean(
    split.hasPartner &&
    scope === "all" &&
    cfg?.enabled &&
    cfg.mode === "couple" &&
    cfg.privacyScope === "sharedOnly"
  );

  return {
    scope,
    scopeLabel: getBudgetScopeLabel(scope, split),
    selectedCategories: Array.from(selectedSet),
    activeMonthsCount: activeMonths.length,
    usedFallback503020,
    compressed,
    isSharedUncapped,
    monthlyIncomeBase: Number(monthlyIncomeBase.toFixed(2)),
    savingsCommitment: Number(savingsCommitment.toFixed(2)),
    lockedBudgetsTotal,
    totalFloors,
    annualReserveTotal: Number(annualReserveTotal.toFixed(2)),
    remainingPool,
    deficit,
    unallocatedSurplus,
    totalHistExpense: Number(totalHistExpense.toFixed(2)),
    totalProposedSelected,
    totalProposed,
    floorsByCat,
    histAvgByCat,
    proposedBudgets,
    sharedOnlyWarning
  };
}

function toggleAutoBudgetCategory(cat, checked) {
  if (!selectedAutoBudgetCategories) {
    selectedAutoBudgetCategories = new Set(EXPENSE_CATEGORIES);
  }
  if (checked) selectedAutoBudgetCategories.add(cat);
  else selectedAutoBudgetCategories.delete(cat);
  previewAutoBudgetAllocation(true);
}

function setAutoBudgetCategoryPreset(preset) {
  const scope = getActiveBudgetScope();
  const currentMap = getBudgetsMapForView(scope);

  if (preset === "all") {
    selectedAutoBudgetCategories = new Set(EXPENSE_CATEGORIES);
  } else if (preset === "none") {
    selectedAutoBudgetCategories = new Set();
  } else if (preset === "needs") {
    selectedAutoBudgetCategories = new Set(NEEDS_CATEGORIES);
  } else if (preset === "wants") {
    selectedAutoBudgetCategories = new Set(WANTS_CATEGORIES);
  } else if (preset === "empty") {
    selectedAutoBudgetCategories = new Set(
      EXPENSE_CATEGORIES.filter(cat => !(Number(currentMap[cat]) > 0))
    );
  }
  previewAutoBudgetAllocation(true);
}

function previewAutoBudgetAllocation(keepSelection = false) {
  const includeAnnual = Boolean(document.getElementById("autoBudgetIncludeAnnual")?.checked);
  if (!keepSelection || !selectedAutoBudgetCategories) {
    selectedAutoBudgetCategories = new Set(EXPENSE_CATEGORIES);
  }

  const plan = computeAutoBudgetPlan({
    includeAnnual,
    selectedCategories: selectedAutoBudgetCategories
  });
  pendingAutoBudgetPlan = plan;

  const box = document.getElementById("autoBudgetPreviewBox");
  if (!box) return;

  const currentMap = getBudgetsMapForView(plan.scope);
  const selectedCount = selectedAutoBudgetCategories.size;
  const sourceBadge = plan.usedFallback503020
    ? `<span class="badge withdrawal">⚖️ Fallback 50/30/20 (χωρίς 3μηνο ιστορικό)</span>`
    : `<span class="badge income">📊 Βάσει 3μηνου ιστορικού (${plan.activeMonthsCount} ${plan.activeMonthsCount === 1 ? "μήνας" : "μήνες"})</span>`;

  const warnings = [];
  if (plan.sharedOnlyWarning) {
    warnings.push(`<div class="small" style="color:var(--warn); font-weight:600; margin-top:6px;">⚠️ Το Cloud Sync είναι σε λειτουργία «Μόνο Κοινά» — τα ατομικά έξοδα του/της συντρόφου δεν περιλαμβάνονται εδώ. Για πλήρη ακρίβεια, άλλαξε προβολή σε <strong>👤 Εσύ</strong>.</div>`);
  }
  if (plan.deficit > 0) {
    warnings.push(`<div class="small" style="color:var(--danger); font-weight:700; margin-top:6px;">⚠️ Τα πάγια + κλειδωμένα όρια + αποταμίευση υπερβαίνουν το εισόδημα κατά ${money(plan.deficit)}. Κλειδώθηκαν μόνο τα ελάχιστα όρια παγίων.</div>`);
  }
  if (plan.compressed) {
    warnings.push(`<div class="small" style="color:var(--primary); margin-top:4px;">ℹ️ Εφαρμόστηκε έξυπνη συμπίεση στις επιλεγμένες κατηγορίες για να κλείσει το πλάνο εντός εισοδήματος.</div>`);
  }
  if (plan.unallocatedSurplus > 0) {
    warnings.push(`<div class="small" style="color:var(--accent); font-weight:600; margin-top:4px;">🐷 Αδιάθετο πλεόνασμα ${money(plan.unallocatedSurplus)}/μήνα (διαθέσιμο για επιπλέον αποταμίευση).</div>`);
  }

  const lockedPart = plan.lockedBudgetsTotal > 0 ? ` − Κλειδωμένα: <strong>${money(plan.lockedBudgetsTotal)}</strong>` : "";
  const summaryLine = plan.isSharedUncapped
    ? `Εύρος: <strong>${escapeHtml(plan.scopeLabel)}</strong> • Πάγια (επιλεγμένων): <strong>${money(plan.totalFloors)}</strong> • Σύνολο Ορίων: <strong>${money(plan.totalProposed)}</strong>`
    : `Εισόδημα: <strong>${money(plan.monthlyIncomeBase)}</strong> − Αποταμίευση: <strong>${money(plan.savingsCommitment)}</strong>${lockedPart} − Πάγια${plan.annualReserveTotal > 0 ? " & Ετήσια" : ""}: <strong>${money(plan.totalFloors)}</strong> = Διαθέσιμο: <strong>${money(plan.remainingPool)}</strong>`;

  const rowsHtml = EXPENSE_CATEGORIES.map(cat => {
    const isChecked = selectedAutoBudgetCategories.has(cat);
    const oldVal = Number(currentMap[cat]) || 0;
    const newVal = Number(plan.proposedBudgets[cat]) || 0;
    const floorVal = Number(plan.floorsByCat[cat]) || 0;
    const histVal = Number(plan.histAvgByCat[cat]) || 0;
    const diff = newVal - oldVal;
    const diffStr = diff === 0 ? "" : ` <span style="color:${diff > 0 ? "var(--warn)" : "var(--accent)"};">(${diff > 0 ? "+" : ""}${money(diff)})</span>`;

    const rightSide = isChecked
      ? `<span class="small">${money(oldVal)} →</span> <strong>${money(newVal)}</strong>${diffStr}`
      : `<span class="small">🔒 Διατηρείται (${oldVal > 0 ? money(oldVal) : "Χωρίς όριο"})</span>`;

    return `
      <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; padding:6px 0; border-bottom:1px solid var(--border); font-size:12px; ${isChecked ? "" : "opacity:0.6;"}">
        <label style="display:flex; align-items:center; gap:8px; cursor:pointer; flex:1;">
          <input type="checkbox" ${isChecked ? "checked" : ""} data-abcat="${escapeHtml(cat)}" data-change="toggleAutoBudgetCategory" />
          <div>
            <strong>${escapeHtml(cat)}</strong>
            <span class="small">${floorVal > 0 ? ` • Πάγια: ${money(floorVal)}` : ""}${histVal > 0 ? ` • Μ.Ο. 3μ: ${money(histVal)}` : ""}</span>
          </div>
        </label>
        <div class="privacy-sensitive" style="white-space:nowrap;">
          ${rightSide}
        </div>
      </div>
    `;
  }).join("");

  box.style.display = "block";
  box.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:8px;">
      <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
        <strong style="font-size:14px;">✨ Προεπισκόπηση Αυτόματου Προϋπολογισμού (${escapeHtml(plan.scopeLabel)})</strong>
        ${sourceBadge}
      </div>
      <button type="button" class="secondary small-btn" data-click="closeAutoBudgetPreview" aria-label="Κλείσιμο προεπισκόπησης">✕</button>
    </div>

    <div style="display:flex; flex-wrap:wrap; align-items:center; gap:6px; margin-bottom:8px;">
      <span class="small" style="font-weight:600;">Επιλογή κατηγοριών:</span>
      <button type="button" class="secondary small-btn" data-click="setAutoBudgetCategoryPreset" data-arg="all">☑️ Όλες</button>
      <button type="button" class="secondary small-btn" data-click="setAutoBudgetCategoryPreset" data-arg="needs">🏠 Ανάγκες</button>
      <button type="button" class="secondary small-btn" data-click="setAutoBudgetCategoryPreset" data-arg="wants">🎉 Επιθυμίες</button>
      <button type="button" class="secondary small-btn" data-click="setAutoBudgetCategoryPreset" data-arg="empty">🆕 Μόνο κενές (€0)</button>
      <button type="button" class="secondary small-btn" data-click="setAutoBudgetCategoryPreset" data-arg="none">⬜ Καμία</button>
    </div>

    <div class="small" style="margin-bottom:6px;">${summaryLine}</div>
    ${warnings.join("")}
    <div style="margin:10px 0;">${rowsHtml}</div>
    <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
      <span class="small">Σύνολο ορίων (${selectedCount}/${EXPENSE_CATEGORIES.length} επιλεγμένες): <strong>${money(plan.totalProposed)}</strong></span>
      <div style="display:flex; gap:8px;">
        <button type="button" class="secondary small-btn" data-click="closeAutoBudgetPreview">Ακύρωση</button>
        <button type="button" class="accent small-btn" ${selectedCount === 0 ? "disabled" : ""} data-click="applyAutoBudgetAllocation">✅ Εφαρμογή σε ${selectedCount} ${selectedCount === 1 ? "κατηγορία" : "κατηγορίες"}</button>
      </div>
    </div>
  `;
}

function closeAutoBudgetPreview() {
  pendingAutoBudgetPlan = null;
  selectedAutoBudgetCategories = null;
  const box = document.getElementById("autoBudgetPreviewBox");
  if (box) {
    box.style.display = "none";
    box.innerHTML = "";
  }
}

function applyAutoBudgetAllocation() {
  if (!pendingAutoBudgetPlan) return;
  const plan = pendingAutoBudgetPlan;
  const chosen = Array.isArray(plan.selectedCategories) ? plan.selectedCategories : EXPENSE_CATEGORIES;
  if (chosen.length === 0) return;

  const targetMap = getBudgetsMapForView(plan.scope);
  chosen.forEach(cat => {
    targetMap[cat] = Number(plan.proposedBudgets[cat]) || 0;
  });
  data.settings.stateUpdatedAt = Date.now();
  closeAutoBudgetPreview();
  persist();
  render();
  showToast(`✅ Ενημερώθηκαν ${chosen.length} κατηγορίες για: ${plan.scopeLabel}!`);
}

function renderBudgets(totals) {
  const grid = document.getElementById("categoryBudgetsGrid");
  if (!grid) return;

  const split = getCoupleSplit();
  const scope = getActiveBudgetScope(split);
  const budgetsMap = getBudgetsMapForView(scope);

  const scopeBadge = document.getElementById("budgetsScopeBadge");
  if (scopeBadge) {
    scopeBadge.style.display = split.hasPartner ? "inline-flex" : "none";
    scopeBadge.textContent = getBudgetScopeLabel(scope, split);
  }

  if (pendingAutoBudgetPlan && pendingAutoBudgetPlan.scope !== scope) {
    closeAutoBudgetPreview();
  }

  const ctx = getActivePeriodContext();
  const isYear = ctx.mode === "year";
  const multiplier = isYear ? 12 : 1;
  setTextSafe(
    "budgetsSectionTitle",
    isYear ? "📊 Ετήσια Όρια Προϋπολογισμού ανά Κατηγορία (12× Μηνιαίο)" : "📊 Μηνιαία Όρια Προϋπολογισμού ανά Κατηγορία"
  );

  let totalBudgetLimit = 0;
  let totalBudgetSpent = 0;
  EXPENSE_CATEGORIES.forEach(cat => {
    const lim = (Number(budgetsMap[cat]) || 0) * multiplier;
    const sp = Number(totals.byCategory[cat]) || 0;
    totalBudgetLimit += lim;
    if (lim > 0) totalBudgetSpent += sp;
  });

  const summaryBar = document.getElementById("budgetsSummaryBar");
  if (summaryBar) {
    if (totalBudgetLimit > 0) {
      const totalPct = Math.min(100, (totalBudgetSpent / totalBudgetLimit) * 100);
      const diff = totalBudgetLimit - totalBudgetSpent;
      const barCol = diff < 0 ? "var(--danger)" : (totalPct > 85 ? "var(--warn)" : "var(--accent)");
      summaryBar.style.display = "block";
      summaryBar.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:6px;">
          <strong style="font-size:13px;">Σύνολο Προϋπολογισμού (${totalPct.toFixed(0)}%)</strong>
          <span class="small privacy-sensitive">
            Δαπάνες: <strong>${money(totalBudgetSpent)}</strong> / Όριο: <strong>${money(totalBudgetLimit)}</strong> •
            <strong style="color:${diff < 0 ? "var(--danger)" : "var(--accent)"};">
              ${diff >= 0 ? `Υπόλοιπο: ${money(diff)}` : `Υπέρβαση: ${money(Math.abs(diff))}`}
            </strong>
          </span>
        </div>
        <div class="progress" style="height:7px;"><div style="width:${totalPct}%; background:${barCol};"></div></div>
      `;
    } else {
      summaryBar.style.display = "none";
    }
  }

  grid.innerHTML = EXPENSE_CATEGORIES.map(cat => {
    const spent = totals.byCategory[cat] || 0;
    const monthlyLimit = Number(budgetsMap[cat]) || 0;
    const effectiveLimit = monthlyLimit * multiplier;
    const pct = effectiveLimit > 0 ? Math.min(100, (spent / effectiveLimit) * 100) : 0;
    const isOver = effectiveLimit > 0 && spent > effectiveLimit;
    const barColor = isOver ? "var(--danger)" : (pct > 80 ? "var(--warn)" : "var(--primary)");
    const remDiff = effectiveLimit - spent;
    const statusHint = effectiveLimit > 0
      ? `<span class="small privacy-sensitive" style="color:${isOver ? "var(--danger)" : "var(--muted)"}; font-weight:${isOver ? "700" : "500"};">${isOver ? `⚠️ +${money(Math.abs(remDiff))}` : `Υπόλ. ${money(remDiff)}`}</span>`
      : "";

    return `
      <div class="kpi-card drilldown-row" data-cat="${escapeHtml(cat)}" data-click="drillDownCategory">
        <div class="kpi-label">
          <strong>${escapeHtml(cat)}</strong>
          <span class="privacy-sensitive">${money(spent)} / ${effectiveLimit > 0 ? money(effectiveLimit) : "Χωρίς όριο"}</span>
        </div>
        <div class="progress">
          <div style="width:${effectiveLimit > 0 ? pct : (spent > 0 ? 100 : 0)}%; background:${effectiveLimit > 0 ? barColor : "var(--muted)"};"></div>
        </div>
        <div style="display:flex; align-items:center; justify-content:space-between; gap:6px; margin-top:10px;" data-stop-prop="1">
          <div style="display:flex; align-items:center; gap:6px;">
            <span class="small">Όριο (€):</span>
            <input type="number" min="0" step="10" value="${monthlyLimit || ""}" placeholder="0" data-cat="${escapeHtml(cat)}" data-change="updateCategoryBudget" style="width:86px; padding:4px 8px;" />
          </div>
          ${statusHint}
        </div>
      </div>
    `;
  }).join("");
}

function updateCategoryBudget(cat, val) {
  const budgetsMap = getBudgetsMapForView();
  budgetsMap[cat] = Math.max(0, Number(val) || 0);
  data.settings.stateUpdatedAt = Date.now();
  persist();
  render();
}

function toggleDetectedSubsCollapse() {
  data.settings.detectedSubsCollapsed = !data.settings.detectedSubsCollapsed;
  persist(true, true);
  renderSubscriptionDetector();
}

function renderSubscriptionDetector() {
  const body = document.getElementById("detectedSubsBody");
  const btn = document.getElementById("toggleDetectedSubsBtn");
  const badge = document.getElementById("detectedSubsSummaryBadge");
  if (!body) return;

  const collapsed = Boolean(data.settings?.detectedSubsCollapsed);
  body.style.display = collapsed ? "none" : "block";
  if (btn) btn.textContent = collapsed ? "▼ Εμφάνιση" : "▲ Απόκρυψη";

  const groups = new Map();
  (data.transactions || []).filter(t => t.type === "expense" && !t.isInternalTransfer && !t.recurringId && !/\((πάγιο|ετήσιο)\)\s*$/i.test(t.description || "")).forEach(t => {
    const key = extractMerchantKey(t.description || t.category);
    if (!key || key.length < 3) return;
    if (data.ignoredSubscriptions?.[key]) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  });

  const existingRecKeys = new Set((data.recurring || []).map(r => extractMerchantKey(r.title)));
  const candidates = [];

  for (const [key, txs] of groups.entries()) {
    if (existingRecKeys.has(key)) continue;
    const months = new Set(txs.map(t => (t.date || "").slice(0, 7)));
    if (months.size < 2) continue;
    const perMonth = {};
    txs.forEach(t => { const m = (t.date || "").slice(0, 7); perMonth[m] = (perMonth[m] || 0) + 1; });
    if (Math.max(...Object.values(perMonth)) > 1) continue;
    const amts = txs.map(t => Number(t.amount) || 0);
    if (Math.max(...amts) > Math.min(...amts) * 1.25) continue;
    const avgAmt = txs.reduce((s, t) => s + (Number(t.amount) || 0), 0) / txs.length;
    const sample = txs[txs.length - 1];
    candidates.push({
      key,
      title: sample.description || key,
      category: sample.category || "Λογαριασμοί",
      amount: Number(avgAmt.toFixed(2)),
      count: txs.length
    });
  }

  const totalMonthly = candidates.reduce((s, c) => s + c.amount, 0);
  if (badge) {
    badge.textContent = candidates.length > 0
      ? `${candidates.length} εντοπίστηκαν (${money(totalMonthly)}/μήνα)`
      : "0 εντοπίστηκαν";
  }

  if (candidates.length === 0) {
    body.innerHTML = `<div class="small">Δεν εντοπίστηκαν νέες επαναλαμβανόμενες χρεώσεις εκτός των δηλωμένων παγίων.</div>`;
    return;
  }

  body.innerHTML = `<div class="grid-3">${candidates.map(c => `
    <div class="kpi-card" style="background:var(--card-soft);">
      <div class="kpi-label">
        <strong>${escapeHtml(c.title)}</strong>
        <button type="button" class="secondary small-btn" data-subkey="${escapeHtml(c.key)}" data-click="ignoreDetectedSubscription" aria-label="Αγνόηση συνδρομής" title="Αγνόηση">✕</button>
      </div>
      <div class="metric primary" style="font-size:18px;">${money(c.amount)} <span class="small">/ μήνα</span></div>
      <div class="small" style="margin:4px 0 8px;">Κατηγορία: ${escapeHtml(c.category)} • ${c.count} χρεώσεις</div>
      <button type="button" class="small-btn" data-subtitle="${escapeHtml(c.title)}" data-subcat="${escapeHtml(c.category)}" data-subamt="${c.amount}" data-click="promoteSubToRecurring">➕ Προσθήκη στα Πάγια</button>
    </div>
  `).join("")}</div>`;
}

function ignoreDetectedSubscription(key) {
  if (!key) return;
  if (!data.ignoredSubscriptions) data.ignoredSubscriptions = {};
  data.ignoredSubscriptions[key] = true;
  data.settings.stateUpdatedAt = Date.now();
  persist();
  renderSubscriptionDetector();
}

function promoteSubToRecurring(title, category, amount) {
  const cleanTitle = String(title || "").trim();
  const cleanCat = String(category || "Λογαριασμοί").trim();
  const cleanAmt = Number(amount) || 0;
  if (!cleanTitle || cleanAmt <= 0) return;

  if (!Array.isArray(data.recurring)) data.recurring = [];
  data.recurring.push({
    id: generateId("rec"),
    title: cleanTitle,
    type: "expense",
    category: cleanCat,
    amount: cleanAmt,
    day: 1,
    isShared: false,
    skippedMonths: {}
  });
  data.settings.stateUpdatedAt = Date.now();
  persist();
  render();
  const recPanel = document.getElementById("recurringPanel");
  if (recPanel) {
    recPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  showToast(`🔁 Το «${cleanTitle}» (${money(cleanAmt)}/μήνα) προστέθηκε στα Πάγια!`);
}

function syncRecCategoryOptions() {
  const type = document.getElementById("recType")?.value || "expense";
  const sel = document.getElementById("recCategory");
  if (!sel) return;
  const list = type === "income" ? INCOME_CATEGORIES : (type === "saving" ? SAVING_CATEGORIES : EXPENSE_CATEGORIES);
  sel.innerHTML = list.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
}

function saveRecurringItem() {
  const editId = document.getElementById("editingRecurringId").value;
  const title = document.getElementById("recTitle").value.trim();
  const type = document.getElementById("recType").value;
  const category = document.getElementById("recCategory").value;
  const amount = Number(document.getElementById("recAmount").value);
  const day = Math.min(31, Math.max(1, Number(document.getElementById("recDay").value) || 1));
  const split = getCoupleSplit();
  const isShared = split.hasPartner && type === "expense" && Boolean(document.getElementById("recIsShared").checked);

  if (!title || !amount || amount <= 0) return;

  if (editId) {
    const idx = data.recurring.findIndex(r => r.id === editId);
    if (idx !== -1) {
      data.recurring[idx] = { ...data.recurring[idx], title, type, category, amount, day, isShared };
    }
    showToast("✅ Το πάγιο ενημερώθηκε!");
  } else {
    data.recurring.push({
      id: generateId("rec"),
      title,
      type,
      category,
      amount,
      day,
      isShared,
      skippedMonths: {}
    });
    showToast("🔁 Το πάγιο προστέθηκε!");
  }

  data.settings.stateUpdatedAt = Date.now();
  cancelRecurringEditor();
  applyRecurringTransactionsForMonth(currentYearMonth());
  persist();
  render();
}

function editRecurringItem(id) {
  const item = data.recurring.find(r => r.id === id);
  if (!item) return;
  document.getElementById("editingRecurringId").value = item.id;
  document.getElementById("recTitle").value = item.title;
  document.getElementById("recType").value = item.type;
  syncRecCategoryOptions();
  document.getElementById("recCategory").value = item.category;
  document.getElementById("recAmount").value = item.amount;
  document.getElementById("recDay").value = item.day || 1;
  document.getElementById("recIsShared").checked = Boolean(item.isShared);
  setTextSafe("saveRecBtn", "💾 Αποθήκευση");
  document.getElementById("cancelRecEditBtn").style.display = "inline-flex";
}

function cancelRecurringEditor() {
  document.getElementById("editingRecurringId").value = "";
  document.getElementById("recTitle").value = "";
  document.getElementById("recAmount").value = "";
  document.getElementById("recDay").value = "1";
  document.getElementById("recIsShared").checked = false;
  setTextSafe("saveRecBtn", "➕ Προσθήκη");
  document.getElementById("cancelRecEditBtn").style.display = "none";
}

function deleteRecurringItem(id) {
  showModal("Διαγραφή αυτού του παγίου;", true, (ok) => {
    if (!ok) return;
    data.recurring = data.recurring.filter(r => r.id !== id);
    recordEntityDeletion(id);
    persist();
    render();
    showToast("🗑️ Το πάγιο διαγράφηκε.");
  }, "Διαγραφή Παγίου");
}

function applyRecurringTransactionsForMonth(ym) {
  if (!ym || !Array.isArray(data.recurring)) return false;
  const [y, m] = ym.split("-").map(Number);
  const maxDay = new Date(y, m, 0).getDate();
  const split = getCoupleSplit();
  const matchedByRecId = matchRecurringItemsForMonth(ym, data.transactions, split);
  let added = false;

  data.recurring.forEach(r => {
    if (r.skippedMonths?.[ym]) return;
    if (matchedByRecId.has(r.id)) return;

    const dStr = String(Math.min(maxDay, Math.max(1, Number(r.day) || 1))).padStart(2, "0");
    const txDate = `${ym}-${dStr}`;
    if (txDate > today()) return;

    const isShared = split.hasPartner && r.type === "expense" && Boolean(r.isShared);
    const newId = generateId("tx");
    data.transactions.push({
      id: newId,
      owner: "me",
      type: r.type,
      category: r.category,
      amount: Number(r.amount),
      date: txDate,
      description: `${r.title} (Πάγιο)`,
      recurringId: r.id,
      isShared,
      paidBy: isShared ? "me" : undefined,
      settled: false,
      _updatedAt: Date.now()
    });
    markTxDirty(newId);
    added = true;
  });

  return added;
}

function getRecurringViewYearMonth() {
  const ctx = getActivePeriodContext();
  if (ctx.mode === "month" && /^\d{4}-\d{2}$/.test(ctx.key || "")) {
    return ctx.key;
  }
  return currentYearMonth();
}

function toggleSkipRecurringForMonth(id) {
  const r = (data.recurring || []).find(item => item.id === id);
  if (!r) return;
  const ym = getRecurringViewYearMonth();
  if (!r.skippedMonths || typeof r.skippedMonths !== "object") r.skippedMonths = {};

  if (r.skippedMonths[ym]) {
    delete r.skippedMonths[ym];
    data.settings.stateUpdatedAt = Date.now();
    applyRecurringTransactionsForMonth(ym);
    persist();
    render();
    showToast(`▶️ Το πάγιο «${r.title}» ενεργοποιήθηκε ξανά για τον μήνα ${ym}.`);
  } else {
    r.skippedMonths[ym] = true;
    data.settings.stateUpdatedAt = Date.now();
    persist();
    render();
    showToast(`⏸️ Το πάγιο «${r.title}» θα παραλειφθεί για τον μήνα ${ym}.`);
  }
}

function renderRecurringTable() {
  const tbody = document.getElementById("recurringTableBody");
  if (!tbody) return;
  const split = getCoupleSplit();
  const wrap = document.getElementById("recSharedWrap");
  if (wrap) wrap.style.display = split.hasPartner ? "flex" : "none";

  const ym = getRecurringViewYearMonth();
  setTextSafe("recurringMonthBadge", `📅 ${ym}`);

  const list = data.recurring || [];
  let sumExp = 0, sumInc = 0, sumSav = 0;
  list.forEach(r => {
    if (r.skippedMonths?.[ym]) return;
    const amt = Number(r.amount) || 0;
    if (r.type === "income") sumInc += amt;
    else if (r.type === "saving") sumSav += amt;
    else sumExp += amt;
  });

  const parts = [];
  if (sumExp > 0) parts.push(`Έξοδα: ${money(sumExp)}/μήνα`);
  if (sumInc > 0) parts.push(`Έσοδα: ${money(sumInc)}/μήνα`);
  if (sumSav > 0) parts.push(`Αποταμ.: ${money(sumSav)}/μήνα`);
  setTextSafe(
    "recurringSummaryLine",
    parts.length > 0 ? `Ενεργά (${ym}): ${parts.join(" • ")}` : "Καταχωρούνται αυτόματα κάθε μήνα"
  );

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="small">Δεν έχουν δηλωθεί πάγια έξοδα ή έσοδα.</td></tr>`;
    return;
  }

  const matchedMap = matchRecurringItemsForMonth(ym, data.transactions, split);

  tbody.innerHTML = list.map(r => {
    const isSkipped = Boolean(r.skippedMonths?.[ym]);
    const matchedTx = matchedMap.get(r.id);

    let statusHtml = "";
    if (isSkipped) {
      statusHtml = `<span class="badge">⏸️ Παραλείφθηκε</span>`;
    } else if (matchedTx) {
      const dShort = (matchedTx.date || "").length >= 10
        ? `${matchedTx.date.slice(8, 10)}/${matchedTx.date.slice(5, 7)}`
        : ym;
      statusHtml = `<span class="badge income">✅ Καταχωρήθηκε (${dShort})</span>`;
    } else {
      statusHtml = `<span class="badge withdrawal">⏳ Εκκρεμεί (${r.day || 1}η)</span>`;
    }

    const skipBtnTitle = isSkipped ? `Επαναφορά για ${ym}` : `Παράλειψη μόνο για ${ym}`;
    const skipBtnIcon = isSkipped ? "▶️" : "⏸️";

    return `
      <tr style="${isSkipped ? "opacity:0.55;" : ""}">
        <td><strong>${escapeHtml(r.title)}</strong> ${r.isShared ? '<span class="badge shared">👫 Κοινό</span>' : ""}</td>
        <td>${r.type === "income" ? "🟢 Έσοδο" : (r.type === "saving" ? "🔵 Αποταμ." : "🔴 Έξοδο")}</td>
        <td>${escapeHtml(r.category)}</td>
        <td>${r.day || 1}η</td>
        <td>${statusHtml}</td>
        <td style="text-align:right; font-weight:700;" class="privacy-sensitive">${money(r.amount)}</td>
        <td style="text-align:right; white-space:nowrap;">
          <button type="button" class="secondary small-btn" data-recid="${escapeHtml(r.id)}" data-click="toggleSkipRecurringForMonth" title="${escapeHtml(skipBtnTitle)}" aria-label="${escapeHtml(skipBtnTitle)}">${skipBtnIcon}</button>
          <button type="button" class="secondary small-btn" data-recid="${escapeHtml(r.id)}" data-click="editRecurringItem" aria-label="Επεξεργασία παγίου" title="Επεξεργασία">✏️</button>
          <button type="button" class="danger small-btn" data-recid="${escapeHtml(r.id)}" data-click="deleteRecurringItem" aria-label="Διαγραφή παγίου" title="Διαγραφή">🗑️</button>
        </td>
      </tr>
    `;
  }).join("");
}

function addGoal() {
  const title = document.getElementById("goalTitle").value.trim();
  const target = Number(document.getElementById("goalTarget").value);
  const saved = Math.max(0, Number(document.getElementById("goalSaved").value) || 0);
  const targetDate = document.getElementById("goalDate").value || "";

  if (!title || !target || target <= 0) return;
  data.goals.push({
    id: generateId("goal"),
    title,
    target,
    saved,
    targetDate
  });
  data.settings.stateUpdatedAt = Date.now();
  document.getElementById("goalTitle").value = "";
  document.getElementById("goalTarget").value = "";
  document.getElementById("goalSaved").value = "0";
  persist();
  render();
  showToast(`🐷 Ο κουμπαράς «${title}» δημιουργήθηκε!`);
}

function contributeGoal(goalId, delta) {
  const g = data.goals.find(x => x.id === goalId);
  if (!g) return;
  const actualDelta = delta < 0 ? -Math.min(Math.abs(delta), Number(g.saved) || 0) : delta;
  if (actualDelta === 0) return;

  g.saved = Number(((Number(g.saved) || 0) + actualDelta).toFixed(2));
  const txId = generateId("tx");
  data.transactions.push({
    id: txId,
    owner: "me",
    type: actualDelta > 0 ? "saving" : "withdrawal",
    category: "Κουμπαράς Στόχου",
    amount: Math.abs(actualDelta),
    date: today(),
    description: `${actualDelta > 0 ? "Κατάθεση σε" : "Ανάληψη από"} κουμπαρά: ${g.title}`,
    linkedGoalId: g.id,
    _updatedAt: Date.now()
  });
  markTxDirty(txId);
  data.settings.stateUpdatedAt = Date.now();
  persist();
  render();
  showToast(actualDelta > 0 ? `+${money(actualDelta)} στον στόχο «${g.title}»` : `-${money(Math.abs(actualDelta))} από τον στόχο «${g.title}»`);
}

function deleteGoal(goalId) {
  const g = (data.goals || []).find(item => item.id === goalId);
  if (!g) return;
  const savedAmt = Number(g.saved) || 0;
  const msg = savedAmt > 0
    ? `Διαγραφή του κουμπαρά «${g.title}»;\n\nΤα αποταμιευμένα ${money(savedAmt)} θα μεταφερθούν αυτόματα στο γενικό Αποθεματικό Ασφαλείας ώστε να μην χαθούν από την Καθαρή σου Θέση.`
    : `Διαγραφή του κουμπαρά «${g.title}»;`;

  showModal(msg, true, (ok) => {
    if (!ok) return;
    let movedFromTxs = 0;
    (data.transactions || []).forEach(t => {
      if (t.linkedGoalId === goalId) {
        if (t.type === "saving") movedFromTxs += Number(t.amount) || 0;
        else if (t.type === "withdrawal") movedFromTxs -= Number(t.amount) || 0;
        t.category = "Αποταμίευση";
        delete t.linkedGoalId;
        t._updatedAt = Date.now();
        markTxDirty(t.id);
      }
    });
    const unbackedSaved = Math.max(0, Number((savedAmt - Math.max(0, movedFromTxs)).toFixed(2)));
    if (unbackedSaved > 0) {
      data.profile.initialSavings = Number(((Number(data.profile.initialSavings) || 0) + unbackedSaved).toFixed(2));
    }

    data.goals = data.goals.filter(item => item.id !== goalId);
    recordEntityDeletion(goalId);
    persist();
    render();
    showToast("🗑️ Ο στόχος διαγράφηκε (τα χρήματα διατηρήθηκαν στο Αποθεματικό).");
  }, "Διαγραφή Στόχου");
}

function contributeGoalCustom(goalId) {
  const inp = document.getElementById(`goalCustomAmt_${goalId}`);
  const val = Number(inp?.value);
  if (!Number.isFinite(val) || val === 0) return;
  contributeGoal(goalId, val);
}

function renderGoals() {
  const grid = document.getElementById("goalsGrid");
  const badge = document.getElementById("goalsSummaryBadge");
  if (!grid) return;

  const goals = data.goals || [];
  if (badge) {
    if (goals.length > 0) {
      const totSaved = goals.reduce((s, g) => s + (Number(g.saved) || 0), 0);
      const totTarget = goals.reduce((s, g) => s + (Number(g.target) || 0), 0);
      badge.style.display = "inline-flex";
      badge.textContent = `${money(totSaved)} / ${money(totTarget)}`;
    } else {
      badge.style.display = "none";
    }
  }

  if (goals.length === 0) {
    grid.innerHTML = `<div class="small">Δεν υπάρχουν ενεργοί κουμπαράδες στόχων.</div>`;
    return;
  }

  const todayIso = today();
  grid.innerHTML = goals.map(g => {
    const saved = Number(g.saved) || 0;
    const target = Math.max(1, Number(g.target) || 1);
    const rem = Math.max(0, target - saved);
    const pct = Math.min(100, (saved / target) * 100);
    let monthlyHint = "";
    if (rem > 0 && g.targetDate && g.targetDate > todayIso) {
      const monthsLeft = Math.max(1, Math.round(daysBetweenIso(todayIso, g.targetDate) / 30));
      monthlyHint = ` • ~${money(rem / monthsLeft)}/μήνα`;
    } else if (rem <= 0) {
      monthlyHint = " • 🎉 Ολοκληρώθηκε!";
    }

    return `
      <div class="kpi-card">
        <div class="kpi-label">
          <strong>🐷 ${escapeHtml(g.title)}</strong>
          <button type="button" class="danger small-btn" data-gid="${escapeHtml(g.id)}" data-click="deleteGoal" aria-label="Διαγραφή στόχου">🗑️</button>
        </div>
        <div class="metric primary privacy-sensitive" style="font-size:18px;">${money(saved)} <span class="small">/ ${money(target)}</span></div>
        <div class="progress"><div style="width:${pct}%; background:var(--accent);"></div></div>
        <div class="small" style="margin:6px 0 10px;">Πρόοδος: ${pct.toFixed(0)}%${g.targetDate ? ` • Έως ${escapeHtml(g.targetDate)}` : ""}${monthlyHint}</div>
        <div style="display:flex; gap:5px; flex-wrap:wrap; align-items:center;">
          <button type="button" class="secondary small-btn" data-gid="${escapeHtml(g.id)}" data-click="contributeGoal" data-arg="20">+€20</button>
          <button type="button" class="secondary small-btn" data-gid="${escapeHtml(g.id)}" data-click="contributeGoal" data-arg="50">+€50</button>
          <button type="button" class="secondary small-btn" data-gid="${escapeHtml(g.id)}" data-click="contributeGoal" data-arg="-20">-€20</button>
          <input type="number" id="goalCustomAmt_${escapeHtml(g.id)}" step="1" placeholder="€" aria-label="Άλλο ποσό" style="width:66px; padding:4px 6px; font-size:12px;" />
          <button type="button" class="accent small-btn" data-gid="${escapeHtml(g.id)}" data-click="contributeGoalCustom" title="Κατάθεση/Ανάληψη ποσού">+</button>
        </div>
      </div>
    `;
  }).join("");
}

function saveAnnualBill() {
  const editId = document.getElementById("editingAnnualBillId").value;
  const title = document.getElementById("annualTitle").value.trim();
  const amount = Number(document.getElementById("annualAmount").value);
  const dueDate = document.getElementById("annualDueDate").value;
  const category = document.getElementById("annualCategory").value || "Λογαριασμοί";

  if (!title || !amount || amount <= 0 || !dueDate) return;

  if (editId) {
    const idx = data.annualBills.findIndex(b => b.id === editId);
    if (idx !== -1) {
      data.annualBills[idx] = { ...data.annualBills[idx], title, amount, dueDate, category };
    }
  } else {
    data.annualBills.push({
      id: generateId("abill"),
      title,
      amount,
      saved: 0,
      dueDate,
      category
    });
  }

  data.settings.stateUpdatedAt = Date.now();
  cancelAnnualBillEditor();
  persist();
  render();
  showToast("📅 Η ετήσια υποχρέωση αποθηκεύτηκε!");
}

function editAnnualBill(id) {
  const b = data.annualBills.find(x => x.id === id);
  if (!b) return;
  document.getElementById("editingAnnualBillId").value = b.id;
  document.getElementById("annualTitle").value = b.title;
  document.getElementById("annualAmount").value = b.amount;
  document.getElementById("annualDueDate").value = b.dueDate;
  document.getElementById("annualCategory").value = b.category;
  setTextSafe("saveAnnualBillBtn", "💾 Αποθήκευση");
  document.getElementById("cancelAnnualBillBtn").style.display = "inline-flex";
}

function cancelAnnualBillEditor() {
  document.getElementById("editingAnnualBillId").value = "";
  document.getElementById("annualTitle").value = "";
  document.getElementById("annualAmount").value = "";
  setTextSafe("saveAnnualBillBtn", "➕ Προσθήκη");
  document.getElementById("cancelAnnualBillBtn").style.display = "none";
}

function reserveForAnnualBill(billId, delta) {
  const b = data.annualBills.find(x => x.id === billId);
  if (!b) return;
  const actualDelta = delta < 0 ? -Math.min(Math.abs(delta), Number(b.saved) || 0) : delta;
  if (actualDelta === 0) return;

  b.saved = Number(((Number(b.saved) || 0) + actualDelta).toFixed(2));
  const txId = generateId("tx");
  data.transactions.push({
    id: txId,
    owner: "me",
    type: actualDelta > 0 ? "saving" : "withdrawal",
    category: "Αποταμίευση",
    amount: Math.abs(actualDelta),
    date: today(),
    description: `Δέσμευση ετήσιας υποχρέωσης: ${b.title}`,
    linkedAnnualBillId: b.id,
    _updatedAt: Date.now()
  });
  markTxDirty(txId);
  data.settings.stateUpdatedAt = Date.now();
  persist();
  render();
  showToast(`Δεσμεύτηκαν ${money(actualDelta)} για «${b.title}»`);
}

function advanceDueDateToFuture(dueDateIso, referenceIso) {
  const d = parseIsoDate(dueDateIso);
  if (!d) return dueDateIso;
  const dueDay = d.getDate();
  let nextIso = dueDateIso;
  let guard = 0;
  while (nextIso <= referenceIso && guard < 20) {
    d.setDate(1);
    d.setFullYear(d.getFullYear() + 1);
    d.setDate(Math.min(dueDay, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
    nextIso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    guard++;
  }
  return nextIso;
}

function payAnnualBill(billId) {
  const b = data.annualBills.find(x => x.id === billId);
  if (!b) return;
  showModal(`Καταχώριση πληρωμής «${b.title}» (${money(b.amount)}); Αν είχες δεσμεύσει χρήματα στην άκρη, θα αποδεσμευτούν αυτόματα ώστε να μην επιβαρυνθεί διπλά το ταμείο.`, true, (ok) => {
    if (!ok) return;
    const dateIso = today();
    const nowTs = Date.now();

    if ((Number(b.saved) || 0) > 0) {
      const wId = generateId("tx");
      data.transactions.push({
        id: wId,
        owner: "me",
        type: "withdrawal",
        category: "Αποταμίευση",
        amount: Number(b.saved),
        date: dateIso,
        description: `Αποδέσμευση αποθεματικού: ${b.title}`,
        linkedAnnualBillId: b.id,
        _updatedAt: nowTs
      });
      markTxDirty(wId);
    }

    const expId = generateId("tx");
    data.transactions.push({
      id: expId,
      owner: "me",
      type: "expense",
      category: b.category || "Λογαριασμοί",
      amount: Number(b.amount),
      date: dateIso,
      description: `${b.title} (Ετήσιο)`,
      _updatedAt: nowTs
    });
    markTxDirty(expId);

    b.saved = 0;
    b.dueDate = advanceDueDateToFuture(b.dueDate, dateIso);
    data.settings.stateUpdatedAt = nowTs;
    persist();
    render();
    showToast(`✅ Η υποχρέωση «${b.title}» εξοφλήθηκε!`);
  }, "Πληρωμή Ετήσιας Υποχρέωσης");
}

function deleteAnnualBill(billId) {
  showModal("Διαγραφή αυτής της ετήσιας υποχρέωσης;", true, (ok) => {
    if (!ok) return;
    data.annualBills = data.annualBills.filter(b => b.id !== billId);
    recordEntityDeletion(billId);
    persist();
    render();
  }, "Διαγραφή Υποχρέωσης");
}

function renderAnnualBills() {
  const grid = document.getElementById("annualBillsGrid");
  const badge = document.getElementById("annualBillsSummaryBadge");
  if (!grid) return;

  const bills = data.annualBills || [];
  if (badge) {
    if (bills.length > 0) {
      const totAnnual = bills.reduce((s, b) => s + (Number(b.amount) || 0), 0);
      const totSaved = bills.reduce((s, b) => s + (Number(b.saved) || 0), 0);
      badge.style.display = "inline-flex";
      badge.textContent = `${money(totSaved)} / ${money(totAnnual)} (~${money(totAnnual / 12)}/μήνα)`;
    } else {
      badge.style.display = "none";
    }
  }

  if (bills.length === 0) {
    grid.innerHTML = `<div class="small">Δεν υπάρχουν καταχωρισμένες ετήσιες υποχρεώσεις.</div>`;
    return;
  }

  const todayIso = today();
  grid.innerHTML = bills.map(b => {
    const pct = Math.min(100, ((Number(b.saved) || 0) / Math.max(1, Number(b.amount) || 1)) * 100);
    const rem = Math.max(0, (Number(b.amount) || 0) - (Number(b.saved) || 0));
    const isOverdue = b.dueDate && b.dueDate < todayIso;
    const monthsLeft = isOverdue ? 0 : Math.max(1, Math.round(daysBetweenIso(todayIso, b.dueDate) / 30));
    const monthlyNeed = isOverdue ? rem : (rem / monthsLeft);

    return `
      <div class="kpi-card">
        <div class="kpi-label">
          <strong>📅 ${escapeHtml(b.title)}</strong>
          <div>
            <button type="button" class="secondary small-btn" data-bid="${escapeHtml(b.id)}" data-click="editAnnualBill" aria-label="Επεξεργασία">✏️</button>
            <button type="button" class="danger small-btn" data-bid="${escapeHtml(b.id)}" data-click="deleteAnnualBill" aria-label="Διαγραφή">🗑️</button>
          </div>
        </div>
        <div class="metric privacy-sensitive" style="font-size:18px;">${money(b.saved)} <span class="small">/ ${money(b.amount)}</span></div>
        <div class="progress"><div style="width:${pct}%; background:${isOverdue ? "var(--danger)" : "var(--warn)"};"></div></div>
        <div class="small" style="margin:6px 0 10px; ${isOverdue ? "color:var(--danger); font-weight:700;" : ""}">
          ${isOverdue ? `⚠️ Έληξε (${escapeHtml(b.dueDate)}) • Υπόλοιπο: ${money(rem)}` : `Λήξη: ${escapeHtml(b.dueDate)} • ~${money(monthlyNeed)}/μήνα`}
        </div>
        <div style="display:flex; gap:6px; flex-wrap:wrap;">
          <button type="button" class="secondary small-btn" data-bid="${escapeHtml(b.id)}" data-click="reserveForAnnualBill" data-arg="25">+€25</button>
          <button type="button" class="secondary small-btn" data-bid="${escapeHtml(b.id)}" data-click="reserveForAnnualBill" data-arg="50">+€50</button>
          <button type="button" class="accent small-btn" data-bid="${escapeHtml(b.id)}" data-click="payAnnualBill">✅ Πληρώθηκε</button>
        </div>
      </div>
    `;
  }).join("");
}
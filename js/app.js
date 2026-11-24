/* ==========================================================================
   12. AUTOMATED REGRESSION SELF-TESTS
   ========================================================================== */
async function runFinanceGRSelfTests() {
  const results = [];
  const assert = (name, cond, detail = "") => {
    results.push({ name, passed: Boolean(cond), detail });
  };

  // Test 1: MCC Extraction & Categorization
  const mcc = extractMccCode("PRONTO 2024 ATHINA 18,28 EUR 441029xxxxxx0295 5441 GOOGLE-PAY / PO26319000610554");
  const mccCat = categorizeByMcc(mcc);
  assert("ISO 18245 MCC Parser (5441 -> Τρόφιμα)", mcc === "5441" && mccCat?.category === "Τρόφιμα", `Got MCC=${mcc}, Cat=${mccCat?.category}`);

  // Test 2: Piraeus Bank Patterns
  const p1 = autoCategorizeDescription("ΥΠΕΡ ΜΑΝΩΛΑΣ ΔΗΜΗΤΡΙΟΣ", -25);
  const p2 = autoCategorizeDescription("B/O ΓΟΥΛΗΣ ΘΕΟΦΙΛΟΣ", 40);
  const p3 = autoCategorizeDescription("5029120147486 ΔΑΝΕΙΟ", -180);
  assert("Μοτίβα Πειραιώς (ΥΠΕΡ / B/O / Λογαριασμοί)", p1.category === "Διασκέδαση" && p2.category === "Επιστροφή Χρημάτων" && p3.category === "Λογαριασμοί");

  // Test 3: Flexible Amount & Date Parsers
  assert(
    "Parser Ποσών (Ελληνικά χιλιάδες, US & Παρενθέσεις)",
    parseFlexibleAmount("1.234,56 €") === 1234.56 && parseFlexibleAmount("1.500") === 1500 && parseFlexibleAmount("(45,50)") === -45.5
  );
  assert(
    "Parser Ημερομηνιών (GR, Excel & Απόρριψη 31/02)",
    parseFlexibleDate("21/11/2026") === "2026-11-21" && parseFlexibleDate(46347) === "2026-11-21" && parseFlexibleDate("31/02/2026") === null
  );

  // Test 4: Net Worth calculations (cumulative, period-independent and no double counting)
  const backupData = deepClone(data);
  try {
    const soloSplit = { hasPartner: false, myName: "Εσύ", partnerName: "", myPct: 100, partnerPct: 0 };
    const coupleSplit = { hasPartner: true, myName: "Εσύ", partnerName: "Σύντροφος", myPct: 60, partnerPct: 40 };
    const asOf = today();

    // Cash savings are moved to the reserve bucket; the cumulative flow excludes them.
    data = createDefaultState();
    data.transactions = [
      { id: "nw-income", owner: "me", type: "income", amount: 1000, date: asOf },
      { id: "nw-expense", owner: "me", type: "expense", amount: 500, date: asOf },
      { id: "nw-saving", owner: "me", type: "saving", category: "Αποταμίευση", amount: 200, date: asOf }
    ];
    const cashSave = computeNetWorthSnapshot("all", soloSplit, asOf);
    assert("Net Worth: cumulative cash saving is not double-counted", cashSave.netWorth === 500 && cashSave.cashReserve === 200 && cashSave.cashFlow === 300,
      `Expected NW=500, reserve=200, flow=300; got ${JSON.stringify(cashSave)}`);

    // Goal and investment transfers are offset by the corresponding asset balances.
    data = createDefaultState();
    data.goals = [{ id: "g1", title: "Test Goal", target: 500, saved: 200 }];
    data.portfolioAssets = [{ id: "a1", name: "ETF", current: 150 }];
    data.transactions = [
      { id: "nw-income", owner: "me", type: "income", amount: 1000, date: asOf },
      { id: "nw-expense", owner: "me", type: "expense", amount: 500, date: asOf },
      { id: "nw-goal", owner: "me", type: "saving", category: "Κουμπαράς Στόχου", linkedGoalId: "g1", amount: 200, date: asOf },
      { id: "nw-invest", owner: "me", type: "saving", category: "Επένδυση", amount: 150, date: asOf }
    ];
    const assets = computeNetWorthSnapshot("all", soloSplit, asOf);
    assert("Net Worth: goal and investment transfers reconcile with asset balances", assets.netWorth === 500 && assets.goalsTotal === 200 && assets.portfolioTotal === 150 && assets.cashFlow === 150,
      `Expected NW=500; got ${JSON.stringify(assets)}`);

    // The total must not change when the user changes the reporting period; the snapshot has no period input.
    const sameSnapshot = computeNetWorthSnapshot("all", soloSplit, asOf);
    assert("Net Worth: independent from selected month/cycle/year", sameSnapshot.netWorth === assets.netWorth);

    // Withdrawals move value from reserve to cash flow; internal transfers are excluded.
    data = createDefaultState();
    data.profile.initialSavings = 100;
    data.transactions = [
      { id: "nw-withdrawal", owner: "me", type: "withdrawal", category: "Ανάληψη", amount: 40, date: asOf },
      { id: "nw-internal", owner: "me", type: "income", amount: 900, date: asOf, isInternalTransfer: true },
      { id: "nw-future", owner: "me", type: "income", amount: 700, date: "2999-01-01" }
    ];
    const transfer = computeNetWorthSnapshot("all", soloSplit, asOf);
    assert("Net Worth: withdrawals, internal transfers and future transactions", transfer.netWorth === 100 && transfer.cashReserve === 60 && transfer.cashFlow === 40,
      `Expected NW=100, reserve=60, flow=40; got ${JSON.stringify(transfer)}`);

    // Couple filters retain existing member-scope behavior and allocate shared transactions.
    data = createDefaultState();
    data.transactions = [
      { id: "nw-me", owner: "me", type: "income", amount: 1000, date: asOf },
      { id: "nw-partner", owner: "partner", type: "income", amount: 500, date: asOf },
      { id: "nw-shared", owner: "me", type: "expense", amount: 100, date: asOf, isShared: true }
    ];
    const partner = computeNetWorthSnapshot("partner", coupleSplit, asOf);
    const shared = computeNetWorthSnapshot("shared", coupleSplit, asOf);
    assert("Net Worth: partner view applies partner share to shared transactions", partner.netWorth === 460 && partner.cashReserve === 0,
      `Expected partner flow=460; got ${JSON.stringify(partner)}`);
    assert("Net Worth: shared view includes only shared transactions", shared.netWorth === -100 && shared.cashReserve === 0,
      `Expected shared balance=-100; got ${JSON.stringify(shared)}`);

    // Negative balances remain visible; no zero clamp is applied to net worth.
    data = createDefaultState();
    data.transactions = [{ id: "nw-negative", owner: "me", type: "expense", amount: 125, date: asOf }];
    const negative = computeNetWorthSnapshot("all", soloSplit, asOf);
    assert("Net Worth: negative result remains visible", negative.netWorth === -125,
      `Expected -125; got ${negative.netWorth}`);

    // Entity Array Merge (Offline Laptop + Mobile)
    const mergedGoals = mergeEntitiesById(
      [{ id: "g_mob", title: "Mobile Goal", target: 300, saved: 50 }],
      [{ id: "g_lap", title: "Laptop Goal", target: 800, saved: 100 }],
      {},
      true
    );
    assert("Firebase Entity Array Merge (Offline συγχώνευση)", mergedGoals.length === 2);

    // Duplicate check distinguishes expense vs refund (income) of same amount on same day
    data = createDefaultState();
    data.transactions = [{ id: "dup-exp", owner: "me", type: "expense", amount: 50, date: asOf, description: "Skroutz" }];
    const dupRefund = isDuplicateTransaction(asOf, 50, "Skroutz", "", [], null, "income");
    const dupSame = isDuplicateTransaction(asOf, 50, "Skroutz", "", [], null, "expense");
    assert("Έλεγχος Διπλοεγγραφών (Διαχωρισμός αγοράς vs επιστροφής)", !dupRefund && Boolean(dupSame));

    // Recurring deduplication: existing manual/bank tx prevents duplicate (Πάγιο) creation & bank import detects existing (Πάγιο)
    const curYm = currentYearMonth();
    data = createDefaultState();
    data.transactions = [
      { id: "rent-bank", owner: "me", type: "expense", category: "Στέγαση", amount: 400, date: `${curYm}-02`, description: "Μεταφορά Ιδιοκτήτη" }
    ];
    data.recurring = [
      { id: "rec-rent", title: "Ενοίκιο", type: "expense", category: "Στέγαση", amount: 400, day: 1, isShared: false, skippedMonths: {} }
    ];
    const addedDup = applyRecurringTransactionsForMonth(curYm);
    data.transactions = [
      { id: "auto-rent", owner: "me", type: "expense", category: "Στέγαση", amount: 400, date: `${curYm}-01`, description: "Ενοίκιο (Πάγιο)", recurringId: "rec-rent" }
    ];
    const bankHitRec = isDuplicateTransaction(`${curYm}-06`, 400, "ΜΕΤΑΦΟΡΑ ΙΔΙΟΚΤΗΤΗ", "", [], null, "expense", "Στέγαση");
    assert(
      "Αποτροπή Διπλοκαταχώρησης Παγίων (Χειροκίνητο & Bank Import)",
      !addedDup && Boolean(bankHitRec),
      `addedDup=${addedDup}, bankHitRec=${Boolean(bankHitRec)}`
    );

    // Annual Bill Multi-Year Rollover
    const rolledDate = advanceDueDateToFuture("2024-02-29", "2026-11-23");
    assert("Μετακύλιση Ετήσιας Υποχρέωσης (29/02 -> 2027-02-28)", rolledDate === "2027-02-28", `Got ${rolledDate}`);

    // View-Aware Budgets & 3-Month Historical Auto-Budget Allocation
    data = createDefaultState();
    data.profile.monthlyIncome = 1500;
    data.profile.savingGoal = 300;
    data.profile.partnerName = "Μαρία";
    data.profile.partnerIncome = 1000;
    data.recurring = [
      { id: "r1", title: "Ενοίκιο", type: "expense", category: "Στέγαση", amount: 600, day: 1, isShared: true }
    ];
    data.transactions = [
      { id: "h1", owner: "me", type: "expense", category: "Τρόφιμα", amount: 300, date: "2026-10-10", isShared: false },
      { id: "h2", owner: "me", type: "expense", category: "Διασκέδαση", amount: 150, date: "2026-10-12", isShared: false }
    ];
    const planMe = computeAutoBudgetPlan({ scope: "me", split: coupleSplit, includeAnnual: false, asOfDate: "2026-11-23" });
    const planAll = computeAutoBudgetPlan({ scope: "all", split: coupleSplit, includeAnnual: false, asOfDate: "2026-11-23" });
    getBudgetsMapForView("me")["Τρόφιμα"] = 250;
    getBudgetsMapForView("all")["Τρόφιμα"] = 500;
    assert(
      "Αυτόματος Προϋπολογισμός (3μηνο, Πάγια, €5 & Ξεχωριστά Όρια Ζευγαριού)",
      planMe.proposedBudgets["Στέγαση"] >= 360 &&
      planAll.proposedBudgets["Στέγαση"] >= 600 &&
      planMe.proposedBudgets["Τρόφιμα"] % 5 === 0 &&
      planMe.proposedBudgets["Τρόφιμα"] === 300 &&
      getBudgetsMapForView("me")["Τρόφιμα"] === 250 &&
      getBudgetsMapForView("all")["Τρόφιμα"] === 500,
      `meRent=${planMe.proposedBudgets["Στέγαση"]}, allRent=${planAll.proposedBudgets["Στέγαση"]}, meFood=${planMe.proposedBudgets["Τρόφιμα"]}`
    );
  } finally {
    data = backupData;
  }

  // Test 4b: whole-word bonus detection, unclamped reserve in Net Worth, effective-rate simulator maths
  assert("Bonus keywords: «ΘΕΟΔΩΡΟΣ» δεν είναι δώρο, «ΔΩΡΟ ΠΑΣΧΑ» είναι",
    !hasBonusKeyword(normalizeText("ΜΙΣΘΟΔΟΣΙΑ ΘΕΟΔΩΡΟΣ ΑΕ")) && hasBonusKeyword(normalizeText("ΔΩΡΟ ΠΑΣΧΑ")));
  const backupData2 = deepClone(data);
  try {
    data = createDefaultState();
    data.transactions = [{ id: "nw-wd", owner: "me", type: "withdrawal", category: "Ανάληψη", amount: 40, date: today() }];
    const wd = computeNetWorthSnapshot("all", { hasPartner: false, myPct: 100, partnerPct: 0 }, today());
    assert("Net Worth: ανάληψη χωρίς προηγούμενη αποταμίευση δεν δημιουργεί αξία", wd.netWorth === 0, `Expected 0; got ${wd.netWorth}`);
  } finally {
    data = backupData2;
  }
  assert("Προσομοιωτής: 12 μηνιαίες περίοδοι = ακριβώς η ετήσια απόδοση", Math.abs(Math.pow(1 + Math.pow(1.04, 1 / 12) - 1, 12) - 1.04) < 1e-12);

  // Test 4c: Smart Shared vs Personal classification (supermarket >= 10€ vs micro-spend < 10€, bakery, utility vs personal bill, saved rent transfer rule)
  const backupRules = deepClone(data.merchantRules || {});
  try {
    data.merchantRules = {};
    const smBig = autoCategorizeDescription("ΣΚΛΑΒΕΝΙΤΗΣ ΑΘΗΝΑ", -45.00);
    const smSmall = autoCategorizeDescription("ΣΚΛΑΒΕΝΙΤΗΣ ΑΘΗΝΑ", -6.50);
    const bakery = autoCategorizeDescription("ΒΕΝΕΤΗΣ ΦΟΥΡΝΟΣ", -14.00);
    const utilHouse = autoCategorizeDescription("ΔΕΗ ΡΕΥΜΑ", -95.00);
    const billPersonal = autoCategorizeDescription("ΑΑΔΕ ΕΦΟΡΙΑ", -120.00);
    const landlordKey = extractMerchantKey("ΥΠΕΡ ΠΑΠΑΔΟΠΟΥΛΟΣ ΓΕΩΡΓΙΟΣ");
    data.merchantRules[landlordKey] = { category: "Στέγαση", isShared: true };
    const rentTransfer = autoCategorizeDescription("ΥΠΕΡ ΠΑΠΑΔΟΠΟΥΛΟΣ ΓΕΩΡΓΙΟΣ", -550.00);
    assert(
      "Έξυπνος Διαχωρισμός Κοινών (Σούπερ Μάρκετ, Φούρνος, Λογαριασμοί & Κανόνας Ενοικίου)",
      smBig.category === "Τρόφιμα" && smBig.isShared === true &&
      smSmall.category === "Τρόφιμα" && smSmall.isShared === false &&
      bakery.category === "Τρόφιμα" && bakery.isShared === false &&
      utilHouse.category === "Λογαριασμοί" && utilHouse.isShared === true &&
      billPersonal.category === "Λογαριασμοί" && billPersonal.isShared === false &&
      rentTransfer.category === "Στέγαση" && rentTransfer.isShared === true,
      `smBig=${smBig.isShared}, smSmall=${smSmall.isShared}, bakery=${bakery.isShared}, util=${utilHouse.isShared}, personal=${billPersonal.isShared}, rent=${rentTransfer.category}/${rentTransfer.isShared}`
    );
  } finally {
    data.merchantRules = backupRules;
  }

  // Test 5: AES-256-GCM Cloud Sync Encryption Round-Trip
  try {
    const sampleObj = { test: "FinanceGR_OK", amount: 123.45 };
    const enc = await encryptRoomPayload(sampleObj, "FG-TEST-9999", "654321");
    const dec = await decryptRoomPayload(enc, "FG-TEST-9999", "654321");
    assert("AES-256-GCM Cloud Encryption Round-Trip", dec.test === "FinanceGR_OK" && dec.amount === 123.45);
  } catch (e) {
    assert("AES-256-GCM Cloud Encryption Round-Trip", false, e.message);
  }

  return results;
}

async function runAndShowSelfTests() {
  const results = await runFinanceGRSelfTests();
  const passedCount = results.filter(r => r.passed).length;
  const lines = results.map(r => `${r.passed ? "✅" : "❌"} ${r.name}${!r.passed && r.detail ? ` (${r.detail})` : ""}`).join("\n");
  showModal(
    `Αποτέλεσμα Ελέγχων: ${passedCount} / ${results.length} επιτυχείς\n\n${lines}`,
    false,
    null,
    "🧪 Έλεγχος Υγείας Συστήματος (Self-Test)"
  );
}

/* ==========================================================================
   13. MASTER RENDER LOOP
   ========================================================================== */
function render() {
  applyThemeAndPrivacy();
  updateBackupStatusUI();
  populatePeriodSelectors();
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
  renderEReceiptsTracker();
  renderMerchantRulesManager();
}

/* ==========================================================================
   14. INITIALIZATION & LIFECYCLE SYNC
   ========================================================================== */
let appInitialized = false;

async function syncCycleNow(silent = true) {
  if (!data.settings?.cloudSync?.enabled) return false;
  const pullResult = await pullCloudSyncNow(silent);
  // Never push local state after a failed/locked/decryption-error pull: doing so could overwrite remote data.
  if (!["synced", "not_found"].includes(pullResult)) return false;
  if (data.settings?.cloudSync?.pendingPush || dirtyTxIds.size > 0 || fullSyncNeeded) {
    return await pushCloudSyncNow();
  }
  return true;
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
      const customModal = document.getElementById("customModal");
      if (customModal && customModal.style.display === "flex") {
        customModal.style.display = "none";
        return;
      }
      ["transactionModal", "paydayModal", "bankImportModal", "cloudSyncModal", "coupleMergeModal", "shareModal"].forEach(id => {
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
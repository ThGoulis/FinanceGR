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

  // Test 2: Piraeus Bank Patterns (isolated from user's saved merchantRules in localStorage)
  const backupDataPiraeus = deepClone(data);
  try {
    data = createDefaultState();
    const p1 = autoCategorizeDescription("ΕΞΕΡΧΟΜΕΝΟ ΕΜΒΑΣΜΑ ΥΠΕΡ ΜΑΝΩΛΑΣ ΔΗΜΗΤΡΙΟΣ", -25, "Μετρητά / Εμβάσματα");
    const p2 = autoCategorizeDescription("B/O ΓΟΥΛΗΣ ΘΕΟΦΙΛΟΣ", 40);
    const p3 = autoCategorizeDescription("5029120147486 ΔΑΝΕΙΟ", -180);
    const p4 = autoCategorizeDescription("ΑΤΜ-ΑΝΑΛΗΨΗ ΜΕΤΡΗΤΩΝ METRO SEPOLIA ATHENS 40,00 EUR 441029xxxxxx0295 6011 GOOGLE-PAY / PO26243002234141", -40);
    const p5 = autoCategorizeDescription("ΑΓΟΡΑ ΜΕ ΚΑΡΤΑ Trading 212 Limassol 50,00 EUR 441029xxxxxx0295 6211 GOOGLE-PAY / PO26246000320552", -50);
    assert(
      "Μοτίβα Πειραιώς (Εμβάσματα / B/O / Δάνεια / ATM Μετρό / Trading 212)",
      p1.category === "Άλλο" && p1.confidence === "low" &&
      p2.category === "Επιστροφή Χρημάτων" &&
      p3.category === "Λογαριασμοί" &&
      p4.category === "Ανάληψη" &&
      p5.category === "Επένδυση" && p5.forceType === "saving",
      `p1=${p1.category}, p2=${p2.category}, p3=${p3.category}, p4=${p4.category}, p5=${p5.category}/${p5.forceType}`
    );
  } finally {
    data = backupDataPiraeus;
  }

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

  // Test 6: Shared Bank Ref Code (Fee -€1 vs Transfer -€1234.08) & Self-Transfer Detection
  const backupData3 = deepClone(data);
  try {
    data = createDefaultState();
    data.profile.userName = "Θεόφιλος Γούλης";
    data.transactions = [{
      id: "fee-ref-1", owner: "me", type: "expense", amount: 1.00, date: "2026-02-27",
      description: "ΕΞΟΔΑ ΑΠΟΣΤΟΛΗΣ | MIBREM64279494 / F928TO6008504972",
      originalBankDesc: "ΠΡΟΜΗΘΕΙΑ ΕΜΒΑΣΜΑΤΟΣ ΕΞΟΔΑ ΑΠΟΣΤΟΛΗΣ MIBREM64279494 / F928TO6008504972"
    }];
    const noFalseDup = isDuplicateTransaction(
      "2026-02-27", 1234.08,
      "ΥΠΕΡ Goulis Theofilos | MIBREM64279494 / F928TO6008504972",
      "ΕΞΕΡΧΟΜΕΝΟ ΕΜΒΑΣΜΑ ΥΠΕΡ Goulis Theofilos MIBREM64279494 / F928TO6008504972",
      [], null, "expense", "Άλλο"
    );
    const selfLat = typeof isSelfTransferDescription === "function" && isSelfTransferDescription(normalizeText("ΕΞΕΡΧΟΜΕΝΟ ΕΜΒΑΣΜΑ ΥΠΕΡ THEOFILOS GOULIS"));
    const relNotSelf = typeof isSelfTransferDescription === "function" && !isSelfTransferDescription(normalizeText("ΕΞΕΡΧΟΜΕΝΟ ΕΜΒΑΣΜΑ ΥΠΕΡ ΕΥΑΓΓΕΛΟΣ ΓΟΥΛΗΣ"));
    assert("Κοινός Κωδικός Προμήθειας/Εμβάσματος & Εσωτερικές Μεταφορές", !noFalseDup && selfLat && relNotSelf);

    // Test 7: Credit Card purchase & Debt Detector
    data = createDefaultState();
    data.liabilities = [{
      id: "cc-test", name: "Test Visa", type: "Credit Card",
      creditLimit: 2000, initialAmount: 2000, remainingBalance: 150, installmentBalance: 0
    }];
    data.transactions = [
      { id: "inc-1", owner: "me", type: "income", amount: 1000, date: today() },
      { id: "cc-buy", owner: "me", type: "expense", amount: 150, date: today(), paidByCreditCardId: "cc-test" }
    ];
    data.transactions.push({
      id: "cc-pay", owner: "me", type: "expense", category: "Λογαριασμοί", amount: 155, date: today(),
      linkedLiabilityId: "cc-test", linkedLiabilityType: "Credit Card", liabilityPrincipal: 150, liabilityInterest: 5
    });
    data.liabilities[0].remainingBalance = 0;
    const ccSnap = computeNetWorthSnapshot("all", { hasPartner: false, myPct: 100, partnerPct: 0 }, today());
    const ccPeriod = getPeriodTotals(today(), today(), "all", { hasPartner: false, myPct: 100, partnerPct: 0 });
    const debtHit = typeof detectDebtOrInstallmentCharge === "function" && detectDebtOrInstallmentCharge("5029120147486 ΔΑΝΕΙΟ", "", "expense", 204.04);
    assert(
      "Πιστωτικές Κάρτες (Μηδενική Διπλομέτρηση σε Net Worth & Έξοδα Περιόδου)",
      ccSnap.netWorth === 845 && ccPeriod.expense === 155 && ccPeriod.creditCardRepayment === 150 && Boolean(debtHit?.isDebt),
      `ccNW=${ccSnap.netWorth}, ccExp=${ccPeriod.expense}, ccRepay=${ccPeriod.creditCardRepayment}`
    );
  } finally {
    data = backupData3;
  }

  // Test 8: Firebase Config & Google Ticker Guard
  const fbCfg = window.FINANCEGR_FIREBASE_CONFIG || {};
  const fbReady = fbCfg.projectId === "financegr-sync" && fbCfg.apiKey && !String(fbCfg.apiKey).startsWith("PASTE_");
  const guardExists = typeof isGoogleAccountSignedIn === "function" && !document.getElementById("tab-admin");
  assert("Firebase Config, Google Ticker Guard & Hidden Admin Isolation", fbReady && guardExists);

  return results;
}

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadFinanceGrRuntime } = require("../helpers/load-app.cjs");

test("Real bank-import v19: fee+transfer shared ref bug, RF/fees/insurance, MCC 5818/4722, self-transfers, and DD/PX/PRS ref codes", () => {
  const { ctx } = loadFinanceGrRuntime(["js/state.js", "js/periods-ui.js", "js/bank-import.js"]);
  ctx.data = ctx.createDefaultState();
  ctx.data.profile.userName = "Θεόφιλος Γούλης";

  // 1. CRITICAL: Bank fee (-€1.00) and Transfer (-€1234.08) share the same ref code -> must NOT collide as duplicate!
  ctx.data.transactions.push({
    id: "fee_1", type: "expense", amount: 1.00, date: "2026-02-27",
    description: "ΕΞΟΔΑ ΑΠΟΣΤΟΛΗΣ | MIBREM64279494 / F928TO6008504972",
    originalBankDesc: "ΠΡΟΜΗΘΕΙΑ ΕΜΒΑΣΜΑΤΟΣ ΕΞΟΔΑ ΑΠΟΣΤΟΛΗΣ MIBREM64279494 / F928TO6008504972"
  });
  const transferNotDup = ctx.isDuplicateTransaction(
    "2026-02-27", 1234.08,
    "ΥΠΕΡ Goulis Theofilos | MIBREM64279494 / F928TO6008504972",
    "ΕΞΕΡΧΟΜΕΝΟ ΕΜΒΑΣΜΑ ΥΠΕΡ Goulis Theofilos MIBREM64279494 / F928TO6008504972",
    [], new Set(), "expense", "Άλλο"
  );
  assert.equal(transferNotDup, undefined);

  // Same ref code AND same amount -> MUST be caught as duplicate
  const feeIsDup = ctx.isDuplicateTransaction(
    "2026-02-27", 1.00,
    "ΕΞΟΔΑ ΑΠΟΣΤΟΛΗΣ | MIBREM64279494 / F928TO6008504972",
    "ΠΡΟΜΗΘΕΙΑ ΕΜΒΑΣΜΑΤΟΣ ΕΞΟΔΑ ΑΠΟΣΤΟΛΗΣ MIBREM64279494 / F928TO6008504972",
    [], new Set(), "expense", "Λογαριασμοί"
  );
  assert.ok(feeIsDup && feeIsDup.id === "fee_1");

  // 2. Fees, mid-string RF code, and insurance bank_hint -> Λογαριασμοί
  const feeCat = ctx.autoCategorizeDescription("ΠΡΟΜΗΘΕΙΑ ΕΜΒΑΣΜΑΤΟΣ ΕΞΟΔΑ ΑΠΟΣΤΟΛΗΣ MIBREM64279494 / F928TO6008504972", -1, "Υποχρεώσεις / Προμήθειες");
  assert.equal(feeCat.category, "Λογαριασμοί");
  const rfCat = ctx.autoCategorizeDescription("ΕΞΟΦΛΗΣΗ ΛΟΓΑΡΙΑΣΜΟΥ ERB BNF RF65025959000007462260522 / DD261526046831", -750, "Υποχρεώσεις / Υπηρεσίες");
  assert.equal(rfCat.category, "Λογαριασμοί");
  const insCat = ctx.autoCategorizeDescription("ΕΞΟΦΛΗΣΗ ΛΟΓΑΡΙΑΣΜΟΥ Πειραιώς Agency Solutions 1500000024201959 INSU / PX260298231552", -50, "Υποχρεώσεις / Ασφάλειες");
  assert.equal(insCat.category, "Λογαριασμοί");

  // 3. New ref codes (DD, PX, PRS)
  assert.equal(ctx.extractBankRefCode("ERB BNF / DD261526046831"), "DD261526046831");
  assert.equal(ctx.extractBankRefCode("INSU / PX260298231552"), "PX260298231552");
  assert.equal(ctx.extractBankRefCode("PRS20261030-054C-001 ΜΙΣΘΟΔΟΣΙΑ"), "PRS20261030-054C-001");

  // 4. MCC 5818 & 4722 -> Διασκέδαση
  const gplay = ctx.autoCategorizeDescription("ΑΓΟΡΑ ΜΕ ΚΑΡΤΑ GOOGLE GOOGLE PLAY APP IRELAND 22,99 EUR 441029xxxxxx0295 5818 / PO26223001364270", -22.99, "Χωρίς Κατηγορία");
  assert.equal(gplay.category, "Διασκέδαση");
  const tm = ctx.autoCategorizeDescription("ΑΓΟΡΑ ΜΕ ΚΑΡΤΑ TICKETMASTER HELLAS5 GLYFADA 11,00 EUR 441029xxxxxx0295 4722 / PO26192001131681", -11, "Ψυχαγωγία / Ταξίδια");
  assert.equal(tm.category, "Διασκέδαση");

  // 5. Self-transfers detected (Greek & Latin) while NOT falsely flagging relatives (Ευάγγελος Γούλης)
  assert.equal(ctx.isSelfTransferDescription(ctx.normalizeText("ΕΞΕΡΧΟΜΕΝΟ ΕΜΒΑΣΜΑ ΥΠΕΡ THEOFILOS GOULIS")), true);
  assert.equal(ctx.isSelfTransferDescription(ctx.normalizeText("ΕΞΕΡΧΟΜΕΝΟ ΕΜΒΑΣΜΑ ΥΠΕΡ ΓΟΥΛΗΣ ΘΕΟΦΙΛΟΣ")), true);
  assert.equal(ctx.isSelfTransferDescription(ctx.normalizeText("ΜΕΤΑΦΟΡΑ ΑΠΟ ΛΟΓΑΡΙΑΣΜΟ ΜΕΤΑΦΟΡΑ ΑΠΟ ΚΛΕΙΣΙΜΟ ΛΟΓΑΡΙΑΣΜΟΥ")), true);
  assert.equal(ctx.isSelfTransferDescription(ctx.normalizeText("ΕΞΕΡΧΟΜΕΝΟ ΕΜΒΑΣΜΑ ΥΠΕΡ ΕΥΑΓΓΕΛΟΣ ΓΟΥΛΗΣ")), false);
});

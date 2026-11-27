/* ==========================================================================
   7. BANK & REVOLUT STATEMENT IMPORTER (.XLSX / .XLS / .CSV) & ISO 18245 MCC
   ========================================================================== */
let bankUploadAttempted = false;
const SHARED_GROCERY_MIN_EUR = 10;

function extractMccCode(rawDesc) {
  const s = String(rawDesc || "");
  const afterCard = s.match(/(?:x{4,}|\*{4,})\d{2,4}\s+(\d{4})\b/i);
  if (afterCard) return afterCard[1];

  const beforeWallet = s.match(/\b(\d{4})\s+(?:google[\s-]*pay|apple[\s-]*pay|samsung[\s-]*pay|garmin[\s-]*pay|contactless|pos\b|po\d{6,})/i);
  if (beforeWallet) return beforeWallet[1];

  const explicitMcc = s.match(/\bmcc[:\s#-]*(\d{4})\b/i);
  if (explicitMcc) return explicitMcc[1];

  return null;
}

function categorizeByMcc(mccStr) {
  const code = Number(mccStr);
  if (!Number.isFinite(code) || code <= 0) return null;

  if (code === 6211) {
    return { category: "Επένδυση", isShared: false, confidence: "high", forceType: "saving" };
  }
  if ([5411, 5422, 5441, 5451, 5462, 5499, 5994].includes(code)) {
    return { category: "Τρόφιμα", isShared: code === 5411 || code === 5422, confidence: "high" };
  }
  if (code === 5912 || code === 5975 || code === 5976 || code === 742 || (code >= 8011 && code <= 8099)) {
    return { category: "Υγεία", isShared: false, confidence: "high" };
  }
  if (
    [5541, 5542, 4784, 7523, 4511, 4411].includes(code) ||
    (code >= 4111 && code <= 4131) ||
    (code >= 3000 && code <= 3500) ||
    (code >= 5511 && code <= 5533) ||
    (code >= 7531 && code <= 7549)
  ) {
    return { category: "Μεταφορές", isShared: false, confidence: "high" };
  }
  if (
    [4812, 4813, 4814, 4816, 4899, 4900, 4215, 5960].includes(code) ||
    (code >= 6300 && code <= 6399) ||
    (code >= 9211 && code <= 9399)
  ) {
    return { category: "Λογαριασμοί", isShared: code === 4900 || code === 4816, confidence: "high" };
  }
  if ([5200, 5211, 5231, 5251, 5261, 5712, 5713, 5714, 5719, 5722, 6513].includes(code)) {
    return { category: "Στέγαση", isShared: true, confidence: "high" };
  }
  if ([6010, 6011].includes(code)) {
    return { category: "Ανάληψη", isShared: false, confidence: "high" };
  }
  if (
    [4722, 5811, 5812, 5813, 5814, 5818, 7832, 7841, 5941, 5942, 5945, 5947, 5992, 5995, 5732, 5733, 5734, 5735, 7230, 7298].includes(code) ||
    (code >= 7911 && code <= 7999) ||
    (code >= 5611 && code <= 5699) ||
    (code >= 3501 && code <= 3999) ||
    code === 7011 ||
    code === 7032
  ) {
    return { category: "Διασκέδαση", isShared: false, confidence: "high" };
  }

  return null;
}

function extractMerchantKey(rawDesc) {
  let cleaned = String(rawDesc || "")
    .replace(/\b\d{4,6}[x*]{4,}\d{2,4}\b/gi, " ")
    .replace(/(?<![\p{L}\p{N}])\d+[.,]\d{2}\s*(?:eur|€|usd|gbp)?(?![\p{L}\p{N}])/giu, " ")
    .replace(/\b(?:po|rf|ref|id)\d{5,}\b/gi, " ")
    .replace(/\b(?:google[\s-]*pay|apple[\s-]*pay|samsung[\s-]*pay|contactless)\b/gi, " ");

  const norm = normalizeText(cleaned)
    .replace(/\b\d{4,}\b/g, " ")
    .replace(/[^a-zα-ω0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = norm.split(" ").filter(w => w.length >= 2 && !GENERIC_BANK_WORDS.has(w));
  return tokens.slice(0, 3).join(" ");
}

function autoCategorizeDescription(desc, amount, bankHintCat = "") {
  const cleanKey = extractMerchantKey(desc);
  if (cleanKey && data.merchantRules?.[cleanKey]) {
    const rule = data.merchantRules[cleanKey];
    return {
      category: rule.category,
      isShared: Boolean(rule.isShared),
      confidence: "high",
      ...(rule.category === "Επένδυση" ? { forceType: "saving" } : {})
    };
  }

  const rawTrimmed = String(desc || "").trim();
  const norm = normalizeText(rawTrimmed);

  if (amount > 0) {
    if (/^b\s*\/\s*o\b/i.test(rawTrimmed) || /\bb\s*\/\s*o\b/.test(norm)) {
      return { category: "Επιστροφή Χρημάτων", isShared: false, confidence: "high" };
    }
    if (hasBonusKeyword(norm)) {
      return { category: "Bonus / Δώρο", isShared: false, confidence: "high" };
    }
    if (/(?<![\p{L}\p{N}])(μισθοδοσια|μισθος|salary|payroll)(?![\p{L}\p{N}])/u.test(norm)) {
      return { category: "Μισθός", isShared: false, confidence: "high" };
    }
    if (/(?<![\p{L}\p{N}])(επιστροφη|refund|reversal|cashback)(?![\p{L}\p{N}])/u.test(norm)) {
      return { category: "Επιστροφή Χρημάτων", isShared: false, confidence: "high" };
    }
    if (/(?<![\p{L}\p{N}])(μερισμα|dividend|τοκοι|interest)(?![\p{L}\p{N}])/u.test(norm)) {
      return { category: "Επενδύσεις / Μερίσματα", isShared: false, confidence: "high" };
    }
    return { category: "Άλλο Έσοδο", isShared: false, confidence: "low" };
  }

  if (/^(rf\d{2,}|\d{6,})/.test(norm) || /\brf\d{10,}\b/.test(norm)) {
    return { category: "Λογαριασμοί", isShared: false, confidence: "high" };
  }

  // Priority 1: ATM / Cash withdrawals BEFORE transport keywords (e.g. "ATM ... METRO SEPOLIA")
  const mccEarly = extractMccCode(rawTrimmed);
  if (
    mccEarly === "6010" ||
    mccEarly === "6011" ||
    /(?<![\p{L}\p{N}])(αναληψη|analipsi|atm|cash\s*withdrawal)(?![\p{L}\p{N}])/u.test(norm)
  ) {
    return { category: "Ανάληψη", isShared: false, confidence: "high", ...(mccEarly ? { mcc: mccEarly } : {}) };
  }

  // Priority 2: Investment / Brokerage platforms (Trading 212, IBKR, DEGIRO, Freedom24, MCC 6211) -> saving
  if (
    mccEarly === "6211" ||
    /(trading\s*212|interactive\s*brokers|\bibkr\b|degiro|freedom24|etoro|vanguard|xtb\b)/i.test(norm)
  ) {
    return { category: "Επένδυση", isShared: false, confidence: "high", forceType: "saving", ...(mccEarly ? { mcc: mccEarly } : {}) };
  }

  const absAmt = Math.abs(Number(amount) || 0);
  const applySharedPolicy = (res) => {
    if (!res) return res;
    if (res.category === "Τρόφιμα" && res.isShared && absAmt > 0 && absAmt < SHARED_GROCERY_MIN_EUR) {
      return { ...res, isShared: false };
    }
    return res;
  };

  const rules = [
    // Σούπερ μάρκετ & ψώνια σπιτιού (Κοινό αν >= κατώφλι)
    {
      re: /(σουπερ μαρκετ|super\s*market|σκλαβενιτ|sklavenit|βασιλοπουλ|vasilopoul|vassilopoul|lidl|μασουτ|masout|γαλαξιας|galaxias|market\s*in|κριτικος|kritikos|my\s*market|θανοπουλ|thanopoul|bazaar|discount\s*markt|efresh|e-fresh|wolt\s*market|κρεοπωλ|kreopol|ιχθυοπωλ|οπωροπωλ|μαναβικ)/,
      cat: "Τρόφιμα",
      shared: true
    },
    // Φούρνοι, αρτοποιεία, σνακ, περίπτερα & μίνι μάρκετ (Προσωπικό)
    {
      re: /(φουρνος|fournos|αρτοποι|artopoi|terkenlis|τερκελ|βενετης|veneti|απολλωνιον|apollonion|ζαχαροπλαστ|περιπτερ|peripter|mini\s*market|μινι\s*μαρκετ|ψιλικ)/,
      cat: "Τρόφιμα",
      shared: false
    },
    // Στέγαση, κοινόχρηστα, διαχείριση πολυκατοικίας & εξοπλισμός σπιτιού (Κοινό)
    {
      re: /(ενοικιο|κοινοχρηστ|κοινοχρ|διαχειριση|πολυκατοικ|rent|leroy\s*merlin|praktiker|ikea|jysk|υδραυλικ|ηλεκτρολογ)/,
      cat: "Στέγαση",
      shared: true
    },
    // Κοινοί λογαριασμοί σπιτιού (ρεύμα, νερό, αέριο, σταθερό internet)
    {
      re: /(δεη|\bdei\b|ηρων|heron|protergia|ελπεδισον|elpedison|nrg|zenith|ζενιθ|φυσικο αεριο|fysiko\s*aerio|ευδαπ|eydap|ευαθ|eyath|starlink|ιντερνετ|internet|σταθερ)/,
      cat: "Λογαριασμοί",
      shared: true
    },
    // Προσωπικοί λογαριασμοί, εφορία, ασφάλειες, κούριερ & κινητή
    {
      re: /(telekom|telco|cosmote|vodafone|\bnova\b|\bwind\b|δανειο|loan|ααδε|aade|taxisnet|εφκα|efka|δημος|ενφια|τελη κυκλοφ|κτηματολογ|(?:^|\s)(?:διας|dias)(?=\s|$)|παγια εντολη|προμηθεια εμβασματος|εξοδα αποστολης|τραπεζικες προμηθειες|εξοφληση λογαριασμου|\binsu\b|agency\s*solutions|interamerican|εθνικη ασφαλιστικ|generali|allianz|ergo|eurolife|groupama|hellas\s*direct|anytime|acs\b|γενικη ταχυδρομ|speedex|ελτα|elta|box\s*now)/,
      cat: "Λογαριασμοί",
      shared: false
    },
    {
      re: /(shell|\beko\b|bp\b|avin|ελιν|\belin\b|revoil|coral|βενζιν|benzin|καυσιμ|οασα|oasa|οασθ|oasth|μετρο|\bmetro\b|hellenic\s*train|τραινοσε|διοδια|diodia|attiki\s*odos|αττικη οδος|nea\s*odos|νεα οδος|olympia\s*odos|ολυμπια οδος|egnatia|εγνατια|e-pass|epass|olympia\s*pass|κτελ|ktel|uber|freenow|taxi|ταξι|taxiplon|aegean|olympic\s*air|ryanair|sky\s*express|wizz\s*air|blue\s*star|minoan|seajets|fast\s*ferries|κτεο|kteo|autovision|parking|σταθμευσ|συνεργει|βουλκανιζατερ)/,
      cat: "Μεταφορές",
      shared: false
    },
    {
      re: /(φαρμακει|farmakei|pharmacy|ιατρ|iatr|διαγνωστικ|βιοιατρικ|bioiatrik|affidea|ευρωκλινικ|υγεια|hygeia|metropolitan|ντυναν|ιασω|iaso|μητερα|(?:^|\s)ρεα(?=\s|$)|κοσμοιατρικ|οδοντιατρ|odontiatr|οπτικ|optik|grandoptical|κτηνιατρ)/,
      cat: "Υγεία",
      shared: false
    },
    {
      re: /(καφε|kafe|coffee|everest|γρηγορης|gregory|mikel|starbucks|il\s*toto|kayaks|goodys|goody's|mcdonald|kfc|domino|pizza\s*fan|wolt|efood|box\b|netflix|spotify|disney|apple\.com\/bill|youtube|playstation|steam|cinema|σινεμα|village|odeon|εστιατορ|estiator|ταβερνα|taverna|souvlaki|σουβλακ|bar\b|μπαρ|skroutz|public\b|πλαισιο|plaisio|κωτσοβολ|kotsovol|media\s*markt|zara|h&m|pull\s*&\s*bear|bershka|stradivarius|massimo\s*dutti|intersport|cosmos\s*sport|zakcret|hondos|sephora|attica\b|notos|booking\.com|airbnb|gym|γυμναστηρ)/,
      cat: "Διασκέδαση",
      shared: false
    },
    {
      re: /(?<![\p{L}\p{N}])(αναληψη|analipsi|atm|cash\s*withdrawal)(?![\p{L}\p{N}])/u,
      cat: "Ανάληψη",
      shared: false
    }
  ];

  for (const r of rules) {
    if (r.re.test(norm)) {
      return applySharedPolicy({ category: r.cat, isShared: r.shared, confidence: "high" });
    }
  }

  const mcc = extractMccCode(rawTrimmed);
  if (mcc) {
    const mccRes = categorizeByMcc(mcc);
    if (mccRes) {
      return applySharedPolicy({ ...mccRes, mcc });
    }
  }

  const hintNorm = normalizeText(bankHintCat);
  if (hintNorm) {
    if (hintNorm.includes("σουπερ") || hintNorm.includes("τροφιμ") || hintNorm.includes("grocer")) return applySharedPolicy({ category: "Τρόφιμα", isShared: true, confidence: "high" });
    if (hintNorm.includes("ενεργ") || hintNorm.includes("utilit")) return { category: "Λογαριασμοί", isShared: true, confidence: "high" };
    if (hintNorm.includes("λογαριασμ") || hintNorm.includes("τηλεπικοιν") || hintNorm.includes("ασφαλ") || hintNorm.includes("προμηθ") || hintNorm.includes("υποχρεωσ") || hintNorm.includes("φορ")) return { category: "Λογαριασμοί", isShared: false, confidence: "high" };
    const isMoneyTransferHint = hintNorm.includes("μετρητ") || hintNorm.includes("εμβασμ") || hintNorm.includes("ανακατανομ");
    if ((!isMoneyTransferHint && (hintNorm.includes("μετακινησ") || hintNorm.includes("εισιτηρι") || hintNorm.includes("μεταφορ"))) || hintNorm.includes("καυσιμ") || hintNorm.includes("αυτοκινητ") || hintNorm.includes("transport") || hintNorm.includes("travel")) {
      return { category: "Μεταφορές", isShared: false, confidence: "high" };
    }
    if (hintNorm.includes("υγει") || hintNorm.includes("φαρμακ") || hintNorm.includes("health")) return { category: "Υγεία", isShared: false, confidence: "high" };
    if (hintNorm.includes("διασκεδ") || hintNorm.includes("εστιασ") || hintNorm.includes("φαγητ") || hintNorm.includes("entertain") || hintNorm.includes("restaurant") || hintNorm.includes("shopping")) return { category: "Διασκέδαση", isShared: false, confidence: "high" };
    if (hintNorm.includes("στεγασ") || hintNorm.includes("ενοικ") || hintNorm.includes("home")) return { category: "Στέγαση", isShared: true, confidence: "high" };
    if (hintNorm.includes("αναληψ") || hintNorm.includes("cash")) return { category: "Ανάληψη", isShared: false, confidence: "high" };
  }

  return { category: "Άλλο", isShared: false, confidence: "low" };
}

function parseFlexibleDateRaw(val) {
  if (!val) return null;
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    return `${val.getFullYear()}-${String(val.getMonth() + 1).padStart(2, "0")}-${String(val.getDate()).padStart(2, "0")}`;
  }
  if (typeof val === "number" && val > 25000 && val < 80000) {
    const utcDays = Math.floor(val - 25569);
    const d = new Date(utcDays * 86400 * 1000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  }
  const s = String(val).trim();
  const isoMatch = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2].padStart(2, "0")}-${isoMatch[3].padStart(2, "0")}`;
  }
  const dmyMatch = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (dmyMatch) {
    const p1 = Number(dmyMatch[1]);
    const p2 = Number(dmyMatch[2]);
    let yyyy = dmyMatch[3];
    if (yyyy.length === 2) {
      yyyy = (Number(yyyy) >= 70 ? "19" : "20") + yyyy;
    }
    if (p2 > 12 && p1 <= 12) {
      return `${yyyy}-${String(p1).padStart(2, "0")}-${String(p2).padStart(2, "0")}`;
    }
    return `${yyyy}-${String(p2).padStart(2, "0")}-${String(p1).padStart(2, "0")}`;
  }
  return null;
}

function parseFlexibleDate(val) {
  const iso = parseFlexibleDateRaw(val);
  const d = iso ? parseIsoDate(iso) : null;
  if (!d) return null;
  const back = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return (back === iso && d.getFullYear() >= 1990 && d.getFullYear() <= 2100) ? iso : null;
}

function parseFlexibleAmount(raw) {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : null;
  }
  let s = String(raw).trim();
  if (!s) return null;

  let negative = false;
  if (s.startsWith("(") && s.endsWith(")")) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  if (s.endsWith("-")) {
    negative = true;
    s = s.slice(0, -1).trim();
  }
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1).trim();
  } else if (s.startsWith("+")) {
    s = s.slice(1).trim();
  }

  s = s.replace(/[€$£\s\u00A0]/g, "").replace(/EUR|ΕΥΡΩ/gi, "");
  if (!s) return null;

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");

  if (lastComma !== -1 && lastDot !== -1) {
    if (lastComma > lastDot) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (lastComma !== -1) {
    const parts = s.split(",");
    if (parts.length > 2) {
      s = s.replace(/,/g, "");
    } else {
      s = s.replace(",", ".");
    }
  } else if (lastDot !== -1) {
    const parts = s.split(".");
    if (parts.length > 2) {
      s = s.replace(/\./g, "");
    } else if (parts.length === 2 && parts[1].length === 3 && parts[0].length <= 3 && Number(parts[0]) >= 1) {
      s = s.replace(/\./g, "");
    }
  }

  const num = Number(s);
  if (!Number.isFinite(num)) return null;
  return negative ? -Math.abs(num) : num;
}

function extractBankRefCode(rawText) {
  const s = String(rawText || "");
  if (!s) return "";
  // Piraeus / Greek banks unique transaction reference codes (PO, MB, AT, EB, DD, PX, F26TI, F928TO, MIBREM, WINBREM, PRS payroll)
  const m = s.match(/(?:\/\s*|\b)((?:PO|MB|AT|EB|DD|PX)\d{10,}|F\d{2,3}[A-Z]{2}\d{8,}|(?:MIBREM|WINBREM)\d{6,}|PRS\d{8}-[A-Z0-9-]+)\b/i);
  return m ? m[1].toUpperCase() : "";
}

function greekToLatinApprox(str) {
  const map = {
    "α": "a", "β": "v", "γ": "g", "δ": "d", "ε": "e", "ζ": "z", "η": "i", "θ": "th",
    "ι": "i", "κ": "k", "λ": "l", "μ": "m", "ν": "n", "ξ": "x", "ο": "o", "π": "p",
    "ρ": "r", "σ": "s", "ς": "s", "τ": "t", "υ": "y", "φ": "f", "χ": "ch", "ψ": "ps", "ω": "o"
  };
  return normalizeText(str)
    .replace(/ου/g, "ou")
    .replace(/αι/g, "ai")
    .replace(/ει/g, "ei")
    .replace(/οι/g, "oi")
    .replace(/μπ/g, "b")
    .replace(/ντ/g, "nt")
    .replace(/γκ/g, "g")
    .replace(/[α-ως]/g, ch => map[ch] || ch);
}

function isSelfTransferDescription(normDesc) {
  if (!normDesc) return false;
  if (normDesc.includes("μεταφορα απο κλεισιμο λογαριασμου")) return true;

  const userNameRaw = String(data.profile?.userName || "").trim();
  if (!userNameRaw) return false;

  const isTransferLine = /(εξερχομενο εμβασμα|εισερχομενο εμβασμα|μεταφορα σε λογ|μεταφορα απο λογ|υπερ\s|b\s*\/\s*o\s)/i.test(normDesc);
  if (!isTransferLine) return false;

  const nameTokensGr = normalizeText(userNameRaw).split(/\s+/).filter(t => t.length >= 3);
  if (nameTokensGr.length < 2) return false;

  const nameTokensLat = greekToLatinApprox(userNameRaw).split(/\s+/).filter(t => t.length >= 3);
  const descLat = greekToLatinApprox(normDesc);

  const matchGr = nameTokensGr.every(tok => new RegExp(`(?<![a-zα-ω0-9])${tok}(?![a-zα-ω0-9])`, "i").test(normDesc));
  const matchLat = nameTokensLat.length >= 2 && nameTokensLat.every(tok => new RegExp(`(?<![a-z0-9])${tok}(?![a-z0-9])`, "i").test(descLat));
  return matchGr || matchLat;
}

function isDuplicateTransaction(dateIso, amountAbs, desc, originalDesc = "", extraPool = [], consumedExistingIds = null, txType = null, category = null) {
  const keyA = extractMerchantKey(desc);
  const keyB = originalDesc ? extractMerchantKey(originalDesc) : "";
  const newRefCode = extractBankRefCode(originalDesc || desc);
  const pool = [...(data.transactions || []), ...extraPool];

  const found = pool.find(existing => {
    if (consumedExistingIds && existing.id && consumedExistingIds.has(existing.id)) return false;
    if (txType && existing.type && existing.type !== txType) return false;
    if (Math.abs((Number(existing.amount) || 0) - amountAbs) > 0.01) return false;

    const exRefCode = extractBankRefCode(existing.originalBankDesc || existing.description || "");
    if (newRefCode && exRefCode) {
      // Both transactions carry a unique bank reference ID AND match type & amount
      return newRefCode === exRefCode;
    }

    const isAutoRecurring = Boolean(existing.recurringId);
    const sameMonth = (existing.date || "").slice(0, 7) === (dateIso || "").slice(0, 7);
    if (isAutoRecurring) {
      if (!sameMonth) return false;
    } else if (daysBetweenIso(existing.date, dateIso) > (existing.originalBankDesc ? 0 : 3)) {
      return false;
    }

    const exKey1 = extractMerchantKey(existing.description || "");
    const exKey2 = existing.originalBankDesc ? extractMerchantKey(existing.originalBankDesc) : "";
    const candidatesNew = [keyA, keyB].filter(Boolean);
    const candidatesEx = [exKey1, exKey2].filter(Boolean);
    const keyMatched = candidatesNew.length > 0 && candidatesEx.length > 0 &&
      candidatesNew.some(cn => candidatesEx.some(ce => cn === ce || cn.includes(ce) || ce.includes(cn)));

    if (keyMatched) return true;
    if (isAutoRecurring && category && existing.category === category) return true;
    if (candidatesNew.length === 0 || candidatesEx.length === 0) {
      return existing.date === dateIso;
    }
    return false;
  });

  if (found && consumedExistingIds && found.id) {
    consumedExistingIds.add(found.id);
  }
  return found;
}


const DEBT_DETECTION_PATTERNS = [
  { kind: "loan", label: "🏦 Δάνειο", regex: /(?<![\p{L}\p{N}])(δανειο|δανειου|δανειων|στεγαστικ[α-ω]*|καταναλωτικ[α-ω]*|τοκοχρεολυτικ[α-ω]*|εξοφληση δανει[α-ω]*|loan|mortgage|repayment)(?![\p{L}\p{N}])/iu },
  { kind: "credit_card", label: "💳 Πιστωτική Κάρτα", regex: /(?<![\p{L}\p{N}])(πιστωτικ[α-ω]*|εξοφληση καρτας|πληρωμη καρτας|εξοφληση visa|εξοφληση mastercard|credit card|card payment|visa payment|mastercard payment)(?![\p{L}\p{N}])/iu },
  { kind: "installment", label: "📅 Δόση / BNPL", regex: /(?<![\p{L}\p{N}])(δοση|δοσεις|δοσης|ατοκες δοσεις|ρυθμιση οφειλ[α-ω]*|δοσεις εφοριας|κεαο|klarna|tbi bank|tbi|finloup|installment|instalment|bnpl)(?![\p{L}\p{N}])/iu }
];

function detectDebtOrInstallmentCharge(rawDesc, fullDesc, txType, amountAbs) {
  if (txType !== "expense") return null;
  const norm = normalizeText(`${rawDesc || ""} ${fullDesc || ""}`);
  if (!norm) return null;

  const liabilities = Array.isArray(data.liabilities) ? data.liabilities : [];
  let matchedLiability = null;

  for (const l of liabilities) {
    if (!l || !l.id) continue;
    const lNorm = normalizeText(l.name || "");
    const nameHit = lNorm.length >= 4 && norm.includes(lNorm);
    const monthlyHit = Number(l.monthlyPayment) > 0 && Math.abs(Number(l.monthlyPayment) - Number(amountAbs || 0)) <= 1.0;
    if (nameHit || (monthlyHit && DEBT_DETECTION_PATTERNS.some(p => p.regex.test(norm)))) {
      matchedLiability = l;
      break;
    }
  }

  for (const pat of DEBT_DETECTION_PATTERNS) {
    if (pat.regex.test(norm)) {
      return {
        isDebt: true,
        kind: pat.kind,
        label: pat.label,
        matchedLiabilityId: matchedLiability ? matchedLiability.id : ""
      };
    }
  }

  if (matchedLiability) {
    return {
      isDebt: true,
      kind: matchedLiability.type === "Credit Card" ? "credit_card" : (matchedLiability.type === "Loan" ? "loan" : "installment"),
      label: getLiabilityTypeLabel(matchedLiability.type),
      matchedLiabilityId: matchedLiability.id
    };
  }

  return null;
}

function updateBankRowDebtAction(rowId, actionVal) {
  const row = bankPreviewRows.find(r => r.rowId === rowId);
  if (!row) return;
  row.debtAction = actionVal || "expense";
  if (row.debtAction === "skip") {
    row.selected = false;
    row.statusTag = "skipped";
    row.statusReason = "⏭️ Εξαίρεση δόσης/οφειλής";
  } else if (row.debtAction.startsWith("link:")) {
    row.selected = true;
    const liabId = row.debtAction.slice(5);
    const liab = (data.liabilities || []).find(l => l.id === liabId);
    if (liab && Number(liab.interestRate) > 0 && Number(liab.remainingBalance) > 0 && !row.debtInterestTouched) {
      row.debtInterest = Math.min(row.amount, roundMoney((Number(liab.remainingBalance) * (Number(liab.interestRate) / 100)) / 12));
    }
    row.statusTag = "new";
    row.statusReason = liab ? `🔗 Αποπληρωμή: ${liab.name}` : "🔗 Σύνδεση Οφειλής";
  } else {
    row.selected = true;
    row.statusTag = "review";
    row.statusReason = row.debtInfo ? `${row.debtInfo.label} (Έλεγχος)` : "✅ Νέα κίνηση";
  }
  renderBankPreviewTable();
}

function updateBankRowDebtInterest(rowId, val) {
  const row = bankPreviewRows.find(r => r.rowId === rowId);
  if (!row) return;
  row.debtInterestTouched = true;
  row.debtInterest = Math.min(row.amount, Math.max(0, roundMoney(Number(val) || 0)));
}


function detectSelfTransferCandidatesInRows(previewRows) {
  if (!Array.isArray(previewRows) || previewRows.length === 0) return [];
  if (String(data.profile?.userName || "").trim()) return [];

  const stopTokens = new Set(["υπερ", "εξερχομενο", "εισερχομενο", "εμβασμα", "μεταφορα", "λογ", "τριτου", "απο", "προς", "eur", "ltd", "ae", "ike", "oe", "ee", "sa", "bank", "revolut", "trading", "markets"]);
  const buckets = new Map();

  for (const r of previewRows) {
    if (!r || r.statusTag === "skipped") continue;
    const raw = `${r.description || ""} ${r.originalBankDesc || ""}`;
    const m = raw.match(/(?:ΥΠΕΡ|B\/O|\d{10,})\s+([A-ZΑ-ΩΆΈΉΊΌΎΏΪΫ]{3,}(?:\s+[A-ZΑ-ΩΆΈΉΊΌΎΏΪΫ]{3,}){1,2})/i);
    if (!m) continue;
    const rawName = m[1].trim();
    const toks = normalizeText(rawName).split(/\s+/).filter(t => t.length >= 3 && !stopTokens.has(t));
    if (toks.length < 2) continue;

    // Canonical Latin sorted key groups "ΓΟΥΛΗΣ ΘΕΟΦΙΛΟΣ" and "THEOFILOS GOULIS" together
    const latToks = greekToLatinApprox(toks.join(" ")).split(/\s+/).filter(t => t.length >= 3).sort();
    if (latToks.length < 2) continue;
    const canonKey = latToks.join("|");

    if (!buckets.has(canonKey)) {
      buckets.set(canonKey, { displayName: rawName, count: 0, totalAmt: 0, rowIds: [] });
    }
    const b = buckets.get(canonKey);
    b.count++;
    b.totalAmt = roundMoney(b.totalAmt + (Number(r.amount) || 0));
    b.rowIds.push(r.rowId);
    if (/[α-ωάέήίόύώ]/i.test(rawName)) {
      b.displayName = rawName;
    }
  }

  return Array.from(buckets.values())
    .filter(b => b.count >= 3 && b.totalAmt >= 100)
    .sort((a, b) => (b.totalAmt - a.totalAmt) || (b.count - a.count))
    .slice(0, 2);
}

function applyDetectedAccountHolder(displayName) {
  const cleanName = String(displayName || "").trim();
  if (!cleanName) return;
  data.profile.userName = cleanName;
  data.settings.stateUpdatedAt = Date.now();

  let markedCount = 0;
  bankPreviewRows.forEach(r => {
    if (!r || r.statusTag === "skipped") return;
    const normDesc = normalizeText(`${r.description || ""} ${r.originalBankDesc || ""}`);
    if (isSelfTransferDescription(normDesc)) {
      r.selected = false;
      r.statusTag = "skipped";
      r.statusReason = "🔄 Εσωτερική μεταφορά (Δικός σου λογ.)";
      markedCount++;
    }
  });

  persist(true, true);
  renderBankPreviewTable();
  showToast(`✅ Αποθηκεύτηκε το όνομα «${cleanName}» και εξαιρέθηκαν ${markedCount} εσωτερικές μεταφορές!`);
}


function syncBankImportCreditCardBar() {
  const bar = document.getElementById("bankCreditCardBar");
  const sel = document.getElementById("bankCreditCardSelect");
  const updWrap = document.getElementById("bankCreditCardUpdateBalWrap");
  if (!bar || !sel) return;
  const cards = (Array.isArray(data.liabilities) ? data.liabilities : []).filter(l => l && l.type === "Credit Card");
  if (cards.length === 0) {
    bar.style.display = "none";
    sel.innerHTML = `<option value="">Όχι (Τραπεζικός Λογαριασμός / Χρεωστική)</option>`;
    sel.value = "";
    if (updWrap) updWrap.style.display = "none";
    return;
  }
  const prev = sel.value || "";
  bar.style.display = "block";
  sel.innerHTML = `<option value="">Όχι (Τραπεζικός Λογαριασμός / Χρεωστική)</option>` +
    cards.map(c => `<option value="${escapeHtml(c.id)}">💳 ${escapeHtml(c.name)} (Υπόλοιπο: ${money(c.remainingBalance || 0)})</option>`).join("");
  sel.value = prev && cards.some(c => c.id === prev) ? prev : "";
  if (updWrap) updWrap.style.display = sel.value ? "inline-flex" : "none";
}

function onBankCreditCardSelectChange() {
  const sel = document.getElementById("bankCreditCardSelect");
  const updWrap = document.getElementById("bankCreditCardUpdateBalWrap");
  const isCardMode = Boolean(sel && sel.value);
  if (updWrap) updWrap.style.display = isCardMode ? "inline-flex" : "none";

  // In Credit Card statement mode, positive card-payment rows (e.g. "ΕΞΟΦΛΗΣΗ ΚΑΡΤΑΣ") are skipped to prevent double-counting
  if (isCardMode && Array.isArray(bankPreviewRows)) {
    bankPreviewRows.forEach(r => {
      if (!r || r.type !== "income") return;
      const norm = normalizeText(`${r.description || ""} ${r.originalBankDesc || ""}`);
      if (/(εξοφληση|πληρωμη καρτας|payment|thank you|καταβολη|εναντι)/.test(norm)) {
        r.selected = false;
        r.statusTag = "skipped";
        r.statusReason = "💳 Πληρωμή κάρτας (από τραπ. λογαριασμό)";
      }
    });
    renderBankPreviewTable();
  }
}

function openBankImportModal() {
  bankPreviewRows = [];
  bankUploadAttempted = false;
  lastRawBankMatrix = [];
  lastRawBankFileName = "";
  document.getElementById("bankStatementFile").value = "";
  const searchInp = document.getElementById("bankPreviewSearch");
  if (searchInp) searchInp.value = "";
  const clearBtn = document.getElementById("clearBankSearchBtn");
  if (clearBtn) clearBtn.style.display = "none";
  const filterSel = document.getElementById("bankPreviewFilter");
  if (filterSel) filterSel.value = "all";
  const mapBox = document.getElementById("manualColumnMapperBox");
  if (mapBox) mapBox.style.display = "none";
  const mapBtn = document.getElementById("toggleColumnMapperBtn");
  if (mapBtn) mapBtn.style.display = "none";
  document.getElementById("bankImportSummaryBar").style.display = "none";
  document.getElementById("bankBulkActionsBar").style.display = "none";
  document.getElementById("confirmBankImportBtn").disabled = true;
  const bulkSel = document.getElementById("bankBulkCategorySelect");
  if (bulkSel) {
    bulkSel.innerHTML = ALL_CATEGORIES.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  }
  document.getElementById("bankPreviewBody").innerHTML = `<tr><td colspan="7" class="small">Επίλεξε ή σύρε εδώ ένα ή περισσότερα αρχεία κινήσεων (.xlsx, .xls, .csv) από Τράπεζα ή Revolut.</td></tr>`;
  syncBankImportCreditCardBar();
  document.getElementById("bankImportModal").style.display = "flex";
}

function closeBankImportModal() {
  const modal = document.getElementById("bankImportModal");
  if (modal) modal.style.display = "none";
}

function getVisibleBankPreviewRows() {
  const filter = document.getElementById("bankPreviewFilter")?.value || "all";
  const searchRaw = document.getElementById("bankPreviewSearch")?.value || "";
  const searchNorm = normalizeText(searchRaw);

  return bankPreviewRows.filter(r => {
    if (filter === "selected" && !r.selected) return false;
    if (filter === "debt" && !r.debtInfo) return false;
    if (filter === "review" && r.statusTag !== "review") return false;
    if (filter === "skipped" && r.statusTag !== "skipped") return false;
    if (searchNorm) {
      const hay = normalizeText(`${r.description || ""} ${r.originalBankDesc || ""} ${r.category || ""} ${r.source || ""} ${r.amount}`);
      if (!hay.includes(searchNorm)) return false;
    }
    return true;
  });
}

function clearBankPreviewSearch() {
  const inp = document.getElementById("bankPreviewSearch");
  if (inp) inp.value = "";
  renderBankPreviewTable();
}

function filterBankRowsByStatus(filterVal) {
  const sel = document.getElementById("bankPreviewFilter");
  if (sel) {
    sel.value = filterVal;
    renderBankPreviewTable();
  }
}

function filterSimilarBankRows(rowId) {
  const row = bankPreviewRows.find(r => r.rowId === rowId);
  if (!row) return;
  const key = extractMerchantKey(row.description) || row.description.trim().split(/\s+/).slice(0, 2).join(" ");
  const inp = document.getElementById("bankPreviewSearch");
  if (inp) {
    inp.value = key;
    renderBankPreviewTable();
  }
}

function selectOnlyVisibleBankRows() {
  const visibleIds = new Set(getVisibleBankPreviewRows().map(r => r.rowId));
  bankPreviewRows.forEach(r => {
    r.selected = visibleIds.has(r.rowId);
  });
  renderBankPreviewTable();
  showToast(`Επιλέχθηκαν μόνο οι ${visibleIds.size} εμφανιζόμενες κινήσεις.`);
}

function renderBankPreviewTable() {
  const tbody = document.getElementById("bankPreviewBody");
  const filter = document.getElementById("bankPreviewFilter")?.value || "all";
  const searchVal = (document.getElementById("bankPreviewSearch")?.value || "").trim();
  const isFiltered = filter !== "all" || searchVal.length > 0;
  const split = getCoupleSplit();

  const clearBtn = document.getElementById("clearBankSearchBtn");
  if (clearBtn) clearBtn.style.display = searchVal.length > 0 ? "inline-flex" : "none";

  const sharedHeader = document.getElementById("bankSharedColHeader");
  if (sharedHeader) sharedHeader.style.display = split.hasPartner ? "" : "none";
  const bulkSharedWrap = document.getElementById("bankBulkSharedBtns");
  if (bulkSharedWrap) bulkSharedWrap.style.display = split.hasPartner ? "inline-flex" : "none";

  const visible = getVisibleBankPreviewRows();
  const selectedCount = bankPreviewRows.filter(r => r.selected).length;

  setTextSafe(
    "bankSelectedCountText",
    isFiltered
      ? `Εμφανίζονται ${visible.length} από ${bankPreviewRows.length} • (${selectedCount} συνολικά επιλεγμένες)`
      : `${selectedCount} από ${bankPreviewRows.length} επιλεγμένες`
  );

  const selectOnlyBtn = document.getElementById("selectOnlyVisibleBankBtn");
  if (selectOnlyBtn) {
    selectOnlyBtn.style.display = isFiltered && visible.length > 0 ? "inline-flex" : "none";
  }

  const bulkApplyBtn = document.getElementById("applyBulkBankCatBtn");
  if (bulkApplyBtn) {
    bulkApplyBtn.textContent = isFiltered
      ? `Εφαρμογή στα Ορατά (${visible.length})`
      : `Εφαρμογή στα Επιλεγμένα (${selectedCount})`;
  }

  const selectAllCb = document.getElementById("bankSelectAll");
  if (selectAllCb) {
    selectAllCb.checked = visible.length > 0 && visible.every(r => r.selected);
  }

  document.getElementById("confirmBankImportBtn").disabled = selectedCount === 0;

  const summaryBar = document.getElementById("bankImportSummaryBar");
  if (summaryBar) {
    if (bankPreviewRows.length > 0) {
      summaryBar.style.display = "flex";
      summaryBar.className = "banner info";
      const salariesFound = bankPreviewRows.filter(r => r.selected && r.type === "income" && r.category === "Μισθός");
      const autoCategorizedCount = bankPreviewRows.filter(r => r.statusTag === "new").length;
      const reviewCount = bankPreviewRows.filter(r => r.statusTag === "review").length;
      const debtRows = bankPreviewRows.filter(r => r.debtInfo);
      summaryBar.innerHTML = `
        <div style="width:100%;">
          <div style="display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:6px;">
            <span><strong>Πηγή: ${escapeHtml(detectedBankSource)}</strong> • Βρέθηκαν ${bankPreviewRows.length} κινήσεις (${selectedCount} επιλεγμένες)</span>
            <div style="display:flex; gap:6px; flex-wrap:wrap;">
              <span class="badge income" style="cursor:pointer;" onclick="filterBankRowsByStatus('selected')" title="Προβολή επιλεγμένων">✅ Αυτόματες: ${autoCategorizedCount}</span>
              ${debtRows.length > 0 ? `<span class="badge expense" style="cursor:pointer;" onclick="filterBankRowsByStatus('debt')" title="Κλικ για έλεγχο δόσεων, δανείων &amp; καρτών">🏦 Δόσεις/Δάνεια: ${debtRows.length}</span>` : ""}
              ${reviewCount > 0 ? `<span class="badge withdrawal" style="cursor:pointer;" onclick="filterBankRowsByStatus('review')" title="Κλικ για εμφάνιση μόνο όσων θέλουν έλεγχο">❓ Θέλουν έλεγχο: ${reviewCount}</span>` : ""}
            </div>
          </div>
          ${debtRows.length > 0 ? `<div class="small" style="color:var(--warn); font-weight:700; margin-top:4px;">⚠️ Εντοπίστηκαν ${debtRows.length} πιθανές χρεώσεις δόσεων / δανείου / πιστωτικής. Έλεγξε αν συνδέονται με Οφειλή πριν την εισαγωγή.</div>` : ""}
          ${salariesFound.length > 0 ? `<div class="small" style="color:var(--accent); font-weight:700; margin-top:4px;">💰 Εντοπίστηκε Μισθοδοσία: ${salariesFound.map(s => `${s.date} (${money(s.amount)})`).join(", ")}</div>` : ""}
          ${(() => {
            const cands = detectSelfTransferCandidatesInRows(bankPreviewRows);
            if (!cands.length) return "";
            const top = cands[0];
            const safeTop = escapeHtml(top.displayName);
            const extraBtns = cands.slice(1).map(c => {
              const s = escapeHtml(c.displayName);
              return `<button type="button" class="secondary small-btn" data-holder="${s}" onclick="applyDetectedAccountHolder(this.dataset.holder)">Ή «${s}» (${c.count} • ${money(c.totalAmt)})</button>`;
            }).join("");
            return `<div class="small" style="margin-top:6px; padding:7px 10px; background:var(--card-soft); border:1px solid var(--primary); border-radius:9px; display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:8px;">
              <span>👤 Εντοπίστηκαν <strong>${top.count}</strong> μεταφορές προς/από <strong>«${safeTop}»</strong> (${money(top.totalAmt)}). Είναι δικός σου λογαριασμός;</span>
              <div style="display:flex; gap:6px; flex-wrap:wrap;">
                <button type="button" class="accent small-btn" data-holder="${safeTop}" onclick="applyDetectedAccountHolder(this.dataset.holder)">🔄 Εξαίρεση «${safeTop}»</button>
                ${extraBtns}
              </div>
            </div>`;
          })()}
        </div>
      `;
    } else if (bankUploadAttempted) {
      summaryBar.style.display = "flex";
      summaryBar.className = "banner warn";
      summaryBar.innerHTML = `<div><strong>⚠️ Δεν εντοπίστηκαν κινήσεις αυτόματα</strong><div class="small">Πάτησε <strong>«🛠️ Στήλες»</strong> επάνω δεξιά για να επιλέξεις χειροκίνητα τις στήλες Ημερομηνίας, Περιγραφής και Ποσού.</div></div>`;
    }
  }

  if (visible.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="small">Δεν υπάρχουν γραμμές που να ταιριάζουν στην αναζήτηση / φίλτρο.</td></tr>`;
    return;
  }

  tbody.innerHTML = visible.map(r => {
    const catList = r.type === "income" ? INCOME_CATEGORIES : [...EXPENSE_CATEGORIES, ...SAVING_CATEGORIES];
    const catOptions = catList.map(c => `<option value="${escapeHtml(c)}" ${c === r.category ? "selected" : ""}>${escapeHtml(c)}</option>`).join("");

    return `
      <tr style="${r.selected ? "" : "opacity:0.65;"}">
        <td><input type="checkbox" ${r.selected ? "checked" : ""} onchange="toggleBankRowSelection('${r.rowId}', this.checked)" /></td>
        <td style="white-space:nowrap;">
          <div>${escapeHtml(r.date)}</div>
          <span class="badge" style="font-size:10px; margin-top:2px;">${escapeHtml(r.source)}</span>
        </td>
        <td>
          <div style="display:flex; gap:4px; align-items:center;">
            <input type="text" value="${escapeHtml(r.description)}" onchange="updateBankRowDescription('${r.rowId}', this.value)" style="width:100%; min-width:160px; padding:5px 8px;" />
            <button type="button" class="secondary small-btn" onclick="filterSimilarBankRows('${r.rowId}')" title="Αναζήτηση όλων των ίδιων συναλλαγών">🔍</button>
          </div>
        </td>
        <td>
          <div style="display:flex; gap:4px; align-items:center;">
            <select onchange="updateBankRowCategory('${r.rowId}', this.value)" style="padding:5px 7px;">${catOptions}</select>
            ${r.type === "income" ? `<button type="button" class="secondary small-btn" onclick="markBankRowAsSalary('${r.rowId}')" title="Ορισμός ως Μισθός">📌 Μισθός</button>` : ""}
          </div>
        </td>
        ${split.hasPartner ? `<td><input type="checkbox" ${r.isShared ? "checked" : ""} onchange="toggleBankRowShared('${r.rowId}', this.checked)" /></td>` : ""}
        <td>
          <span class="badge ${r.debtInfo ? "expense" : ""}">${escapeHtml(r.statusReason)}</span>
          ${r.debtInfo ? `
            <div style="margin-top:4px; display:flex; flex-direction:column; gap:4px;">
              <select onchange="updateBankRowDebtAction('${r.rowId}', this.value)" style="padding:3px 6px; font-size:11px; max-width:190px;">
                <option value="expense" ${(r.debtAction || "expense") === "expense" ? "selected" : ""}>Κανονικό έξοδο</option>
                ${(data.liabilities || []).map(l => `<option value="link:${escapeHtml(l.id)}" ${r.debtAction === `link:${l.id}` ? "selected" : ""}>🔗 Οφειλή: ${escapeHtml(l.name)}</option>`).join("")}
                <option value="skip" ${r.debtAction === "skip" ? "selected" : ""}>⏭️ Εξαίρεση</option>
              </select>
              ${(r.debtAction || "").startsWith("link:") ? `
                <label class="small" style="display:flex; align-items:center; gap:4px; font-size:10.5px;">
                  Τόκοι (€): <input type="number" step="0.01" min="0" max="${r.amount}" value="${Number(r.debtInterest || 0).toFixed(2)}" onchange="updateBankRowDebtInterest('${r.rowId}', this.value)" style="width:68px; padding:2px 5px; font-size:11px;" />
                </label>
              ` : ""}
            </div>
          ` : ""}
        </td>
        <td style="text-align:right; font-weight:700; color:${r.type === "income" ? "var(--accent)" : "var(--danger)"};">${r.type === "income" ? "+" : "-"}${money(r.amount)}</td>
      </tr>
    `;
  }).join("");
}

function toggleBankRowSelection(rowId, checked) {
  const row = bankPreviewRows.find(r => r.rowId === rowId);
  if (row) row.selected = checked;
  renderBankPreviewTable();
}

function toggleAllBankRows(checked) {
  const visibleIds = new Set(getVisibleBankPreviewRows().map(r => r.rowId));
  bankPreviewRows.forEach(r => {
    if (visibleIds.has(r.rowId)) r.selected = checked;
  });
  renderBankPreviewTable();
}

function updateBankRowDescription(rowId, newVal) {
  const row = bankPreviewRows.find(r => r.rowId === rowId);
  if (row && newVal.trim()) row.description = newVal.trim();
}

function updateBankRowCategory(rowId, newCat) {
  const row = bankPreviewRows.find(r => r.rowId === rowId);
  if (!row) return;
  row.category = newCat;
  if (SAVING_CATEGORIES.includes(newCat)) row.type = "saving";
  else if (INCOME_CATEGORIES.includes(newCat)) row.type = "income";
  else row.type = "expense";
  if (row.statusTag === "review") {
    row.statusTag = "new";
    row.statusReason = "✅ Ελέγχθηκε";
  }

  const mKey = extractMerchantKey(row.originalBankDesc || row.description);
  let propagatedCount = 0;
  if (mKey && mKey.length >= 3) {
    bankPreviewRows.forEach(other => {
      if (other.rowId === row.rowId || other.type !== row.type) return;
      const otherKey = extractMerchantKey(other.originalBankDesc || other.description);
      if (otherKey && otherKey === mKey && other.category !== newCat) {
        other.category = newCat;
        if (other.statusTag === "review") {
          other.statusTag = "new";
          other.statusReason = "✅ Ελέγχθηκε";
        }
        propagatedCount++;
      }
    });
  }

  renderBankPreviewTable();
  if (propagatedCount > 0) {
    showToast(`✨ Ενημερώθηκαν αυτόματα και άλλες ${propagatedCount} όμοιες κινήσεις («${newCat}»)!`);
  }
}

function markBankRowAsSalary(rowId) {
  updateBankRowCategory(rowId, "Μισθός");
  showToast("💰 Ορίστηκε ως Μισθός (Έναρξη Κύκλου)");
}

function toggleBankRowShared(rowId, checked) {
  const row = bankPreviewRows.find(r => r.rowId === rowId);
  if (!row) return;
  row.isShared = Boolean(checked);

  const mKey = extractMerchantKey(row.originalBankDesc || row.description);
  let propagatedCount = 0;
  if (mKey && mKey.length >= 3) {
    bankPreviewRows.forEach(other => {
      if (other.rowId === row.rowId || other.type !== "expense") return;
      const otherKey = extractMerchantKey(other.originalBankDesc || other.description);
      if (otherKey && otherKey === mKey && other.isShared !== row.isShared) {
        other.isShared = row.isShared;
        propagatedCount++;
      }
    });
  }

  renderBankPreviewTable();
  if (propagatedCount > 0) {
    showToast(`✨ Ενημερώθηκαν και άλλες ${propagatedCount} όμοιες κινήσεις ως ${row.isShared ? "Κοινές (👫)" : "Προσωπικές (👤)"}!`);
  }
}

function applyBulkBankShared(makeShared) {
  const filter = document.getElementById("bankPreviewFilter")?.value || "all";
  const searchVal = (document.getElementById("bankPreviewSearch")?.value || "").trim();
  const isFiltered = filter !== "all" || searchVal.length > 0;
  const targetRows = (isFiltered ? getVisibleBankPreviewRows() : bankPreviewRows.filter(r => r.selected))
    .filter(r => r.type === "expense");

  targetRows.forEach(r => {
    r.isShared = Boolean(makeShared);
  });

  renderBankPreviewTable();
  showToast(makeShared
    ? `👫 Ορίστηκαν ${targetRows.length} έξοδα ως Κοινά.`
    : `👤 Ορίστηκαν ${targetRows.length} έξοδα ως Προσωπικά.`);
}

function applyBulkBankCategory() {
  const cat = document.getElementById("bankBulkCategorySelect")?.value;
  if (!cat) return;

  const filter = document.getElementById("bankPreviewFilter")?.value || "all";
  const searchVal = (document.getElementById("bankPreviewSearch")?.value || "").trim();
  const isFiltered = filter !== "all" || searchVal.length > 0;
  const targetRows = isFiltered ? getVisibleBankPreviewRows() : bankPreviewRows.filter(r => r.selected);

  targetRows.forEach(r => {
    r.category = cat;
    r.selected = true;
    if (SAVING_CATEGORIES.includes(cat)) r.type = "saving";
    else if (INCOME_CATEGORIES.includes(cat)) r.type = "income";
    else r.type = "expense";
    if (r.statusTag === "review" || r.statusTag === "skipped") {
      r.statusTag = "new";
      r.statusReason = "✅ Ελέγχθηκε";
    }
  });

  renderBankPreviewTable();
  showToast(`Εφαρμόστηκε η κατηγορία «${cat}» σε ${targetRows.length} συναλλαγές.`);
}

function onBankSourceOverrideChange() {
  const val = document.getElementById("bankSourceSelect")?.value || "auto";
  bankPreviewRows.forEach(r => {
    r.source = val === "auto" ? (r.autoDetectedSource || detectedBankSource) : val;
  });
  renderBankPreviewTable();
}

function parseDelimitedTextToMatrix(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) return [];
  const sample = lines.slice(0, 10).join("\n");
  const semiCount = (sample.match(/;/g) || []).length;
  const commaCount = (sample.match(/,/g) || []).length;
  const tabCount = (sample.match(/\t/g) || []).length;
  const sep = tabCount > semiCount && tabCount > commaCount ? "\t" : (semiCount >= commaCount ? ";" : ",");

  return lines.map(line => {
    const cells = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === sep && !inQuotes) {
        cells.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
    cells.push(cur.trim());
    return cells;
  });
}

function readSingleBankFile(file) {
  return new Promise((resolve, reject) => {
    if (file.size > 12 * 1024 * 1024) {
      reject(new Error("FILE_TOO_LARGE"));
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const arrayBuf = e.target.result;
        const lowerName = file.name.toLowerCase();
        if (lowerName.endsWith(".csv") || lowerName.endsWith(".txt")) {
          let text = new TextDecoder("utf-8").decode(arrayBuf);
          if (text.includes("\uFFFD")) {
            text = new TextDecoder("windows-1253").decode(arrayBuf);
          }
          const matrix = parseDelimitedTextToMatrix(text);
          resolve({ fileName: file.name, matrices: [matrix] });
          return;
        }

        const workbook = XLSX.read(arrayBuf, { type: "array", cellDates: false });
        const matrices = workbook.SheetNames.map(name =>
          XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: "" })
        );
        resolve({ fileName: file.name, matrices: matrices.map(m => m.slice(0, 50000)) });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

function populateManualColumnMapper(matrix) {
  if (!Array.isArray(matrix) || matrix.length === 0) return;
  const maxCols = Math.min(12, Math.max(...matrix.slice(0, 15).map(r => r.length)));
  if (maxCols <= 0) return;

  const sampleRow = matrix.find(r => r.filter(c => String(c).trim() !== "").length >= 3) || matrix[0];
  const opts = [];
  for (let c = 0; c < maxCols; c++) {
    const colLetter = String.fromCharCode(65 + c);
    const preview = String(sampleRow[c] || "").trim().slice(0, 22);
    opts.push(`<option value="${c}">Στήλη ${colLetter}${preview ? ` (${escapeHtml(preview)})` : ""}</option>`);
  }
  const html = opts.join("");
  document.getElementById("mapDateColSelect").innerHTML = `<option value="">-- Ημερομηνία --</option>` + html;
  document.getElementById("mapDescColSelect").innerHTML = `<option value="">-- Περιγραφή --</option>` + html;
  document.getElementById("mapAmountColSelect").innerHTML = `<option value="">-- Ποσό --</option>` + html;

  const mapBtn = document.getElementById("toggleColumnMapperBtn");
  if (mapBtn) mapBtn.style.display = "inline-flex";
}

function toggleManualColumnMapper() {
  const box = document.getElementById("manualColumnMapperBox");
  if (!box) return;
  box.style.display = box.style.display === "none" ? "block" : "none";
}

function applyManualColumnMapping() {
  if (!lastRawBankMatrix || lastRawBankMatrix.length === 0) return;
  const dCol = document.getElementById("mapDateColSelect").value;
  const descCol = document.getElementById("mapDescColSelect").value;
  const amtCol = document.getElementById("mapAmountColSelect").value;
  if (dCol === "" || amtCol === "") {
    showModal("Επίλεξε τουλάχιστον τη στήλη Ημερομηνίας και τη στήλη Ποσού.");
    return;
  }
  const customOverride = {
    dateCol: Number(dCol),
    descCol: descCol !== "" ? Number(descCol) : -1,
    amountCol: Number(amtCol)
  };
  bankPreviewRows = parseBankMatrix(lastRawBankMatrix, lastRawBankFileName, customOverride);
  document.getElementById("bankBulkActionsBar").style.display = bankPreviewRows.length > 0 ? "flex" : "none";
  renderBankPreviewTable();
  if (bankPreviewRows.length > 0) {
    showToast(`✅ Διαβάστηκαν ${bankPreviewRows.length} κινήσεις με χειροκίνητη αντιστοίχιση!`);
  }
}

function handleBankDragOver(e) {
  e.preventDefault();
  document.getElementById("bankImportDropZone")?.classList.add("drag-over");
}

function handleBankDragLeave(e) {
  e.preventDefault();
  document.getElementById("bankImportDropZone")?.classList.remove("drag-over");
}

function handleBankDrop(e) {
  e.preventDefault();
  document.getElementById("bankImportDropZone")?.classList.remove("drag-over");
  const files = e.dataTransfer?.files;
  if (files && files.length > 0) {
    processBankFilesList(Array.from(files));
  }
}

function handleBankFileUpload(event) {
  const files = event.target.files;
  if (!files || files.length === 0) return;
  processBankFilesList(Array.from(files));
}

async function processBankFilesList(filesList) {
  try {
    let allParsed = [];
    const sourcesSeen = new Set();
    const consumedExistingIds = new Set();

    for (const file of filesList) {
      const { fileName, matrices } = await readSingleBankFile(file);
      let fileParsed = [];
      for (const rows of matrices) {
        if (rows && rows.length > 0) {
          lastRawBankMatrix = rows;
          lastRawBankFileName = fileName;
        }
        const candidate = parseBankMatrix(rows, fileName, null, allParsed, consumedExistingIds);
        if (candidate.length > 0) {
          fileParsed = candidate;
          break;
        }
      }
      if (fileParsed.length > 0) {
        fileParsed.forEach(r => sourcesSeen.add(r.source));
        allParsed = allParsed.concat(fileParsed);
      }
    }

    if (sourcesSeen.size > 1) {
      detectedBankSource = Array.from(sourcesSeen).join(" + ");
    }

    if (lastRawBankMatrix.length > 0) {
      populateManualColumnMapper(lastRawBankMatrix);
    }

    bankUploadAttempted = true;
    bankPreviewRows = allParsed;
    document.getElementById("bankBulkActionsBar").style.display = allParsed.length > 0 ? "flex" : "none";
    if (allParsed.length === 0 && lastRawBankMatrix.length > 0) {
      document.getElementById("manualColumnMapperBox").style.display = "block";
      if (typeof reportAnonymousParserError === "function") {
        reportAnonymousParserError({
          bankSource: detectedBankSource,
          fileName: lastRawBankFileName,
          errorCode: "ZERO_ROWS_DETECTED",
          rowCount: lastRawBankMatrix.length
        });
      }
    }
    renderBankPreviewTable();
  } catch (err) {
    console.error("Bank import parse error:", err);
    const firstFileName = Array.isArray(filesList) && filesList[0] ? (filesList[0].name || "") : "";
    if (err && err.message === "FILE_TOO_LARGE") {
      if (typeof reportAnonymousParserError === "function") {
        reportAnonymousParserError({ bankSource: detectedBankSource, fileName: firstFileName, errorCode: "FILE_TOO_LARGE", rowCount: 0 });
      }
      showModal("Το αρχείο ξεπερνά το όριο των 12MB.");
    } else {
      if (typeof reportAnonymousParserError === "function") {
        reportAnonymousParserError({ bankSource: detectedBankSource, fileName: firstFileName, errorCode: "PARSE_EXCEPTION", rowCount: 0 });
      }
      showModal("Δεν ήταν δυνατή η ανάγνωση του αρχείου. Βεβαιώσου ότι είναι έγκυρο .xlsx, .xls ή .csv.");
    }
  }
}

function parseBankMatrix(rows, fileName, manualCols = null, intraBatchPool = [], consumedExistingIds = null) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const localConsumed = consumedExistingIds || new Set();

  const flatRaw = rows.slice(0, 20).flat().join(" ") + " " + fileName;
  const flatText = normalizeText(flatRaw);
  const ibanMatch = flatRaw.replace(/\s+/g, "").match(/GR\d{2}(\d{3})\d{16}/i);
  const bankCode = ibanMatch ? ibanMatch[1] : "";

  let fileDetectedSource = "Τράπεζα";
  if (flatText.includes("revolut") || flatText.includes("completed date")) fileDetectedSource = "Revolut";
  else if (flatText.includes("πειραιως") || flatText.includes("piraeus") || flatText.includes("winbank") || bankCode === "017") fileDetectedSource = "Πειραιώς";
  else if (flatText.includes("εθνικη") || flatText.includes("nbg") || flatText.includes("statementexport") || bankCode === "011") fileDetectedSource = "Εθνική";
  else if (flatText.includes("alpha") || bankCode === "014") fileDetectedSource = "Alpha Bank";
  else if (flatText.includes("eurobank") || bankCode === "026") fileDetectedSource = "Eurobank";
  else if (flatText.includes("viva")) fileDetectedSource = "Viva Wallet";

  detectedBankSource = fileDetectedSource;
  const overrideSrc = document.getElementById("bankSourceSelect")?.value || "auto";
  const activeSource = overrideSrc === "auto" ? fileDetectedSource : overrideSrc;

  let headerIdx = -1;
  if (!manualCols) {
    for (let i = 0; i < Math.min(45, rows.length); i++) {
      const lineNorm = normalizeText(rows[i].join(" "));
      const hasDateHeader = lineNorm.includes("ημερομηνια") || lineNorm.includes("ημ/νια") || lineNorm.includes("ημνια") || lineNorm.includes("date");
      const hasDataHeader = lineNorm.includes("ποσο") || lineNorm.includes("amount") || lineNorm.includes("χρεωση") || lineNorm.includes("πιστωση") || lineNorm.includes("περιγραφη") || lineNorm.includes("αιτιολογια") || lineNorm.includes("description");
      if (hasDateHeader && hasDataHeader) {
        headerIdx = i;
        break;
      }
    }
  }
  if (headerIdx === -1) headerIdx = 0;

  const headers = rows[headerIdx].map(h => normalizeText(h));
  const findCol = (keywords) => headers.findIndex(h => keywords.some(k => h.includes(k)));

  const txDateCol = manualCols ? -1 : findCol(["ημερομηνια συναλλαγης", "ημ/νια συναλλαγης", "ημνια συναλλαγης", "completed date", "ημερομηνια εκκαθαρισης", "ημ/νια εκκαθαρισης"]);
  const dateCol = manualCols ? manualCols.dateCol : (txDateCol !== -1 ? txDateCol : findCol(["ημερομηνια", "ημ/νια", "ημνια", "started date", "date", "valeur"]));
  const bankCatCol = manualCols ? -1 : findCol(["κατηγορια", "category"]);
  const commentsCol = manualCols ? -1 : findCol(["σχολια", "κωδικος αναφορας", "reference", "αιτιολογια", "παρατηρησεις"]);
  const descCol = manualCols ? manualCols.descCol : findCol(["περιγραφη", "description", "λεπτομερειες", "merchant", "δικαιουχος"]);
  const amountCol = manualCols ? manualCols.amountCol : findCol(["ποσο", "amount", "net"]);
  const debitCol = manualCols ? -1 : findCol(["χρεωση", "debit", "αναληψη", "εκροες"]);
  const creditCol = manualCols ? -1 : findCol(["πιστωση", "credit", "καταθεση", "εισροες"]);
  const dcFlagCol = manualCols ? -1 : findCol(["χ/π", "τυπος κινησης", "προσημο", "d/c", "type", "κινηση"]);
  const stateCol = manualCols ? -1 : findCol(["state", "κατασταση"]);
  const currencyCol = manualCols ? -1 : findCol(["currency", "νομισμα"]);
  const feeCol = manualCols ? -1 : findCol(["fee"]);

  const parsed = [];
  const startRow = manualCols ? 0 : headerIdx + 1;

  for (let r = startRow; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every(cell => String(cell).trim() === "")) continue;

    const rowJoinedNorm = normalizeText(row.join(" "));
    if (rowJoinedNorm.includes("συνολο χρεωσεων") || rowJoinedNorm.includes("συνολο πιστωσεων") || rowJoinedNorm.includes("μεταφορα υπολοιπου")) {
      continue;
    }

    let dateIso = dateCol !== -1 ? parseFlexibleDate(row[dateCol]) : null;
    if (!dateIso && !manualCols) {
      for (let c = 0; c < Math.min(6, row.length); c++) {
        const candidateDate = parseFlexibleDate(row[c]);
        if (candidateDate) {
          dateIso = candidateDate;
          break;
        }
      }
    }
    if (!dateIso) continue;

    if (stateCol !== -1) {
      const st = normalizeText(row[stateCol]);
      if (st && /(pending|reverted|reversed|failed|declined|εκκρεμ|δεσμευσ|ακυρωθ)/.test(st)) {
        continue;
      }
    }

    let currencyCode = "EUR";
    if (currencyCol !== -1 && row[currencyCol]) {
      const rawCurr = String(row[currencyCol]).trim().toUpperCase();
      currencyCode = (rawCurr === "ΕΥΡΩ" || rawCurr === "€") ? "EUR" : rawCurr;
    }

    const commText = commentsCol !== -1 ? String(row[commentsCol] || "").trim() : "";
    const descText = descCol !== -1 ? String(row[descCol] || "").trim() : "";
    const bankHintCat = bankCatCol !== -1 ? String(row[bankCatCol] || "").trim() : "";
    let rawDesc = "";

    if (commText && descText) {
      const commIsOnlyRefCode = /^[0-9\s./-]+$/.test(commText);
      const commIsGenericPos = /^(αγορα\s*(με\s*)?(χρεωστικη\s*)?καρτα|pos\s*purchase|πληρωμη\s*pos|εμβασμα|μεταφορα)$/i.test(normalizeText(commText));
      const descHasSalary = /(?<![\p{L}\p{N}])(μισθοδοσια|μισθος|salary|payroll)(?![\p{L}\p{N}])/u.test(normalizeText(descText));
      const commHasSalary = /(?<![\p{L}\p{N}])(μισθοδοσια|μισθος|salary|payroll)(?![\p{L}\p{N}])/u.test(normalizeText(commText));
      if (commIsOnlyRefCode || commIsGenericPos) {
        rawDesc = descText;
      } else if (descHasSalary && !commHasSalary) {
        rawDesc = `${commText} (${descText})`;
      } else if (normalizeText(descText).includes(normalizeText(commText))) {
        rawDesc = descText;
      } else if (normalizeText(commText).includes(normalizeText(descText))) {
        rawDesc = commText;
      } else {
        rawDesc = commText;
      }
    } else if (commText) {
      rawDesc = commText;
    } else if (descText) {
      rawDesc = descText;
    } else {
      rawDesc = row.filter((_, idx) => idx !== dateCol && idx !== amountCol).map(x => String(x).trim()).filter(Boolean).join(" ");
    }
    if (!rawDesc) rawDesc = "Τραπεζική Κίνηση";
    rawDesc = rawDesc.slice(0, 200);

    const fullBankFingerprint = ([descText, commText].filter(Boolean).join(" ") || rawDesc).slice(0, 250);

    let signedAmt = null;
    if (debitCol !== -1 && creditCol !== -1 && debitCol !== creditCol) {
      const deb = parseFlexibleAmount(row[debitCol]);
      const cred = parseFlexibleAmount(row[creditCol]);
      if (deb && Math.abs(deb) > 0) signedAmt = -Math.abs(deb);
      else if (cred && Math.abs(cred) > 0) signedAmt = Math.abs(cred);
    } else if (amountCol !== -1) {
      signedAmt = parseFlexibleAmount(row[amountCol]);
      if (signedAmt !== null && dcFlagCol !== -1) {
        const flag = normalizeText(row[dcFlagCol]);
        if (flag === "χ" || flag === "-" || flag.includes("χρεωσ") || flag === "d" || flag === "debit") {
          signedAmt = -Math.abs(signedAmt);
        } else if (flag === "π" || flag === "+" || flag.includes("πιστωσ") || flag === "c" || flag === "credit") {
          signedAmt = Math.abs(signedAmt);
        }
      }
      if (signedAmt !== null && feeCol !== -1 && feeCol !== amountCol && activeSource === "Revolut") {
        const fee = parseFlexibleAmount(row[feeCol]);
        if (fee && fee > 0) signedAmt = signedAmt - fee;
      }
    }

    if (signedAmt === null || Math.abs(signedAmt) < 0.005) continue;

    const absAmt = Number(Math.abs(signedAmt).toFixed(2));
    const normDesc = normalizeText(fullBankFingerprint);

    const isSelfTransfer = isSelfTransferDescription(normDesc);
    const isTopupOrInternal =
      currencyCode !== "EUR" ||
      isSelfTransfer ||
      /(?<![\p{L}\p{N}])(top-up|topup|revolut\*\*|μεταφορα μεταξυ λογαριασμων|exchange)(?![\p{L}\p{N}])/u.test(normDesc);

    const autoCat = autoCategorizeDescription(fullBankFingerprint, signedAmt, bankHintCat);
    const txType = (signedAmt < 0 && autoCat.forceType === "saving") ? "saving" : (signedAmt >= 0 ? "income" : "expense");
    const dupMatch = isDuplicateTransaction(dateIso, absAmt, rawDesc, fullBankFingerprint, intraBatchPool, localConsumed, txType, autoCat.category);

    let statusTag = "new";
    let statusReason = autoCat.mcc ? `✅ MCC ${autoCat.mcc}` : "✅ Νέα κίνηση";
    let selected = true;

    if (currencyCode !== "EUR") {
      statusTag = "skipped";
      statusReason = `⚠️ Ξένο νόμισμα (${currencyCode})`;
      selected = false;
    } else if (dupMatch) {
      statusTag = "skipped";
      statusReason = dupMatch.recurringId
        ? `⚠️ Ήδη καταχωρισμένο Πάγιο (${dupMatch.date})`
        : `⚠️ Διπλοεγγραφή (${dupMatch.date})`;
      selected = false;
    } else if (isTopupOrInternal) {
      statusTag = "skipped";
      statusReason = isSelfTransfer ? "🔄 Εσωτερική μεταφορά (Δικός σου λογ.)" : "🔄 Εσωτερική μεταφορά / Top-up";
      selected = false;
    } else if (autoCat.confidence === "low") {
      statusTag = "review";
      statusReason = "❓ Έλεγχος κατηγορίας";
    }

    const debtInfo = (statusTag !== "skipped")
      ? detectDebtOrInstallmentCharge(rawDesc, fullBankFingerprint, txType, absAmt)
      : null;
    let debtAction = "expense";
    let debtInterest = 0;

    if (debtInfo) {
      if (debtInfo.matchedLiabilityId) {
        debtAction = `link:${debtInfo.matchedLiabilityId}`;
        const matchedLiab = (data.liabilities || []).find(l => l.id === debtInfo.matchedLiabilityId);
        if (matchedLiab && Number(matchedLiab.interestRate) > 0 && Number(matchedLiab.remainingBalance) > 0) {
          debtInterest = Math.min(absAmt, roundMoney((Number(matchedLiab.remainingBalance) * (Number(matchedLiab.interestRate) / 100)) / 12));
        }
        statusTag = "review";
        statusReason = matchedLiab ? `🔗 ${debtInfo.label}: ${matchedLiab.name}` : `${debtInfo.label} (Έλεγχος)`;
      } else {
        statusTag = "review";
        statusReason = `${debtInfo.label} (Έλεγχος)`;
      }
    }

    parsed.push({
      rowId: generateId("brow"),
      selected,
      date: dateIso,
      description: rawDesc,
      originalBankDesc: fullBankFingerprint,
      type: txType,
      category: autoCat.category,
      isShared: autoCat.isShared,
      amount: absAmt,
      source: activeSource,
      autoDetectedSource: fileDetectedSource,
      statusTag,
      statusReason,
      debtInfo,
      debtAction,
      debtInterest,
      debtInterestTouched: false
    });
  }

  return parsed;
}

function confirmBankImport(skipDebtPrompt = false) {
  if (document.activeElement && document.activeElement.tagName === "INPUT") {
    document.activeElement.blur();
  }
  const toImport = bankPreviewRows.filter(r => r.selected);
  if (toImport.length === 0) return;

  const unlinkedDebtRows = toImport.filter(r => r.debtInfo && (r.debtAction || "expense") === "expense");
  if (!skipDebtPrompt && unlinkedDebtRows.length > 0) {
    const sampleLines = unlinkedDebtRows
      .slice(0, 5)
      .map(r => `• ${r.date} — ${r.description} (${money(r.amount)}) [${r.debtInfo.label}]`)
      .join("\n");
    const extraNote = unlinkedDebtRows.length > 5 ? `\n...και ${unlinkedDebtRows.length - 5} ακόμη.` : "";
    const hasLiabilities = (data.liabilities || []).length > 0;
    const tip = hasLiabilities
      ? "Μπορείς να πατήσεις «Ακύρωση» και να τις συνδέσεις με τις Οφειλές σου ώστε να μειωθεί σωστά το υπόλοιπο κεφαλαίου (χωρίς διπλή επιβάρυνση στο Net Worth)."
      : "Δεν έχεις καταχωρίσει ακόμη Οφειλές (tab Χαρτοφυλάκιο → Οφειλές). Αν πατήσεις «Εντάξει», θα εισαχθούν ως κανονικά έξοδα.";
    showModal(
      `Εντοπίστηκαν ${unlinkedDebtRows.length} πιθανές χρεώσεις δόσεων / δανείου / κάρτας:\n\n${sampleLines}${extraNote}\n\n${tip}\n\nΘέλεις να συνεχίσεις την εισαγωγή τους ως κανονικά έξοδα;`,
      true,
      (ok) => {
        if (ok) confirmBankImport(true);
      },
      "🏦 Έλεγχος Δόσεων & Δανείων πριν την Εισαγωγή"
    );
    return;
  }

  const split = getCoupleSplit();
  const nowTs = Date.now();
  let linkedLiabCount = 0;
  const statementCardId = String(document.getElementById("bankCreditCardSelect")?.value || "").trim();
  const statementCard = statementCardId
    ? (data.liabilities || []).find(l => l && l.id === statementCardId && l.type === "Credit Card")
    : null;
  const shouldUpdateCardBal = Boolean(statementCard && document.getElementById("bankCreditCardUpdateBal")?.checked);

  toImport.forEach(r => {
    const isShared = split.hasPartner && r.type === "expense" && Boolean(r.isShared);
    const newId = generateId("tx");
    let linkedLiabilityId = undefined;
    let linkedLiabilityType = undefined;
    let liabilityPrincipal = undefined;
    let liabilityInterest = undefined;
    let paidByCreditCardId = undefined;

    if (statementCard && (r.type === "expense" || r.type === "income")) {
      paidByCreditCardId = statementCard.id;
      if (shouldUpdateCardBal) {
        if (r.type === "expense") {
          statementCard.remainingBalance = fromCents(toCents(statementCard.remainingBalance || 0) + toCents(r.amount));
        } else if (r.type === "income") {
          statementCard.remainingBalance = fromCents(Math.max(0, toCents(statementCard.remainingBalance || 0) - toCents(r.amount)));
        }
        statementCard._updatedAt = nowTs;
        data.settings.stateUpdatedAt = nowTs;
      }
    } else if (r.debtAction && r.debtAction.startsWith("link:")) {
      const targetId = r.debtAction.slice(5);
      const liab = (data.liabilities || []).find(l => l.id === targetId);
      if (liab) {
        const interestAmt = Math.min(r.amount, Math.max(0, roundMoney(Number(r.debtInterest) || 0)));
        const rawPrincipal = fromCents(Math.max(0, toCents(r.amount) - toCents(interestAmt)));
        const appliedPrincipal = Math.min(Math.max(0, roundMoney(liab.remainingBalance || 0)), rawPrincipal);
        liab.remainingBalance = fromCents(Math.max(0, toCents(liab.remainingBalance || 0) - toCents(appliedPrincipal)));
        if (liab.type === "Credit Card" && Number(liab.installmentBalance) > liab.remainingBalance) {
          liab.installmentBalance = liab.remainingBalance;
        }
        liab._updatedAt = nowTs;
        linkedLiabilityId = liab.id;
        linkedLiabilityType = liab.type;
        liabilityPrincipal = appliedPrincipal;
        liabilityInterest = interestAmt;
        linkedLiabCount++;
        data.settings.stateUpdatedAt = nowTs;
      }
    }

    data.transactions.push({
      id: newId,
      owner: "me",
      type: r.type,
      category: r.category,
      amount: r.amount,
      date: r.date,
      description: r.description,
      originalBankDesc: r.originalBankDesc,
      source: statementCard ? statementCard.name : r.source,
      unexpected: r.category === "Έκτακτο έξοδο",
      isShared,
      paidBy: isShared ? "me" : undefined,
      settled: false,
      paidByCreditCardId,
      linkedLiabilityId,
      linkedLiabilityType,
      liabilityPrincipal,
      liabilityInterest,
      _updatedAt: nowTs
    });
    markTxDirty(newId);

    if (r.category !== "Άλλο" && r.category !== "Άλλο Έσοδο") {
      const mKey = extractMerchantKey(r.originalBankDesc || r.description);
      if (mKey && mKey.length >= 3) {
        data.merchantRules[mKey] = { category: r.category, isShared };
        data.settings.stateUpdatedAt = nowTs;
      }
    }
  });

  const importedSalaries = toImport
    .filter(x => x.type === "income" && x.category === "Μισθός" && x.amount > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  let incomeAutoSetMsg = "";
  if (importedSalaries.length > 0 && !(Number(data.profile.monthlyIncome) > 0)) {
    const latestSalary = importedSalaries[importedSalaries.length - 1].amount;
    data.profile.monthlyIncome = latestSalary;
    data.settings.stateUpdatedAt = nowTs;
    incomeAutoSetMsg = ` • Μισθός ορίστηκε σε ${money(latestSalary)}`;
  }

  const latestImportDate = toImport.map(x => x.date).sort().pop();
  if (latestImportDate && data.settings.periodMode === "month") {
    document.getElementById("activeMonth").value = latestImportDate.slice(0, 7);
  }

  persist();
  closeBankImportModal();
  render();
  const liabSuffix = linkedLiabCount > 0 ? ` (${linkedLiabCount} συνδέθηκαν με Οφειλές)` : "";
  if (typeof trackZeroKnowledgeEvent === "function") trackZeroKnowledgeEvent("bank_import_success");
  showToast(`✅ Εισήχθησαν ${toImport.length} συναλλαγές από ${toImport[0].source}${liabSuffix}${incomeAutoSetMsg}!`);
}


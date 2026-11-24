// Layer 1 — Deterministic recognizers.
// A regex proposes candidates, a checksum validator confirms or rejects them, and nearby
// context words raise confidence (the approach used by Microsoft Presidio).

// --- Checksum validators -------------------------------------------------------------
export function luhn(digits) {
  let sum = 0, double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) { d *= 2; if (d > 9) d -= 9; }
    sum += d; double = !double;
  }
  return sum % 10 === 0;
}

// Verhoeff checksum, used by India's 12-digit Aadhaar number.
const VD = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],
  [4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],
  [8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]];
const VP = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],
  [9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];
export function verhoeff(digits) {
  let c = 0;
  const rev = digits.split("").reverse();
  for (let i = 0; i < rev.length; i++) c = VD[c][VP[i % 8][+rev[i]]];
  return c === 0;
}

// ISO 13616 IBAN check: rotate, convert letters to numbers, mod 97 must equal 1.
export function ibanValid(raw) {
  const s = raw.replace(/\s+/g, "").toUpperCase();
  if (s.length < 15 || s.length > 34) return false;
  const moved = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of moved) {
    const v = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of v) rem = (rem * 10 + (+d)) % 97;
  }
  return rem === 1;
}

const digitsOf = s => s.replace(/\D/g, "");
const UPI_HANDLES = "okaxis|okhdfcbank|okicici|oksbi|ybl|ibl|axl|paytm|upi|apl|ptyes|ptsbi|pthdfc|ptaxis|kotak|hdfcbank|icici|sbi|axisbank|barodampay|aubank|freecharge|jio|airtel|fbl|idfcbank|indus|yesbank";
const MONTHS = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";

// score: prior confidence from the pattern alone.
// validate: returns false to drop, or a number to override the score.
// context: words that, when found just before the match, add `boost`.
export const RECOGNIZERS = [
  { type: "EMAIL", score: 0.95, pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g },
  { type: "UPI_ID", score: 0.85, pattern: new RegExp(String.raw`\b[A-Za-z0-9._-]{2,64}@(?:${UPI_HANDLES})\b(?!\.)`, "gi"),
    context: ["upi", "vpa", "pay", "gpay", "phonepe"] },
  { type: "CREDIT_CARD", score: 0.5, pattern: /\b(?:\d[ -]?){12,18}\d\b/g,
    validate: m => { const d = digitsOf(m); return d.length >= 13 && d.length <= 19 && /^[2-6]/.test(d) && luhn(d) ? 0.95 : false; },
    context: ["card", "visa", "mastercard", "amex", "credit", "debit", "rupay"] },
  { type: "AADHAAR", score: 0.35, pattern: /\b[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}\b/g,
    validate: m => verhoeff(digitsOf(m)) ? 0.9 : 0.35,
    context: ["aadhaar", "aadhar", "uidai", "uid"], boost: 0.4 },
  { type: "PAN", score: 0.85, pattern: /\b[A-Z]{3}[PCHFATBLJG][A-Z]\d{4}[A-Z]\b/g, context: ["pan", "income tax"] },
  { type: "SSN", score: 0.55, pattern: /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g, context: ["ssn", "social security"] },
  { type: "IBAN", score: 0.4, pattern: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/g,
    validate: m => ibanValid(m) ? 0.95 : false },
  { type: "PHONE", score: 0.75, pattern: /(?<![\w+])(?:\+91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}(?!\d)/g,
    context: ["phone", "mobile", "mob", "tel", "call", "whatsapp", "contact", "ph"] },
  { type: "PHONE", score: 0.45, pattern: /(?<![\w+])\+\d{1,3}[\s.-]?(?:\(\d{1,4}\)[\s.-]?)?\d{2,4}(?:[\s.-]?\d{2,4}){1,3}(?![\w])/g,
    validate: m => { const n = digitsOf(m).length; return n >= 9 && n <= 15 ? 0.75 : false; },
    context: ["phone", "mobile", "tel", "call", "whatsapp", "contact", "fax"] },
  { type: "PHONE", score: 0.4, pattern: /(?<![\w+-])\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?![\w-])/g,
    context: ["phone", "mobile", "tel", "call", "contact", "cell", "fax"] },
  { type: "IP_ADDRESS", score: 0.45, pattern: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g,
    context: ["ip", "address", "host", "server", "client", "login from", "logged in", "connected from"] },
  { type: "DATE_OF_BIRTH", score: 0.15, boost: 0.6,
    pattern: new RegExp(String.raw`\b(?:\d{1,2}[/.-]\d{1,2}[/.-](?:19|20)?\d{2}|(?:19|20)\d{2}-\d{2}-\d{2}|\d{1,2}(?:st|nd|rd|th)? (?:${MONTHS}),? (?:19|20)\d{2}|(?:${MONTHS}) \d{1,2},? (?:19|20)\d{2})\b`, "gi"),
    context: ["dob", "d.o.b", "date of birth", "birth date", "born", "birthday"] },
  { type: "PASSPORT", score: 0.2, boost: 0.55, pattern: /\b[A-Z][0-9]{7}\b/g, context: ["passport"] },
  { type: "POSTAL_CODE", score: 0.1, boost: 0.6, pattern: /\b(?:[1-9]\d{2}\s?\d{3}|\d{5}(?:-\d{4})?)\b/g,
    context: ["pin", "pincode", "pin code", "zip", "postal", "postcode"] },
  { type: "ADDRESS", score: 0.6,
    pattern: /\b\d{1,5}[A-Z]?,?\s+(?:[A-Z][A-Za-z]*\.?\s){1,4}(?:Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Nagar|Marg|Boulevard|Blvd|Drive|Dr|Layout|Cross|Main|Colony)\b\.?(?:,?\s+[A-Z][a-z]+(?:\s+[1-9]\d{2}\s?\d{3}|\s+\d{5})?)?/g,
    context: ["address", "live at", "lives at", "residing", "ship to", "deliver"] },
];

// Structural cues: a capitalized phrase right after a name-like label ("Customer: Rahul Verma",
// a "Name" table cell) or in an email header ("Priya Sharma <priya@…>") is a person.
const CAP = String.raw`\p{Lu}[\p{L}'’.-]+`;
const NAME = String.raw`${CAP}(?:[ \t]+${CAP}){0,3}`;
const ci = w => w.replace(/[a-z]/g, c => `[${c}${c.toUpperCase()}]`);
const LABELS = ["full name", "name", "customer", "client", "patient", "employee", "applicant", "account holder",
  "cardholder", "contact person", "beneficiary", "passenger", "guest", "attn", "dear", "hi", "hello"].map(ci).join("|");
const STRUCTURAL = [
  { rx: new RegExp(String.raw`(?<!\p{L})(?:${LABELS})[ \t]*(?::|\n|,|[ \t])[ \t]*(${NAME})`, "gud"), score: 0.7, why: "follows a name label" },
  { rx: new RegExp(String.raw`(${NAME})[ \t]*<[^<>\s@]+@[^<>\s]+>`, "gud"), score: 0.8, why: "email header display name" },
];
const NOT_NAMES = /^(?:The|This|That|Your|Our|My|Team|Support|Sales|Billing|Admin|Info|Hi|Hello|Thanks|Regards|None|Unknown|Plan|Email|Phone|Name|Full|Customer|Company|Address|Date|Status|Details|Information)\b/;

export function detectStructure(text) {
  const out = [];
  for (const { rx, score, why } of STRUCTURAL) {
    rx.lastIndex = 0;
    for (let m; (m = rx.exec(text));) {
      const [s, e] = m.indices[1];
      // A rejected capture may itself be a label ("Customer\nName\nPriya…"): resume there.
      if (NOT_NAMES.test(m[1])) { rx.lastIndex = s; continue; }
      out.push({ start: s, end: e, type: "PERSON", score, source: "rules", reasons: [why] });
    }
  }
  return out;
}

const CONTEXT_WINDOW = 48;

export function contextBoost(text, start, words) {
  if (!words?.length) return null;
  const before = text.slice(Math.max(0, start - CONTEXT_WINDOW), start).toLowerCase();
  return words.find(w => before.includes(w)) || null;
}

export function detectPatterns(text) {
  const out = [];
  for (const r of RECOGNIZERS) {
    r.pattern.lastIndex = 0;
    for (const m of text.matchAll(r.pattern)) {
      let score = r.score;
      const reasons = ["pattern"];
      if (r.validate) {
        const v = r.validate(m[0]);
        if (v === false) continue;
        if (typeof v === "number") { if (v > score) reasons.push("checksum"); score = v; }
      }
      const word = contextBoost(text, m.index, r.context);
      if (word) { score = Math.min(0.99, score + (r.boost ?? 0.3)); reasons.push(`context “${word}”`); }
      out.push({ start: m.index, end: m.index + m[0].length, type: r.type, score, source: "rules", reasons });
    }
  }
  return out.concat(detectStructure(text));
}

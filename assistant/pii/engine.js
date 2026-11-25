// The PII engine: runs every detection layer, fuses their votes, links related mentions
// and applies the user's policy. Everything here runs on the user's device.
import { detectPatterns } from "./patterns.js";
import { detectSecrets } from "./secrets.js";
import { detectNlp } from "./nlp.js";

export const LAYERS = [
  { id: "rules", name: "Rules + checksums", detail: "Regex candidates confirmed by Luhn, Verhoeff, IBAN mod-97 and context words" },
  { id: "secrets", name: "Secrets + entropy", detail: "Credential signatures and Shannon-entropy scoring for unknown keys" },
  { id: "nlp", name: "Linguistic NER", detail: "Compromise lexicon and part-of-speech rules for names, places, organizations" },
  { id: "neural", name: "Transformer NER", detail: "Generic BERT (CoNLL-2003) or the fine-tuned Mintx PII model, int8, run with ONNX Runtime WebAssembly" },
];

export const POLICIES = { strict: 0.35, balanced: 0.5, relaxed: 0.7 };
const FLOOR = 0.25;           // candidates below this never form a cluster
const GENERIC = new Set(["PERSON", "LOCATION", "ORGANIZATION"]);
const NER_SOURCES = new Set(["nlp", "neural"]);
// Domain vocabulary that NER models often mistake for organizations: names of document
// types and fields, not personal data. Masking them would only hide context from the model.
const VOCAB = new Set(["aadhaar", "aadhar", "pan", "upi", "iban", "ifsc", "kyc", "otp", "gst", "gstin", "ssn", "dob",
  "email", "e-mail", "phone", "mobile", "address", "name", "customer", "support", "billing", "refund", "invoice",
  "ticket", "account", "password", "visa", "mastercard", "rupay", "api", "ai", "url", "id", "pin"]);
const NAME_STOP = new Set(["The", "And", "For", "With", "From", "Team", "Hello", "Dear", "Thanks", "Regards", "Mr", "Mrs", "Ms", "Dr"]);

// Rule types are specific; the fine-tuned model uses broader ones. Same family = same thing.
const FAMILIES = { AADHAAR: "GOV_ID", PAN: "GOV_ID", SSN: "GOV_ID", PASSPORT: "GOV_ID", IBAN: "BANK_ACCOUNT" };
export const family = type => FAMILIES[type] || type;

export function normalize(type, value) {
  const v = String(value);
  if (type === "PHONE") return `${type}:${v.replace(/\D/g, "").slice(-10)}`;
  if (["CREDIT_CARD", "AADHAAR", "SSN"].includes(type)) return `${type}:${v.replace(/\D/g, "")}`;
  if (["GOV_ID", "PAN", "PASSPORT", "BANK_ACCOUNT", "IBAN"].includes(type)) return `${type}:${v.replace(/[\s-]/g, "").toUpperCase()}`;
  if (["EMAIL", "UPI_ID"].includes(type)) return `${type}:${v.toLowerCase()}`;
  return `${type}:${v.replace(/\s+/g, " ").trim().toLowerCase()}`;
}

// Probabilistic OR: independent detectors that agree raise confidence above either alone.
export const noisyOr = scores => 1 - scores.reduce((p, s) => p * (1 - s), 1);

// Ensemble fusion: overlapping candidates form a cluster; each type's evidence is combined
// with noisy-OR (one vote per source); the strongest type wins; the span covers every
// credible candidate so partial detections never leave a fragment exposed.
export function fuse(text, candidates) {
  const cands = candidates.filter(c => c.score >= FLOOR && c.end > c.start)
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const clusters = [];
  for (const c of cands) {
    const last = clusters[clusters.length - 1];
    if (last && c.start < last.end) { last.items.push(c); last.end = Math.max(last.end, c.end); }
    else clusters.push({ start: c.start, end: c.end, items: [c] });
  }
  return clusters.map(({ items }) => {
    // Votes are pooled per type family, so the fine-tuned model's GOV_ID and the rules' AADHAAR
    // reinforce each other instead of competing.
    const byFamily = new Map();
    for (const c of items) {
      const fam = family(c.type);
      const t = byFamily.get(fam) || { sources: new Map(), reasons: [], types: new Map() };
      t.sources.set(c.source, Math.max(t.sources.get(c.source) || 0, c.score));
      t.types.set(c.type, Math.max(t.types.get(c.type) || 0, c.score));
      t.reasons.push(...c.reasons.map(r => `${c.source}: ${r}`));
      byFamily.set(fam, t);
    }
    // A confident structured type (ADDRESS, PHONE…) is more informative than a generic NER
    // label (LOCATION) for the same span, so it wins unless clearly outscored.
    const rank = (type, score) => score + (GENERIC.has(type) ? 0 : score >= 0.75 ? 0.15 : 0);
    let best;
    for (const [fam, t] of byFamily) {
      const score = noisyOr([...t.sources.values()]);
      // Report the most specific member type (AADHAAR rather than GOV_ID) when one was seen.
      const specific = [...t.types].filter(([type]) => type !== fam).sort((a, b) => b[1] - a[1])[0];
      const type = specific ? specific[0] : fam;
      if (!best || rank(type, score) > rank(best.type, best.score)) best = { type, family: fam, score, sources: [...t.sources.keys()], reasons: t.reasons };
    }
    const others = [...byFamily.keys()].filter(f => f !== best.family);
    if (others.length) best.reasons.push(`outvoted: ${others.join(", ")}`);
    delete best.family;
    // Span: every candidate of the winning family, plus any strong candidate of another type.
    // Weak, outvoted guesses do not stretch the span (avoids masking whole labels).
    const span = items.filter(c => family(c.type) === family(best.type) || c.score >= 0.5);
    const s = Math.min(...span.map(c => c.start)), e = Math.max(...span.map(c => c.end));
    return { start: s, end: e, text: text.slice(s, e), ...best };
  });
}

const wordAt = (text, s, e) => !/[\p{L}\p{N}_]/u.test(text[s - 1] || "") && !/[\p{L}\p{N}_]/u.test(text[e] || "");
const words = s => s.split(/\s+/);

// Three resolution steps after fusion:
//  1. Coreference: a partial name ("Priya", "Sharma") that is contained in a longer detected
//     name ("Priya Sharma") is the same person, so it shares that name's placeholder.
//  2. Propagation: every repeat of a detected value is masked even where no detector fired.
//     Longer values go first and absorb shorter detections inside them.
//  3. Linking: bare first or last names of a detected person are masked everywhere.
export function link(text, entities) {
  let out = entities.map(e => ({ ...e }));
  const persons = out.filter(e => e.type === "PERSON");
  for (const e of persons) {
    const mine = words(e.text);
    const full = persons.filter(f => f.text.length > e.text.length && mine.every(w => words(f.text).includes(w)))
      .sort((a, b) => b.text.length - a.text.length)[0];
    if (full) { e.canonical = full.text; e.reasons = [...e.reasons, `coreference: same person as “${full.text}”`]; }
  }
  // Email-to-name inference: "vikram.nair@…" reveals the name "Vikram Nair"; mask it where it
  // appears in the text even if neither NER layer recognized it.
  for (const em of out.filter(e => e.type === "EMAIL")) {
    const parts = em.text.split("@")[0].split(/[._-]+/).filter(w => /^\p{L}{3,}$/u.test(w));
    if (parts.length < 2) continue;
    const rx = new RegExp(`(?<!\\p{L})${parts.join("[\\s.]+")}(?!\\p{L})`, "giu");
    for (const m of text.matchAll(rx)) {
      const s = m.index, e = s + m[0].length;
      if (out.some(x => s < x.end && e > x.start) || !/^\p{Lu}/u.test(m[0])) continue;
      out.push({ start: s, end: e, text: m[0], type: "PERSON", score: Math.min(0.9, em.score * 0.85),
        sources: ["linking"], reasons: [`name spelled out in email ${em.text}`] });
    }
  }
  const add = (needle, base, source, reason) => {
    if (needle.length < 3) return;
    for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + needle.length)) {
      const e = i + needle.length;
      if (!wordAt(text, i, e)) continue;
      const hit = out.filter(x => i < x.end && e > x.start);
      if (hit.some(x => x.start < i || x.end > e)) continue;              // inside a longer span already
      if (hit.length === 1 && hit[0].start === i && hit[0].end === e) continue;
      out = out.filter(x => !hit.includes(x));
      out.push({ start: i, end: e, text: needle, type: base.type,
        score: Math.max(base.score * 0.95, ...hit.map(x => x.score)),
        sources: [...new Set([...hit.flatMap(x => x.sources), source])],
        reasons: [reason, ...hit.flatMap(x => x.reasons)], canonical: base.canonical || base.text });
    }
  };
  const bases = [...out].sort((a, b) => b.text.length - a.text.length);
  for (const ent of bases) add(ent.text, ent, "propagation", `repeat of a detected ${ent.type}`);
  for (const ent of bases) if (ent.type === "PERSON" && !ent.canonical)
    for (const part of words(ent.text))
      if (/^\p{Lu}\p{L}{2,}$/u.test(part) && !NAME_STOP.has(part)) add(part, ent, "linking", `part of “${ent.text}”`);
  return out.sort((a, b) => a.start - b.start);
}

export async function analyze(text, opts = {}) {
  const { layers = { rules: true, secrets: true, nlp: true, neural: false }, threshold = POLICIES.balanced,
    allow = new Set(), neural, onLayer = () => {} } = opts;
  const timings = {}, counts = {}, errors = {};
  const candidates = [];
  const run = async (id, fn) => {
    if (!layers[id]) return;
    onLayer(id, "running");
    const t0 = performance.now();
    try {
      const found = await fn();
      candidates.push(...found);
      counts[id] = found.length;
      onLayer(id, "done", found.length);
    } catch (e) {
      errors[id] = e.message; onLayer(id, "error", e.message);
    }
    timings[id] = Math.round(performance.now() - t0);
  };
  await run("rules", () => detectPatterns(text));
  await run("secrets", () => detectSecrets(text));
  await run("nlp", () => detectNlp(text, opts.nlp));
  if (neural) await run("neural", () => neural(text));

  const t0 = performance.now();
  const fused = fuse(text, candidates.filter(c => !(NER_SOURCES.has(c.source) && VOCAB.has(text.slice(c.start, c.end).toLowerCase()))));
  const linked = link(text, fused.filter(e => e.score >= threshold));
  const entities = linked.filter(e => !allow.has(normalize(e.type, e.canonical || e.text)));
  timings.fusion = Math.round(performance.now() - t0);
  const belowThreshold = fused.filter(e => e.score < threshold);
  return { entities, belowThreshold, kept: linked.length - entities.length, candidates: candidates.length, counts, timings, errors };
}

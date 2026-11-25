// Learned decision layer: "mask or keep?" for each fused candidate.
// The same feature function is used to build training data (ml/classifier) and at run time,
// so training and inference can never drift apart.
import { family, FAMILY_LIST } from "./types.js";
import { PUBLIC_NAMES } from "./public-entities.js";

const SOURCES = ["rules", "secrets", "nlp", "neural"];
const TITLES = /\b(?:mr|mrs|ms|miss|dr|prof|shri|smt)\.?\s*$/i;
const NAME_LABELS = /\b(?:name|customer|patient|applicant|dear|hi|hello|hey|from|to|by|with|thanks|regards|contact|agent|owner|tenant)\b[^\n]{0,3}$/i;
const PREPOSITIONS = /\b(?:at|from|in|to|with|by|for|of|near|via)\s+$/i;
const NAME_TAGS = new Set(["MaleName", "FemaleName", "FirstName", "LastName", "Person", "Honorific"]);
const PLACE_TAGS = new Set(["Country", "City", "Region", "Place", "Address"]);

function lexicon(nlp) {
  try { return nlp?.model?.().one?.lexicon || {}; } catch { return {}; }
}

export const FEATURE_NAMES = [
  ...SOURCES.map(s => `vote_${s}`), "fused_score", "n_sources", "n_families",
  ...FAMILY_LIST.map(f => `type_${f}`),
  "public_name", "log_length", "n_words", "all_upper", "title_case", "lower_case", "digit_ratio", "has_at",
  "line_start", "sentence_start", "colon_after", "title_before", "name_label_before", "preposition_before",
  "lex_common_frac", "lex_name_frac", "lex_unknown_frac", "lex_org_or_place",
];

export function features(text, e, nlp) {
  const span = text.slice(e.start, e.end);
  const words = span.split(/\s+/).filter(Boolean);
  const before = text.slice(Math.max(0, e.start - 40), e.start);
  const after = text.slice(e.end, e.end + 2);
  const lex = lexicon(nlp);
  let common = 0, name = 0, unknown = 0, orgPlace = 0;
  for (const w of words) {
    const tag = lex[w.toLowerCase().replace(/[^\p{L}'-]/gu, "")];
    if (!tag) unknown++;
    else if (NAME_TAGS.has(tag)) name++;
    else if (tag === "Organization" || PLACE_TAGS.has(tag)) orgPlace++;
    else common++;
  }
  const n = Math.max(1, words.length);
  const letters = span.replace(/[^\p{L}]/gu, "");
  const fam = family(e.type);
  return [
    ...SOURCES.map(s => e.votes?.[s] || 0), e.fusedScore ?? e.score, Object.keys(e.votes || {}).length, e.families || 1,
    ...FAMILY_LIST.map(f => +(fam === f)),
    +PUBLIC_NAMES.has(span.toLowerCase().replace(/^the\s+/, "")),
    Math.log1p(span.length), words.length,
    +(letters.length > 1 && letters === letters.toUpperCase()),
    +(words.length > 0 && words.every(w => /^\p{Lu}/u.test(w))),
    +(letters.length > 0 && letters === letters.toLowerCase()),
    span.replace(/\D/g, "").length / Math.max(1, span.length),
    +span.includes("@"),
    +/(^|\n)[ \t]*$/.test(before),
    +/(^|[.!?]\s+|\n\s*)$/.test(before),
    +/^\s?:/.test(after),
    +TITLES.test(before),
    +NAME_LABELS.test(before),
    +PREPOSITIONS.test(before),
    common / n, name / n, unknown / n, +(orgPlace > 0),
  ];
}

const sigmoid = z => 1 / (1 + Math.exp(-z));

// model.kind "lr": standardized logistic regression. "gb": gradient-boosted trees (log-loss).
export function predict(model, x) {
  if (model.kind === "lr") {
    let z = model.intercept;
    for (let i = 0; i < x.length; i++) z += model.coef[i] * (x[i] - model.mean[i]) / model.scale[i];
    return sigmoid(z);
  }
  let z = model.init;
  for (const t of model.trees) {
    let node = 0;
    while (t.left[node] !== -1) node = x[t.feature[node]] <= t.threshold[node] ? t.left[node] : t.right[node];
    z += model.learning_rate * t.value[node];
  }
  return sigmoid(z);
}

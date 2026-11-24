// Shared helpers for Layer 4 (transformer NER). Pure functions so they can be unit-tested.

export const NER_MODEL = "Xenova/bert-base-NER";
const TYPES = { PER: "PERSON", LOC: "LOCATION", ORG: "ORGANIZATION" };

// BERT reads at most 512 sub-word tokens, so long pages are split at sentence or line
// boundaries into chunks of roughly 250 tokens.
export function chunk(text, size = 1000) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + size);
    if (end < text.length) {
      const window = text.slice(start, end);
      const cut = Math.max(window.lastIndexOf("\n"), window.lastIndexOf(". "), window.lastIndexOf("? "), window.lastIndexOf("! "));
      if (cut > size * 0.5) end = start + cut + 1;
    }
    if (text.slice(start, end).trim()) chunks.push({ offset: start, text: text.slice(start, end) });
    start = end;
  }
  return chunks;
}

const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The pipeline returns one label per sub-word token (B-PER, I-PER, ##-continuations) without
// character offsets. Merge adjacent tokens into entities, then locate each entity in the
// source text by matching its pieces with optional whitespace between them.
export function aggregate(text, tokens, offset = 0) {
  const groups = [];
  let cur = null;
  for (const t of tokens) {
    const [bio, label] = t.entity.split("-");
    const type = TYPES[label];
    const sub = t.word.startsWith("##");
    const continues = cur && t.index === cur.last + 1 && (sub || (bio === "I" && cur.label === label));
    if (continues) {
      if (sub) cur.pieces[cur.pieces.length - 1] += t.word.slice(2);
      else cur.pieces.push(t.word);
      cur.scores.push(t.score); cur.last = t.index;
      continue;
    }
    if (cur) groups.push(cur);
    cur = type && !sub ? { label, type, pieces: [t.word], scores: [t.score], last: t.index } : null;
  }
  if (cur) groups.push(cur);

  const out = [];
  let cursor = 0;
  for (const g of groups) {
    const rx = new RegExp(g.pieces.map(escape).join("\\s*"), "gu");
    rx.lastIndex = cursor;
    const m = rx.exec(text);
    if (!m) continue;
    cursor = m.index + m[0].length;
    const score = g.scores.reduce((a, b) => a + b, 0) / g.scores.length;
    if (m[0].length < 2) continue;
    out.push({ start: offset + m.index, end: offset + cursor, type: g.type, score: Math.min(0.97, score),
      source: "neural", reasons: [`BERT ${g.label} p=${score.toFixed(2)}`] });
  }
  return out;
}

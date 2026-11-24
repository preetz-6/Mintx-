// Layer 3 — Linguistic NER with Compromise.
// A lexicon plus part-of-speech rules tags people, places and organizations. It is fast and
// small (no model download) but less accurate than the neural layer, so its priors are lower.

const KINDS = [["people", "PERSON", 0.55], ["places", "LOCATION", 0.45], ["organizations", "ORGANIZATION", 0.4]];
const STOP = new Set(["I", "Me", "You", "He", "She", "We", "They", "Mr", "Mrs", "Ms", "Dr", "Sir", "Madam", "Dear", "Hi", "Hello"]);

export function detectNlp(text, nlp = globalThis.nlp) {
  if (!nlp || !text) return [];
  const doc = nlp(text);
  const out = [];
  for (const [method, type, score] of KINDS) {
    for (const m of doc[method]().json({ offset: true })) {
      let { start, length } = m.offset;
      let value = text.slice(start, start + length);
      // Trim punctuation and possessives that Compromise keeps attached to terms.
      const lead = value.match(/^[^\p{L}\p{N}]*/u)[0].length;
      value = value.slice(lead).replace(/(?:['’]s)?[^\p{L}\p{N}]*$/u, "");
      start += lead;
      value = value.split(/[()[\]{}<>:;,"|]/)[0].trim();   // "Rahul Verma (Support" → "Rahul Verma"
      if (value.length < 2 || STOP.has(value) || !/\p{Lu}/u.test(value)) continue;
      out.push({ start, end: start + value.length, type, score, source: "nlp", reasons: [`compromise .${method}()`] });
    }
  }
  return out;
}

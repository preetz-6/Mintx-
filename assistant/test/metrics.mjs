// Metric computation shared by the Node CLI (evaluate.mjs) and the in-browser run.
import { analyze, POLICIES } from "../pii/engine.js";
import { Vault } from "../pii/vault.js";
import { CORPUS } from "./corpus.mjs";

export async function evaluate(layers, extra = {}) {
  let tp = 0, fn = 0, spansTotal = 0, spansGood = 0, decoyHits = 0, leaks = 0, roundTrip = true;
  const missed = [];
  for (const s of CORPUS) {
    const r = await analyze(s.text, { layers, threshold: POLICIES.balanced, ...extra });
    const goldSpans = s.gold.map(([v]) => { const i = s.text.indexOf(v); return [i, i + v.length, v]; });
    for (const [gs, ge, v] of goldSpans) {
      if (r.entities.some(e => e.start <= gs && e.end >= ge)) tp++; else { fn++; missed.push(v); }
    }
    for (const e of r.entities) {
      spansTotal++;
      if (goldSpans.some(([gs, ge]) => e.start < ge && e.end > gs)) spansGood++;
    }
    for (const d of s.decoys || []) {
      const i = s.text.indexOf(d);
      if (r.entities.some(e => e.start < i + d.length && e.end > i)) decoyHits++;
    }
    const vault = new Vault();
    const { text } = vault.sanitize(s.text, r.entities);
    for (const [v] of s.gold) if (r.entities.length && text.includes(v)) leaks++;
    if (vault.restore(text) !== s.text && r.entities.every(e => !e.canonical)) roundTrip = false;
  }
  const recall = tp / (tp + fn), precision = spansTotal ? spansGood / spansTotal : 1;
  return { recall, precision, f1: 2 * precision * recall / (precision + recall || 1), decoyHits, leaks, roundTrip, missed };
}


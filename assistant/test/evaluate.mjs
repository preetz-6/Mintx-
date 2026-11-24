// Layer ablation on the synthetic corpus. Run: node test/evaluate.mjs
// Recall: gold values fully covered by a masked span. Precision: masked spans that overlap
// a gold value. Also checks that pseudonymization round-trips exactly.
// The transformer layer needs a browser runtime; see README for the in-extension run.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { evaluate } from "./metrics.mjs";
import { CORPUS } from "./corpus.mjs";

const nlp = createRequire(import.meta.url)("../vendor/compromise.js");
const CONFIGS = {
  "rules": { rules: true },
  "rules+secrets": { rules: true, secrets: true },
  "rules+secrets+nlp": { rules: true, secrets: true, nlp: true },
};

if (resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const gold = CORPUS.reduce((n, s) => n + s.gold.length, 0);
  console.log(`Corpus: ${CORPUS.length} samples, ${gold} gold values\n`);
  console.log("layers".padEnd(22), "recall  precision  F1     decoys  roundtrip");
  for (const [name, layers] of Object.entries(CONFIGS)) {
    const r = await evaluate(layers, { nlp });
    console.log(name.padEnd(22), (r.recall * 100).toFixed(1).padStart(5) + "%", (r.precision * 100).toFixed(1).padStart(8) + "%",
      r.f1.toFixed(3).padStart(7), String(r.decoyHits).padStart(5), r.roundTrip ? "     ok" : "   FAIL");
    if (r.missed.length) console.log("   missed:", r.missed.join(" | "));
  }
}

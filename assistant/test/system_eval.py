"""System-level evaluation: the whole in-browser privacy engine (all layers + fusion + linking),
run inside the real extension on the hand-checked realistic test set.

    python assistant/test/system_eval.py [--model Preetm-666/mintx-pii-distilbert] [--set test_realistic]

Compares: rules only · rules + generic BERT · rules + fine-tuned model · fine-tuned model alone.
Needs ml/data/processed/ (python ml/data/build.py).
"""
import json, sys, tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
EXT = ROOT / "assistant"
arg = lambda flag, default: sys.argv[sys.argv.index(flag) + 1] if flag in sys.argv else default
MODEL = arg("--model", "Preetm-666/mintx-pii-distilbert")
SET = arg("--set", "test_realistic")
records = [json.loads(l) for l in open(ROOT / f"ml/data/processed/{SET}.jsonl", encoding="utf-8")]

JS = """async ({ records, model }) => {
  const { analyze, family } = await import(chrome.runtime.getURL('pii/engine.js'));
  const { detectNeural } = await import(chrome.runtime.getURL('pii/neural.js'));
  const nlp = globalThis.nlp;
  const base = { rules: true, secrets: true, nlp: true };
  const configs = {
    'rules + secrets + linguistic NER': { layers: { ...base, neural: false } },
    '+ generic BERT (CoNLL)': { layers: { ...base, neural: true }, model: 'Xenova/bert-base-NER' },
    '+ fine-tuned Mintx model': { layers: { ...base, neural: true }, model },
    'fine-tuned Mintx model alone': { layers: { neural: true }, model },
  };
  const TYPE = t => ({ POSTAL_CODE: 'ADDRESS' }[t] || family(t));
  const out = {};
  for (const [name, cfg] of Object.entries(configs)) {
    let gold = 0, covered = 0, preds = 0, over = 0, keep = 0, kept = 0, tp = 0, fp = 0, fn = 0;
    const t0 = performance.now();
    for (const r of records) {
      const neural = cfg.layers.neural ? t => detectNeural(t, null, cfg.model) : null;
      const { entities } = await analyze(r.text, { layers: cfg.layers, neural, nlp });
      const ov = (a, b) => a.start < b.end && b.start < a.end;
      for (const g of r.spans) {
        gold++;
        let ok = true;
        for (let i = g.start; i < g.end; i++)
          if (!/\\s/.test(r.text[i]) && !entities.some(e => e.start <= i && i < e.end)) { ok = false; break; }
        covered += ok;
      }
      for (const e of entities) { preds++; if (!r.spans.some(g => ov(e, g))) over++; }
      for (const k of r.keep) { keep++; if (!entities.some(e => ov(e, k))) kept++; }
      const used = new Set();
      for (const e of entities) {
        const j = r.spans.findIndex((g, j) => !used.has(j) && ov(e, g) && TYPE(e.type) === TYPE(g.label));
        if (j < 0) fp++; else { used.add(j); tp++; }
      }
      fn += r.spans.length - used.size;
    }
    out[name] = { privacy_recall: covered / gold, over_mask_rate: over / Math.max(1, preds), keep_respected: keep ? kept / keep : null,
                  typed_partial_f1: 2 * tp / Math.max(1, 2 * tp + fp + fn), ms_per_text: (performance.now() - t0) / records.length };
  }
  return out;
}"""

with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(str(Path(tempfile.gettempdir()) / "mintx-system-eval-profile"), headless=True,
        channel="chromium", args=[f"--disable-extensions-except={EXT}", f"--load-extension={EXT}"])
    pg = ctx.new_page(); pg.goto("about:blank")
    while not ctx.service_workers:
        pg.wait_for_timeout(200)
    pg.goto(f"chrome-extension://{ctx.service_workers[0].url.split('/')[2]}/panel.html")
    res = pg.evaluate(JS, {"records": records, "model": MODEL})
    ctx.close()

print(f"{SET}: {len(records)} texts, {sum(len(r['spans']) for r in records)} personal values, "
      f"{sum(len(r['keep']) for r in records)} public names\n")
print(f"{'configuration':34} privacy recall  over-mask  keep public  typed F1   ms/text")
for name, m in res.items():
    keep = f"{m['keep_respected']:.3f}" if m["keep_respected"] is not None else "  -  "
    print(f"{name:34} {m['privacy_recall']:13.3f} {m['over_mask_rate']:10.3f} {keep:>12} {m['typed_partial_f1']:9.3f} {m['ms_per_text']:9.0f}")

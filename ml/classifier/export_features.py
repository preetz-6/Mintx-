"""Export one row per fused candidate, computed by the real engine inside the extension
(rules + secrets + linguistic NER + fine-tuned transformer), for training the decision classifier.

    python ml/classifier/export_features.py      # ~15 min, writes ml/classifier/features/*.jsonl

Label = 1 if the candidate overlaps a gold personal value, else 0. The classifier is trained on the
*validation* split: the transformer was fit on the training split, so its scores there are
over-confident and would teach the classifier to trust it too much (a standard stacking precaution).
"""
import json, random, sys, tempfile, time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
EXT = ROOT / "assistant"
DATA = ROOT / "ml/data/processed"
OUT = Path(__file__).resolve().parent / "features"
MODEL = sys.argv[sys.argv.index("--model") + 1] if "--model" in sys.argv else "Preetm-666/mintx-pii-distilbert"
SPLITS = {"val": None, "test_synthetic": None, "test_realistic": None, "test_ai4privacy": 600}

JS = """async ({ records, model }) => {
  const { analyze } = await import(chrome.runtime.getURL('pii/engine.js'));
  const { detectNeural } = await import(chrome.runtime.getURL('pii/neural.js'));
  const rows = [];
  for (const r of records) {
    const res = await analyze(r.text, { layers: { rules: true, secrets: true, nlp: true, neural: true },
      neural: t => detectNeural(t, null, model), nlp: globalThis.nlp, returnFeatures: true, threshold: 0 });
    const ov = (a, b) => a.start < b.end && b.start < a.end;
    for (const e of res.fused) rows.push({ id: r.id, source: r.source, start: e.start, end: e.end, text: e.text, type: e.type,
      fused: e.score, x: e.features, y: +r.spans.some(g => ov(e, g)), keep: +r.keep.some(k => ov(e, k)) });
  }
  return rows;
}"""


def main():
    OUT.mkdir(exist_ok=True)
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(str(Path(tempfile.gettempdir()) / "mintx-system-eval-profile"), headless=True,
            channel="chromium", args=[f"--disable-extensions-except={EXT}", f"--load-extension={EXT}"])
        pg = ctx.new_page(); pg.goto("about:blank")
        while not ctx.service_workers:
            pg.wait_for_timeout(200)
        pg.goto(f"chrome-extension://{ctx.service_workers[0].url.split('/')[2]}/panel.html")
        names = pg.evaluate("async () => (await import(chrome.runtime.getURL('pii/classifier.js'))).FEATURE_NAMES")
        (OUT / "feature_names.json").write_text(json.dumps(names), encoding="utf-8")
        for split, limit in SPLITS.items():
            records = [json.loads(l) for l in open(DATA / f"{split}.jsonl", encoding="utf-8")]
            if limit:
                records = random.Random(0).sample(records, limit)
            rows, t0 = [], time.time()
            for i in range(0, len(records), 150):
                rows += pg.evaluate(JS, {"records": records[i:i + 150], "model": MODEL})
                print(f"  {split}: {min(i + 150, len(records))}/{len(records)} texts, {len(rows)} candidates", flush=True)
            with open(OUT / f"{split}.jsonl", "w", encoding="utf-8") as f:
                for row in rows:
                    f.write(json.dumps(row, ensure_ascii=False) + "\n")
            pos = sum(r["y"] for r in rows)
            print(f"{split}: {len(rows)} candidates ({pos} PII, {len(rows) - pos} not) in {time.time() - t0:.0f}s", flush=True)
        ctx.close()


if __name__ == "__main__":
    main()

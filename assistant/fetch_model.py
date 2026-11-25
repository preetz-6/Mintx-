"""Download the transformer NER models into assistant/models/ for offline use.

Without this, the extension downloads a model from the Hugging Face Hub the first time it is
used (66 MB for the fine-tuned Mintx model, 109 MB for the generic BERT) and caches it in the
browser. Run from the project root:

    python assistant/fetch_model.py                      # both models
    python assistant/fetch_model.py Preetm-666/mintx-pii-distilbert
"""
import sys
from pathlib import Path

import httpx

MODELS = sys.argv[1:] or ["Preetm-666/mintx-pii-distilbert", "Xenova/bert-base-NER"]
FILES = ["config.json", "tokenizer.json", "tokenizer_config.json", "onnx/model_quantized.onnx"]

for model in MODELS:
    target = Path(__file__).resolve().parent / "models" / model
    for name in FILES:
        path = target / name
        if path.exists():
            print("exists ", model, name)
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        url = f"https://huggingface.co/{model}/resolve/main/{name}"
        with httpx.stream("GET", url, follow_redirects=True, timeout=120) as r:
            r.raise_for_status()
            tmp = path.with_suffix(path.suffix + ".part")
            with tmp.open("wb") as f:
                for chunk in r.iter_bytes(1 << 20):
                    f.write(chunk)
            tmp.rename(path)
        print("fetched", model, name, f"{path.stat().st_size / 1e6:.1f} MB")
print("Reload the extension; the transformer layer now runs fully offline.")

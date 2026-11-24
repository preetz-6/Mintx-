"""Download the transformer NER weights into assistant/models/ for offline use.

Without this, the extension downloads the model from the Hugging Face Hub on first use
(about 109 MB) and caches it in the browser. Run from the project root:

    python assistant/fetch_model.py
"""
from pathlib import Path

import httpx

MODEL = "Xenova/bert-base-NER"
FILES = ["config.json", "tokenizer.json", "tokenizer_config.json", "onnx/model_quantized.onnx"]
target = Path(__file__).resolve().parent / "models" / MODEL

for name in FILES:
    path = target / name
    if path.exists():
        print("exists ", name)
        continue
    path.parent.mkdir(parents=True, exist_ok=True)
    url = f"https://huggingface.co/{MODEL}/resolve/main/{name}"
    with httpx.stream("GET", url, follow_redirects=True, timeout=120) as r:
        r.raise_for_status()
        tmp = path.with_suffix(path.suffix + ".part")
        with tmp.open("wb") as f:
            for chunk in r.iter_bytes(1 << 20):
                f.write(chunk)
        tmp.rename(path)
    print("fetched", name, f"{path.stat().st_size / 1e6:.1f} MB")
print("Reload the extension; the NER layer now runs fully offline.")

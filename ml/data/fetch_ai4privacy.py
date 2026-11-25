"""Download a random English sample of ai4privacy/pii-masking-openpii-1.5m.

The full dataset is 5.3 GB, so this pages through the Hugging Face dataset-viewer API
(100 rows per request) at random offsets instead. Results are cached in ml/data/raw/ and
the script resumes where it stopped.

    python ml/data/fetch_ai4privacy.py            # 22k train rows + 3k validation rows

Dataset: Ai4Privacy / Ai Suisse SA, OpenPII 1.5M, CC-BY-4.0.
https://huggingface.co/datasets/ai4privacy/pii-masking-openpii-1.5m
"""
from __future__ import annotations

import json
import random
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import httpx

DATASET = "ai4privacy/pii-masking-openpii-1.5m"
API = "https://datasets-server.huggingface.co/filter"
RAW = Path(__file__).resolve().parent / "raw"
PAGE = 100
PLAN = {"train": 220, "validation": 30}   # pages per split → 22,000 and 3,000 rows
KEEP = ("uid", "source_text", "privacy_mask", "region", "language")


def total_rows(client: httpx.Client, split: str) -> int:
    r = client.get(API, params={"dataset": DATASET, "config": "default", "split": split,
                                "where": "\"language\"='en'", "offset": 0, "length": 1}, timeout=60)
    r.raise_for_status()
    return r.json()["num_rows_total"]


def fetch_page(client: httpx.Client, split: str, offset: int) -> list[dict]:
    for attempt in range(6):
        try:
            r = client.get(API, params={"dataset": DATASET, "config": "default", "split": split,
                                        "where": "\"language\"='en'", "offset": offset, "length": PAGE}, timeout=120)
            if r.status_code == 200:
                return [{k: row["row"][k] for k in KEEP} for row in r.json()["rows"]]
        except httpx.HTTPError:
            pass
        time.sleep(2 ** attempt)
    raise RuntimeError(f"page {split}@{offset} failed after retries")


def main():
    RAW.mkdir(parents=True, exist_ok=True)
    rng = random.Random(1337)
    with httpx.Client(headers={"User-Agent": "mintx-dataset-builder"}) as client:
        for split, pages in PLAN.items():
            out = RAW / f"ai4privacy_{split}.jsonl"
            done_file = RAW / f"ai4privacy_{split}.offsets"
            done = set(map(int, done_file.read_text().split())) if done_file.exists() else set()
            n = total_rows(client, split)
            offsets = sorted(rng.sample(range(0, n - PAGE, PAGE), pages))
            todo = [o for o in offsets if o not in done]
            print(f"{split}: {n:,} English rows, fetching {len(todo)} of {pages} pages", flush=True)
            with ThreadPoolExecutor(max_workers=4) as pool, out.open("a", encoding="utf-8") as f, \
                    done_file.open("a") as log:
                futures = {pool.submit(fetch_page, client, split, o): o for o in todo}
                for i, fut in enumerate(as_completed(futures), 1):
                    rows = fut.result()
                    for row in rows:
                        f.write(json.dumps(row, ensure_ascii=False) + "\n")
                    log.write(f"{futures[fut]}\n"); log.flush(); f.flush()
                    if i % 10 == 0 or i == len(todo):
                        print(f"  {split}: {i}/{len(todo)} pages", flush=True)
    print("done", file=sys.stderr)


if __name__ == "__main__":
    main()

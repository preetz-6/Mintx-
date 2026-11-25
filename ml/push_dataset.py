"""Upload the built dataset (ml/data/processed) to the Hugging Face Hub so notebooks can load it.

    $env:HF_TOKEN = "<your write token>"            # PowerShell; never commit or share the token
    python ml/push_dataset.py --repo <hf-username>/mintx-pii [--private]

The token is read from the HF_TOKEN environment variable only.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from huggingface_hub import HfApi

HERE = Path(__file__).resolve().parent
PROCESSED = HERE / "data" / "processed"
FILES = ["train.jsonl", "val.jsonl", "test_synthetic.jsonl", "test_ai4privacy.jsonl", "test_realistic.jsonl", "label_map.json"]

CARD = """---
license: cc-by-4.0
language: [en]
task_categories: [token-classification]
tags: [pii, privacy, ner, india, synthetic]
pretty_name: Mintx PII
configs:
- config_name: default
  data_files:
  - {{split: train, path: train.jsonl}}
  - {{split: validation, path: val.jsonl}}
  - {{split: test_synthetic, path: test_synthetic.jsonl}}
  - {{split: test_ai4privacy, path: test_ai4privacy.jsonl}}
  - {{split: test_realistic, path: test_realistic.jsonl}}
---

# Mintx PII dataset

Character-span labelled text for detecting personal data (PII) in web pages, built for the
[Mintx Assistant](https://github.com/preetz-6/Mintx-) browser extension. All personal data is synthetic.

- **13 labels:** {labels}
- **`spans`**: values to mask. **`keep`**: public entities (countries, large organizations, public figures) that must stay visible. They are explicit negatives.
- **Sources:** a template generator with checksum-valid Indian and global identifiers; a relabelled sample of
  *OpenPII 1.5M*; and a small hand-checked realistic test set.

{stats}

## Labelling policy

{policy}
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True, help="e.g. your-username/mintx-pii")
    ap.add_argument("--private", action="store_true")
    ap.add_argument("--dry-run", action="store_true", help="print the dataset card and stop")
    args = ap.parse_args()
    token = os.environ.get("HF_TOKEN")
    if not token and not args.dry_run:
        sys.exit("Set HF_TOKEN to a Hugging Face write token first.")
    missing = [f for f in FILES if not (PROCESSED / f).exists()]
    if missing:
        sys.exit(f"Missing {missing}. Run ml/data/build.py first.")

    from common import LABELS
    stats = (HERE / "data" / "stats.md").read_text(encoding="utf-8").split("\n", 2)[2]
    policy = (HERE / "data" / "labeling_policy.md").read_text(encoding="utf-8").split("\n", 2)[2]
    card = CARD.format(labels=", ".join(f"`{l}`" for l in LABELS), stats=stats, policy=policy)
    if args.dry_run:
        print(card)
        return

    api = HfApi(token=token)
    api.create_repo(args.repo, repo_type="dataset", private=args.private, exist_ok=True)
    for f in FILES:
        print("uploading", f)
        api.upload_file(path_or_fileobj=str(PROCESSED / f), path_in_repo=f, repo_id=args.repo, repo_type="dataset")
    api.upload_file(path_or_fileobj=card.encode(), path_in_repo="README.md", repo_id=args.repo, repo_type="dataset")
    print(f"done: https://huggingface.co/datasets/{args.repo}")


if __name__ == "__main__":
    sys.path.insert(0, str(HERE))
    sys.path.insert(0, str(HERE / "data"))
    main()

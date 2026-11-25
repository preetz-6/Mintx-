# Mintx ML

Training data and models for the Mintx privacy layer.

| Step | Status | What |
| --- | --- | --- |
| 1. Dataset | ✅ done | Labelled PII dataset: synthetic generator + relabelled ai4privacy + hand-checked realistic set |
| 2. Learned classifier | next | "Mask or keep?" model on top of the four detection layers |
| 3. Fine-tuned transformer | ✅ done | DistilBERT fine-tuned for PII token classification (Kaggle GPU), hosted on Hugging Face, run in the browser. See [`train_ner.ipynb`](train_ner.ipynb), [`TRAINING.md`](TRAINING.md), [results](results/mintx-pii-distilbert/) and the model on [Hugging Face](https://huggingface.co/Preetm-666/mintx-pii-distilbert) |
| 4. Feedback loop | planned | Share/Protect clicks become new training labels |
| 5. LLM judge | planned | Re-identification risk and answer-quality evaluation |

## Step 1: dataset

```bash
python -m pip install -r ml/requirements.txt
python ml/data/fetch_ai4privacy.py   # ~15 min, downloads a 25k-row English sample (cached, resumable)
python ml/data/build.py              # ~30 s, writes ml/data/processed/ and ml/data/stats.md
```

| File | What it is |
| --- | --- |
| `data/labeling_policy.md` | What counts as personal data and what stays visible; how ai4privacy labels are mapped |
| `data/public_entities.json` | Countries, states, large organizations and public figures that are kept visible |
| `data/fakers.py` | Fake-value generators: checksum-valid Aadhaar (Verhoeff), cards (Luhn), IBAN (mod-97), PAN, UPI, secrets… |
| `data/templates.py` | 120 sentence templates across 10 domains, with public entities and look-alike numbers as hard negatives |
| `data/generate.py` | Renders templates into examples with exact character spans |
| `data/relabel.py` | Weak supervision: converts ai4privacy labels to the Mintx policy (merging names and address parts, detecting birth dates from context) |
| `data/realistic_test.txt` | 61 hand-written, hand-checked examples in the style of real pages (inbox, SMS, LinkedIn, GitHub, orders, chats) |
| `data/build.py` | Combines everything, splits, removes train/test overlap, validates every span, writes statistics |
| `data/stats.md` | Counts per file, label and domain, with sample records |

**Record format** (`processed/*.jsonl`, one JSON object per line):

```json
{"id": "syn-email-02-014", "text": "Dear Asha, …", "spans": [{"start": 5, "end": 9, "label": "PERSON"}],
 "keep": [{"start": 40, "end": 46, "kind": "organization"}], "source": "synthetic", "domain": "email",
 "template": "email-02", "split": "train"}
```

`spans` are values to mask; `keep` are public entities that must stay visible (explicit negatives).

**Why three test sets:**
- `test_synthetic`: templates never seen in training. Checks that the model learned patterns rather than memorizing templates.
- `test_ai4privacy`: the ai4privacy validation split, in-distribution for that source.
- `test_realistic`: hand-checked, non-template text. The closest to real browsing and the honest headline number.

The ai4privacy data is *OpenPII 1.5M* by Ai4Privacy / Ai Suisse SA, CC-BY-4.0: https://huggingface.co/datasets/ai4privacy/pii-masking-openpii-1.5m

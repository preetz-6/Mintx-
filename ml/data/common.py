"""Shared label schema, public-entity lookup and record validation for the Mintx dataset."""
from __future__ import annotations

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
LABELS = ["PERSON", "EMAIL", "PHONE", "ADDRESS", "LOCATION", "ORGANIZATION", "DATE_OF_BIRTH", "GOV_ID",
          "CREDIT_CARD", "BANK_ACCOUNT", "UPI_ID", "IP_ADDRESS", "SECRET"]
KEEP_KINDS = ["country", "region", "organization", "public_figure"]

_public = json.loads((HERE / "public_entities.json").read_text(encoding="utf-8"))
PUBLIC = {kind: _public[key] for kind, key in
          [("country", "countries"), ("region", "regions"), ("organization", "organizations"),
           ("public_figure", "public_figures")]}
_PUBLIC_LOOKUP = {v.lower(): kind for kind, values in PUBLIC.items() for v in values}


def public_kind(text: str) -> str | None:
    """Return the keep-kind of a public entity, or None if the span is not on the keep list."""
    t = text.strip().strip(".,;:!?'\"").lower()
    if t.startswith("the "):
        t = t[4:]
    return _PUBLIC_LOOKUP.get(t)


def validate(rec: dict) -> list[str]:
    """Return a list of problems with a record (empty when valid)."""
    problems = []
    text = rec["text"]
    spans = sorted(rec["spans"], key=lambda s: s["start"])
    for s in spans:
        if not (0 <= s["start"] < s["end"] <= len(text)):
            problems.append(f"span out of range {s}")
        elif not text[s["start"]:s["end"]].strip():
            problems.append(f"empty span {s}")
        elif text[s["start"]:s["end"]] != text[s["start"]:s["end"]].strip():
            problems.append(f"span has edge whitespace {s}")
        if s["label"] not in LABELS:
            problems.append(f"unknown label {s['label']}")
    for a, b in zip(spans, spans[1:]):
        if b["start"] < a["end"]:
            problems.append(f"overlap {a} {b}")
    for k in rec.get("keep", []):
        if any(k["start"] < s["end"] and k["end"] > s["start"] for s in spans):
            problems.append(f"keep overlaps a span {k}")
    return problems


def write_jsonl(path: Path, records: list[dict]):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for r in records:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")


def read_jsonl(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]

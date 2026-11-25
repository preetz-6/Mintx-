"""Render the templates into labelled examples with exact character spans."""
from __future__ import annotations

import random
import re

from common import validate
from fakers import Gen
from templates import SLOTS, TEMPLATES

SLOT_RX = re.compile(r"\{([A-Z]+)(?::([a-z]))?(\|lower)?\}")
SPLIT_OF_INDEX = {8: "val", 9: "test"}          # per-domain held-out templates


def render(template: str, gen: Gen) -> dict:
    text, spans, keep = "", [], []
    pos = 0
    for m in SLOT_RX.finditer(template):
        text += template[pos:m.start()]
        slot, key, lower = m.group(1), m.group(2) or "", m.group(3)
        method, label = SLOTS[slot]
        if method.startswith("person_"):
            value = gen.person(key)[method.split("_")[1]]
        elif slot in ("EMAIL", "UPI") and key:
            value = getattr(gen, method)(gen.person(key))
        else:
            value = getattr(gen, method)()
        value = " ".join(value.split(" ")).strip()   # some Faker values carry stray whitespace
        if lower:
            value = value.lower()
        start = len(text)
        text += value
        if isinstance(label, str):
            spans.append({"start": start, "end": start + len(value), "label": label})
        elif label:
            keep.append({"start": start, "end": start + len(value), "kind": label[1]})
        pos = m.end()
    text += template[pos:]
    return {"text": text, "spans": spans, "keep": keep}


def generate(per_template: int = 65, seed: int = 7) -> list[dict]:
    rng = random.Random(seed)
    records = []
    for domain, templates in TEMPLATES.items():
        for i, template in enumerate(templates):
            split = SPLIT_OF_INDEX.get(i, "train")
            for j in range(per_template):
                rec = render(template, Gen(rng))
                rec.update(id=f"syn-{domain}-{i:02d}-{j:03d}", source="synthetic", domain=domain,
                           template=f"{domain}-{i:02d}", split=split)
                problems = validate(rec)
                if problems:
                    raise ValueError(f"{rec['id']}: {problems}")
                records.append(rec)
    return records


if __name__ == "__main__":
    recs = generate(per_template=2)
    for r in recs[:: 24][:6]:
        print("—", r["id"], r["split"])
        print(r["text"])
        print("  spans:", [(r["text"][s["start"]:s["end"]], s["label"]) for s in r["spans"]])
        print("  keep: ", [(r["text"][k["start"]:k["end"]], k["kind"]) for k in r["keep"]])

"""Relabel ai4privacy OpenPII 1.5M rows to the Mintx policy (see labeling_policy.md).

This is weak supervision: deterministic rules turn the source labels into ours, merge
fragments (given name + surname → PERSON, building + street + zip → ADDRESS), and decide
from context whether a DATE is a date of birth.
"""
from __future__ import annotations

import re

from common import PUBLIC, public_kind, validate

MAP = {"GIVENNAME": "PERSON", "SURNAME": "PERSON", "EMAIL": "EMAIL", "TELEPHONENUM": "PHONE",
       "CREDITCARDNUMBER": "CREDIT_CARD", "IDCARDNUM": "GOV_ID", "DRIVERLICENSENUM": "GOV_ID",
       "PASSPORTNUM": "GOV_ID", "SOCIALNUM": "GOV_ID", "TAXNUM": "GOV_ID",
       "STREET": "ADDRESS", "BUILDINGNUM": "ADDRESS", "ZIPCODE": "ADDRESS", "CITY": "CITY", "DATE": "DATE"}
MERGE = {("PERSON", "PERSON"): "PERSON", ("ADDRESS", "ADDRESS"): "ADDRESS",
         ("ADDRESS", "CITY"): "ADDRESS", ("CITY", "ADDRESS"): "ADDRESS"}
GAP = re.compile(r"[\s,\-–—#/.]{0,4}")
BIRTH = re.compile(r"\b(born|birth|dob|d\.o\.b|birthday|b\. ?day)\b", re.I)

# Public names found in otherwise-unlabelled text become explicit "keep" negatives.
_terms = sorted({v for vals in PUBLIC.values() for v in vals}, key=len, reverse=True)
PUBLIC_RX = re.compile(r"(?<![\w@.])(?:" + "|".join(re.escape(t) for t in _terms) + r")(?![\w@])")


def _clean(text: str, start: int, end: int) -> tuple[int, int]:
    while start < end and text[start].isspace():
        start += 1
    while end > start and text[end - 1].isspace():
        end -= 1
    return start, end


def relabel(row: dict) -> dict | None:
    text = row["source_text"]
    spans = []
    for m in sorted(row["privacy_mask"], key=lambda m: m["start"]):
        label = MAP.get(m["label"])
        if not label:
            continue
        s, e = m["start"], m["end"]
        if text[s:e] != m["value"]:                  # trust the value if offsets drift
            idx = text.find(m["value"])
            if idx < 0:
                return None
            s, e = idx, idx + len(m["value"])
        s, e = _clean(text, s, e)
        if e > s:
            spans.append({"start": s, "end": e, "label": label})

    merged: list[dict] = []
    for sp in spans:
        prev = merged[-1] if merged else None
        if prev and sp["start"] < prev["end"]:
            continue                                # drop overlapping duplicates
        if prev and (prev["label"], sp["label"]) in MERGE and GAP.fullmatch(text[prev["end"]:sp["start"]]):
            prev["end"] = sp["end"]
            prev["label"] = MERGE[(prev["label"], sp["label"])]
            continue
        merged.append(dict(sp))

    out, keep = [], []
    for sp in merged:
        value = text[sp["start"]:sp["end"]]
        if sp["label"] == "CITY":
            kind = public_kind(value)
            if kind:
                keep.append({"start": sp["start"], "end": sp["end"], "kind": kind})
                continue
            sp["label"] = "LOCATION"
        elif sp["label"] == "DATE":
            if not BIRTH.search(text[max(0, sp["start"] - 40):sp["start"]]):
                continue
            sp["label"] = "DATE_OF_BIRTH"
        out.append(sp)

    for m in PUBLIC_RX.finditer(text):
        s, e = m.span()
        if not any(s < x["end"] and e > x["start"] for x in out + keep):
            kind = public_kind(m.group())
            # Two-letter codes only count when written in capitals ("IN", not "in").
            if kind and (len(m.group()) > 2 or m.group().isupper()):
                keep.append({"start": s, "end": e, "kind": kind})

    rec = {"id": f"a4p-{row['uid']}", "text": text, "spans": out, "keep": sorted(keep, key=lambda k: k["start"]),
           "source": "ai4privacy", "domain": f"ai4privacy-{row.get('region', '')}", "template": None}
    return rec if not validate(rec) else None

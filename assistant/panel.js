// Mintx side panel: chat UI + orchestration of the local privacy pipeline.
//   read page → detect (4 layers) → fuse → pseudonymize → [review] → model → restore
import { analyze, LAYERS, POLICIES, normalize } from "./pii/engine.js";
import { Vault } from "./pii/vault.js";
import { detectNeural } from "./pii/neural.js";
import { NER_MODELS } from "./pii/neural-core.js";
import { CLASSIFIER } from "./pii/classifier-model.js";
import { renderMarkdown } from "./markdown.js";

const $ = id => document.getElementById(id);
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") el.className = v; else if (k.startsWith("on")) el[k] = v;
    else if (v !== false && v != null) el.setAttribute(k, v === true ? "" : v);
  }
  el.append(...kids.flat().filter(k => k != null && k !== false));
  return el;
};

const SEP = "\n␞\n";   // separates question / title / page so one analysis pass covers all three
const DEFAULTS = { policy: "balanced", strategy: "tag", nerChoice: "custom", nerModelId: NER_MODELS.mintx.id, learned: true,
  layers: { rules: true, secrets: true, nlp: true, neural: true },
  maxChars: 8000, server: "http://127.0.0.1:8765" };
const STEPS = [["extract", "Read page"], ...LAYERS.map(l => [l.id, l.name]), ["fusion", "Ensemble fusion"],
  ["vault", "Pseudonymize"], ["model", "Model"], ["restore", "Restore locally"]];
const SOURCE_LABEL = { rules: "rules", secrets: "entropy", nlp: "nlp", neural: "bert", linking: "linked", propagation: "repeat" };
// The fine-tuned model is used only once its Hugging Face id is set; otherwise the generic BERT.
const customModel = () => settings.nerChoice === "custom" && settings.nerModelId.trim();
const nerModel = () => customModel() || NER_MODELS.generic.id;
const testTab = Number(new URLSearchParams(location.search).get("tab")) || null;

let settings = structuredClone(DEFAULTS);
let convo = { history: [], vault: null, allow: [] };
let vault = new Vault();
let busy = false;
const welcome = $("welcome").cloneNode(true);

// ---------------------------------------------------------------------------------------
async function boot() {
  const stored = (await chrome.storage.local.get("settings")).settings || {};
  settings = { ...DEFAULTS, ...stored, layers: { ...DEFAULTS.layers, ...stored.layers } };
  convo = (await chrome.storage.session.get("convo")).convo || convo;
  vault = Vault.from(convo.vault || { strategy: settings.strategy });
  for (let i = 0; i < convo.history.length; i += 2) {
    $("welcome")?.remove();
    userBubble(vault.restore(convo.history[i].content));
    if (convo.history[i + 1]) renderAssistant(assistantBubble(), convo.history[i + 1].content);
  }
  wireWelcome(document);
  updatePolicyLabel();
  checkServer();
  const pending = (await chrome.storage.session.get("pending")).pending;
  if (pending && Date.now() - pending.at < 10000) consumePending(pending);
}

async function checkServer() {
  const pill = $("status");
  try {
    const r = await fetch(settings.server + "/health", { signal: AbortSignal.timeout(4000) });
    const j = await r.json();
    pill.textContent = j.mode === "dummy" ? "Dummy model" : j.model;
    pill.className = "pill ok";
    pill.title = `Server egress guard checks: ${j.guard.join(", ")}`;
  } catch {
    pill.textContent = "Server offline"; pill.className = "pill bad";
    pill.title = `Start the server: python -m uvicorn server:app --port 8765 (${settings.server})`;
  }
}

// Decision cut-off: the classifier's own calibrated thresholds (chosen on validation data),
// or the fixed fused-confidence thresholds when the learned decision is switched off.
const cutoff = (learned = settings.learned) => learned ? CLASSIFIER.policies[settings.policy] : POLICIES[settings.policy];
function showCuts() {
  const learned = $("learned").checked;
  for (const el of document.querySelectorAll(".cut"))
    el.textContent = `· mask at ${learned ? "p" : "confidence"} ≥ ${(learned ? CLASSIFIER.policies : POLICIES)[el.dataset.policy]}`;
}
const save = () => chrome.storage.session.set({ convo: { ...convo, vault: vault.toJSON() } });
const scrollDown = () => $("log").scrollTo({ top: $("log").scrollHeight });
function updatePolicyLabel() {
  const on = LAYERS.filter(l => settings.layers[l.id]).length;
  SOURCE_LABEL.neural = customModel() ? "mintx-ner" : "bert";
  $("policyLabel").textContent = `${settings.policy} · ${on}/${LAYERS.length} layers${customModel() && settings.layers.neural ? " · fine-tuned" : ""}${settings.learned ? " · learned" : ""}`;
}

// --- Page access ---------------------------------------------------------------------
async function targetTab() {
  if (testTab) return chrome.tabs.get(testTab);
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

async function extractPage() {
  const tab = await targetTab();
  if (!tab || !/^(https?|file):/.test(tab.url || "")) throw new Error("browser pages can’t be read");
  const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["extract.js"] });
  if (!res?.result) throw new Error("no content returned");
  return { ...res.result, tabId: tab.id };
}

function contextOf(p) {
  const parts = [];
  if (p.selection) parts.push("Selected text:\n" + p.selection);
  if (p.fields.length) parts.push("Form fields:\n" + p.fields.map(f => `- ${f.label}: ${f.value}`).join("\n"));
  parts.push("Page text:\n" + p.text);
  let s = parts.join("\n\n");
  if (s.length > settings.maxChars) {
    const cut = Math.max(s.lastIndexOf("\n", settings.maxChars), s.lastIndexOf(" ", settings.maxChars));
    s = s.slice(0, cut > 0 ? cut : settings.maxChars) + "\n[…truncated]";   // never split a value in half
  }
  return s;
}

function highlightOnPage(values) {
  if (!globalThis.CSS?.highlights) return 0;
  const ranges = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode, t = node.nodeValue;
    for (const v of values) for (let i = t.indexOf(v); i !== -1; i = t.indexOf(v, i + v.length)) {
      const r = new Range(); r.setStart(node, i); r.setEnd(node, i + v.length); ranges.push(r);
    }
  }
  CSS.highlights.set("mintx-pii", new Highlight(...ranges));
  if (!document.getElementById("mintx-pii-style")) {
    const s = document.createElement("style"); s.id = "mintx-pii-style";
    s.textContent = "::highlight(mintx-pii){background-color:rgba(255,190,0,.6);color:inherit}";
    document.head.append(s);
  }
  ranges[0]?.startContainer.parentElement?.scrollIntoView({ block: "center", behavior: "smooth" });
  clearTimeout(globalThis.__mintxClear);
  globalThis.__mintxClear = setTimeout(() => CSS.highlights.delete("mintx-pii"), 10000);
  return ranges.length;
}

// --- Chat bubbles -----------------------------------------------------------------------
function userBubble(text) {
  const b = h("div", { class: "msg user" }, h("div", { class: "bubble" }, text));
  $("log").append(b); scrollDown(); return b;
}
function assistantBubble() {
  const body = h("div", { class: "bubble md" }, h("span", { class: "typing" }, h("i"), h("i"), h("i")));
  const foot = h("div", { class: "foot" });
  const b = h("div", { class: "msg bot" }, body, foot);
  $("log").append(b); scrollDown();
  return { body, foot };
}
function renderAssistant(target, raw) {
  const marks = [];
  const text = vault.rehydrate(raw).map(p => {
    if (!p.entry) return p.text;
    marks.push({ text: p.text, type: p.entry.type, token: p.entry.token });
    return `${marks.length - 1}`;
  }).join("");
  target.body.innerHTML = renderMarkdown(text, marks) || "";
  return marks.length;
}
function errorBubble(msg) { $("log").append(h("div", { class: "msg error" }, msg)); scrollDown(); }

// --- Privacy card -----------------------------------------------------------------------
function shieldCard() {
  const steps = new Map();
  const list = h("ol", { class: "pipeline" }, STEPS.map(([id, label]) => {
    const info = h("small");
    const li = h("li", { "data-state": "pending", title: LAYERS.find(l => l.id === id)?.detail || "" }, h("span", { class: "dot" }), h("span", {}, label), info);
    if (LAYERS.some(l => l.id === id) && !settings.layers[id]) li.dataset.state = "off", info.textContent = "off";
    steps.set(id, { li, info });
    return li;
  }));
  const title = h("b", {}, "Protecting your data…");
  const meta = h("span", { class: "meta" });
  const entities = h("div", { class: "entities" });
  const notes = h("div", { class: "notes" });
  const preview = h("pre", { class: "preview", hidden: true });
  const actions = h("div", { class: "actions" });
  const el = h("details", { class: "shield", open: true },
    h("summary", {}, h("span", { class: "shield-icon", "aria-hidden": "true" }), title, meta),
    list, notes, entities, actions, preview);
  $("log").append(el); scrollDown();
  return {
    el, title, meta, entities, actions, preview, notes,
    step(id, state, info = "") {
      const s = steps.get(id); if (!s) return;
      if (s.li.dataset.state === "off") return;
      s.li.dataset.state = state; s.info.textContent = info;
    },
    note(text, cls = "") { notes.append(h("p", { class: cls }, text)); },
  };
}

function entityRows(card, result, used, allow, interactive, onToggle) {
  card.entities.replaceChildren();
  const byToken = new Map();
  for (const e of result.entities) {
    const entry = vault.entry(e.type, e.text, e.canonical);
    const row = byToken.get(entry.token) || { entry, score: 0, sources: new Set(), reasons: new Set(), count: 0, key: normalize(e.type, e.canonical || e.text) };
    row.score = Math.max(row.score, e.score); row.count++;
    e.sources.forEach(s => row.sources.add(s)); e.reasons.forEach(r => row.reasons.add(r));
    byToken.set(entry.token, row);
  }
  if (!byToken.size) { card.entities.append(h("p", { class: "muted" }, "No personal data detected.")); return; }
  const table = h("div", { class: "rows" });
  for (const row of [...byToken.values()].sort((a, b) => b.score - a.score)) {
    const kept = allow.has(row.key);
    const r = h("div", { class: "row" + (kept ? " kept" : ""), title: [...row.reasons].join("\n") },
      h("code", { class: "token" }, row.entry.surrogate || row.entry.token),
      h("span", { class: "value" }, row.entry.value, row.count > 1 ? h("small", {}, ` ×${row.count}`) : null),
      h("span", { class: "conf", title: "Fused confidence" }, h("span", { class: "bar" }, h("i", { style: `width:${Math.round(row.score * 100)}%` })),
        h("em", {}, Math.round(row.score * 100) + "%")),
      h("span", { class: "srcs" }, [...row.sources].map(s => h("span", { class: "src " + s }, SOURCE_LABEL[s] || s))),
      interactive ? h("button", { type: "button", class: "keep", onclick: () => onToggle(row.key) }, kept ? "Protect" : "Share") : null);
    table.append(r);
  }
  card.entities.append(table);
  if (result.belowThreshold.length) {
    card.entities.append(h("details", { class: "low" }, h("summary", {}, `${result.belowThreshold.length} low-confidence candidate(s) left unmasked`),
      h("ul", {}, result.belowThreshold.map(e => h("li", {}, `${e.text} — ${e.type} ${Math.round(e.score * 100)}%`)))));
  }
}

const sha256 = async s => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))]
  .map(b => b.toString(16).padStart(2, "0")).join("");

// --- Main flow --------------------------------------------------------------------------
async function ask(question) {
  question = question.trim();
  if (busy || !question) return;
  busy = true; $("send").disabled = true; $("input").value = "";
  $("welcome")?.remove();
  userBubble(question);
  const card = shieldCard();
  const t0 = performance.now();
  try {
    // 1. Read the page (only now, only the active tab).
    let page = null;
    if ($("usePage").checked) {
      card.step("extract", "running");
      try {
        page = await extractPage();
        card.step("extract", "done", `${(page.text.length + page.selection.length).toLocaleString()} chars, ${page.fields.length} fields`);
      } catch (e) {
        card.step("extract", "error", "skipped");
        card.note(`Couldn’t read this tab (${e.message}). Answering without page context.`, "warn");
      }
    } else card.step("extract", "off", "off");

    // 2. Detect with every enabled layer, then fuse.
    const combined = [question, page?.title || "", page ? contextOf(page) : ""].join(SEP);
    const neural = settings.layers.neural ? text => detectNeural(text, p => card.step("neural", "running", `downloading model ${Math.round(p)}%`), nerModel()) : null;
    const result = await analyze(combined, {
      layers: settings.layers, threshold: cutoff(), neural, classifier: settings.learned ? CLASSIFIER : null,
      onLayer: (id, state, info) => card.step(id, state, state === "done" ? `${info} candidate${info === 1 ? "" : "s"}` : state === "error" ? "unavailable" : ""),
    });
    for (const [id, msg] of Object.entries(result.errors)) card.note(`${LAYERS.find(l => l.id === id).name} unavailable: ${msg}`, "warn");
    for (const [id, ms] of Object.entries(result.timings)) if (id !== "fusion" && !result.errors[id]) card.step(id, "done", `${result.counts[id] ?? 0} found · ${ms} ms`);
    card.step("fusion", "done", `${result.candidates} → ${result.entities.length} spans`);

    // 3. Pseudonymize (optionally let the user review and choose what to share).
    const allow = new Set(convo.allow);
    let prep;
    const prepare = () => {
      const ents = result.entities.filter(e => !allow.has(normalize(e.type, e.canonical || e.text)));
      const { text, used } = vault.sanitize(combined, ents);
      const [q, title, ctx] = text.split(SEP);
      prep = { q, title, ctx, used, kept: result.entities.filter(e => !ents.includes(e)) };
      card.step("vault", "done", `${used.length} placeholder${used.length === 1 ? "" : "s"}`);
      card.title.textContent = used.length ? `Protected ${used.length} value${used.length === 1 ? "" : "s"}` : "No personal data found";
      card.meta.textContent = `${Math.round(performance.now() - t0)} ms on device`;
      card.preview.textContent = (page ? `<page title="${prep.title}" site="${page.site}">\n${prep.ctx}\n</page>\n\n` : "") + "Question: " + prep.q;
    };
    const reviewing = $("review").checked;
    const toggle = key => { allow.has(key) ? allow.delete(key) : allow.add(key); prepare(); entityRows(card, result, prep.used, allow, true, toggle); };
    prepare();
    entityRows(card, result, prep.used, allow, reviewing, toggle);
    card.actions.append(
      h("button", { type: "button", onclick: () => { card.preview.hidden = !card.preview.hidden; } }, "What the model sees"),
      page ? h("button", { type: "button", onclick: () => chrome.scripting.executeScript({ target: { tabId: page.tabId }, func: highlightOnPage,
        args: [[...new Set(result.entities.map(e => e.text))]] }) }, "Show on page") : null);

    if (reviewing) {
      card.preview.hidden = false;
      card.step("model", "running", "waiting for your review");
      const go = await new Promise(resolve => {
        const bar = h("div", { class: "review" },
          h("span", {}, "Click Share on anything you are happy to reveal."),
          h("button", { type: "button", class: "ghost", onclick: () => { bar.remove(); resolve(false); } }, "Cancel"),
          h("button", { type: "button", class: "primary", onclick: () => { bar.remove(); resolve(true); } }, "Send to model"));
        card.el.append(bar); scrollDown();
      });
      entityRows(card, result, prep.used, allow, false);
      if (!go) { card.step("model", "off", "cancelled"); return; }
      convo.allow = [...allow];
    }

    // 4. Call the model with sanitized text only.
    card.step("model", "running", "waiting…");
    card.el.open = false;
    const body = {
      messages: [...convo.history, { role: "user", content: prep.q }],
      page: page ? { title: prep.title, site: page.site, text: prep.ctx } : null,
      placeholders: vault.entries.flatMap(e => [e.token, e.surrogate].filter(Boolean)),
      approved: await Promise.all([...new Set(prep.kept.map(e => e.text))].map(sha256)),
    };
    const tModel = performance.now();
    const res = await fetch(settings.server + "/chat", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body), credentials: "omit", signal: AbortSignal.timeout(300000) });
    if (!res.ok) {
      const detail = (await res.json().catch(() => ({}))).detail;
      card.step("model", "error", detail?.blocked ? "blocked by server guard" : `HTTP ${res.status}`);
      card.el.open = true;
      if (detail?.blocked) card.note(`Server egress guard blocked this request: unmasked ${detail.blocked.join(", ")}. A local layer is probably switched off. Nothing reached the model.`, "bad");
      throw new Error(detail?.blocked ? "Blocked before reaching the model." : `Server error ${res.status}`);
    }
    const target = assistantBubble();
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let raw = "", frame = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      raw += value;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { renderAssistant(target, raw); scrollDown(); });
    }
    cancelAnimationFrame(frame);
    const restored = renderAssistant(target, raw);
    const secs = ((performance.now() - tModel) / 1000).toFixed(1);
    card.step("model", "done", `${secs} s`);
    card.step("restore", "done", `${restored} value${restored === 1 ? "" : "s"}`);
    target.foot.textContent = `${restored} value${restored === 1 ? "" : "s"} restored on your device · ${secs} s`;
    convo.history.push({ role: "user", content: prep.q }, { role: "assistant", content: raw || "(empty reply)" });
    convo.history = convo.history.slice(-20);
    await save();
  } catch (e) {
    errorBubble(e.name === "TimeoutError" ? "The model took too long to answer." : e.message);
  } finally {
    busy = false; $("send").disabled = false; scrollDown();
  }
}

// --- Wiring -------------------------------------------------------------------------------
function wireWelcome(root) {
  for (const b of root.querySelectorAll("[data-q]")) b.onclick = () => ask(b.dataset.q);
}
function consumePending(p) {
  chrome.storage.session.remove("pending");
  $("usePage").checked = true;
  ask(p.prompt);
}
chrome.storage.session.onChanged.addListener(ch => { if (ch.pending?.newValue) consumePending(ch.pending.newValue); });

$("composer").onsubmit = e => { e.preventDefault(); ask($("input").value); };
$("input").onkeydown = e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask($("input").value); } };
$("newChat").onclick = async () => {
  if (busy) return;
  convo = { history: [], vault: null, allow: [] };
  vault = new Vault(settings.strategy);
  await save();
  const w = welcome.cloneNode(true);
  $("log").replaceChildren(w); wireWelcome(w);
};

$("openSettings").onclick = () => {
  $("layerList").replaceChildren(...LAYERS.map(l => h("label", { class: "row" },
    h("input", { type: "checkbox", name: "layer", value: l.id, checked: settings.layers[l.id] }),
    h("span", {}, h("b", {}, l.name), h("br"), h("small", {}, l.detail)))));
  for (const r of document.querySelectorAll("input[name=policy]")) r.checked = r.value === settings.policy;
  $("learned").checked = settings.learned; showCuts();
  $("learned").onchange = showCuts;
  for (const r of document.querySelectorAll("input[name=strategy]")) r.checked = r.value === settings.strategy;
  for (const r of document.querySelectorAll("input[name=nerChoice]")) r.checked = r.value === settings.nerChoice;
  $("nerModelId").value = settings.nerModelId;
  $("maxChars").value = settings.maxChars; $("server").value = settings.server;
  $("settings").showModal();
};
$("settings").onclose = async () => {
  for (const c of document.querySelectorAll("input[name=layer]")) settings.layers[c.value] = c.checked;
  settings.policy = document.querySelector("input[name=policy]:checked")?.value || "balanced";
  settings.learned = $("learned").checked;
  settings.strategy = document.querySelector("input[name=strategy]:checked")?.value || "tag";
  settings.nerChoice = document.querySelector("input[name=nerChoice]:checked")?.value || "generic";
  settings.nerModelId = $("nerModelId").value.trim();
  settings.maxChars = Math.min(30000, Math.max(1000, +$("maxChars").value || DEFAULTS.maxChars));
  settings.server = ($("server").value || DEFAULTS.server).replace(/\/+$/, "");
  if (!convo.history.length) vault = new Vault(settings.strategy);
  await chrome.storage.local.set({ settings });
  updatePolicyLabel(); checkServer();
};

boot();

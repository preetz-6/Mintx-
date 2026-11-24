// Reversible pseudonymization. Each real value gets a stable stand-in for the whole
// conversation; the mapping never leaves the device and is used to restore the model's reply.
import { normalize } from "./engine.js";

const SURROGATES = {
  PERSON: ["Alex Morgan", "Jordan Blake", "Sam Carter", "Taylor Reed", "Riley Quinn", "Casey Hart", "Morgan Ellis", "Jamie Fox"],
  LOCATION: ["Springfield", "Riverton", "Lakeside", "Fairview", "Hillcrest", "Brookfield"],
  ORGANIZATION: ["Acme Corp", "Globex", "Initech", "Hooli", "Vandelay Industries", "Wonka Labs"],
};
const pad = (n, w) => String(n).padStart(w, "0");
function surrogateFor(type, n) {
  const list = SURROGATES[type];
  if (list) return n <= list.length ? list[n - 1] : `${list[(n - 1) % list.length]} ${n}`;
  if (type === "EMAIL") return `user${n}@example.com`;
  if (type === "PHONE") return `+1-555-01${pad(n, 2)}`;
  return null; // identifiers and secrets keep explicit tags
}

export class Vault {
  constructor(strategy = "tag", entries = []) {
    this.strategy = strategy;
    this.entries = entries;
  }
  static from(json) { return new Vault(json?.strategy, json?.entries || []); }
  toJSON() { return { strategy: this.strategy, entries: this.entries }; }

  entry(type, value, canonical, avoid = "") {
    const key = normalize(type, canonical || value);
    let e = this.entries.find(x => x.key === key);
    if (e) return e;
    const n = this.entries.filter(x => x.type === type).length + 1;
    let surrogate = this.strategy === "synthetic" ? surrogateFor(type, n) : null;
    if (surrogate && (avoid.includes(surrogate) || this.entries.some(x => x.surrogate === surrogate))) surrogate = null;
    e = { token: `[${type}_${n}]`, type, value: canonical || value, key, surrogate };
    this.entries.push(e);
    return e;
  }

  // Replace detected spans (right to left so offsets stay valid).
  sanitize(text, entities) {
    let out = text;
    const used = new Map();
    for (const ent of [...entities].sort((a, b) => b.start - a.start)) {
      const e = this.entry(ent.type, ent.text, ent.canonical, text);
      used.set(e.token, e);
      out = out.slice(0, ent.start) + (e.surrogate || e.token) + out.slice(ent.end);
    }
    return { text: out, used: [...used.values()] };
  }

  // Split a model reply into plain text and restored values for rendering.
  rehydrate(text) {
    const needles = new Map();
    for (const e of this.entries) {
      needles.set(e.token, e);
      needles.set(e.token.slice(1, -1), e);          // model dropped the brackets
      if (e.surrogate) needles.set(e.surrogate, e);
    }
    if (!needles.size) return [{ text }];
    const rx = new RegExp("(?:" + [...needles.keys()].sort((a, b) => b.length - a.length)
      .map(s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")(?!\\d)", "g");
    const parts = [];
    let last = 0;
    for (const m of text.matchAll(rx)) {
      if (m.index > last) parts.push({ text: text.slice(last, m.index) });
      parts.push({ text: needles.get(m[0]).value, entry: needles.get(m[0]) });
      last = m.index + m[0].length;
    }
    if (last < text.length) parts.push({ text: text.slice(last) });
    return parts;
  }

  restore(text) { return this.rehydrate(text).map(p => p.text).join(""); }
}

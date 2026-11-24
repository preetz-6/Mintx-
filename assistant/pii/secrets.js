// Layer 2 — Secret detection.
// Known credential formats are matched by signature. Unknown ones are found statistically:
// random keys have high Shannon entropy (bits per character) compared with natural words.

export function entropy(s) {
  const freq = new Map();
  for (const ch of s) freq.set(ch, (freq.get(ch) || 0) + 1);
  let h = 0;
  for (const n of freq.values()) { const p = n / s.length; h -= p * Math.log2(p); }
  return h;
}

const SIGNATURES = [
  ["Anthropic key", /\bsk-ant-[A-Za-z0-9_-]{20,}/g],
  ["OpenAI key", /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g],
  ["AWS access key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ["Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g],
  ["Stripe key", /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g],
  ["JWT", /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g],
  ["Private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+?-----END [A-Z ]*PRIVATE KEY-----/g],
];

// "password: hunter2" — the value after an assignment keyword is a secret regardless of entropy.
const ASSIGNMENT = /\b(?:password|passwd|pwd|passcode|secret|api[_ -]?key|access[_ -]?token|auth[_ -]?token|otp|pin)\b\s*(?:is|:|=)\s*["']?([^\s"',;]{4,})/gid;
// scheme://user:password@host — the password part.
const URL_CREDENTIALS = /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:([^\s@/]+)@[^\s/]+/gid;
const CANDIDATE =/(?<![A-Za-z0-9_\-+=/])[A-Za-z0-9_\-+/]{24,}={0,2}(?![A-Za-z0-9_\-+=/])/g;
const CONTEXT = ["key", "token", "secret", "bearer", "auth", "credential", "password", "signature"];

export function detectSecrets(text) {
  const out = [];
  for (const [label, rx] of SIGNATURES) {
    rx.lastIndex = 0;
    for (const m of text.matchAll(rx))
      out.push({ start: m.index, end: m.index + m[0].length, type: "SECRET", score: 0.98, source: "secrets", reasons: [`signature: ${label}`] });
  }
  URL_CREDENTIALS.lastIndex = 0;
  for (const m of text.matchAll(URL_CREDENTIALS)) {
    const [s, e] = m.indices[1];
    out.push({ start: s, end: e, type: "SECRET", score: 0.95, source: "secrets", reasons: ["password in connection URL"] });
  }
  ASSIGNMENT.lastIndex = 0;
  for (const m of text.matchAll(ASSIGNMENT)) {
    const [s, e] = m.indices[1];
    out.push({ start: s, end: e, type: "SECRET", score: 0.9, source: "secrets", reasons: ["assignment keyword"] });
  }
  CANDIDATE.lastIndex = 0;
  for (const m of text.matchAll(CANDIDATE)) {
    const s = m[0];
    const classes = [/[a-z]/, /[A-Z]/, /\d/].filter(rx => rx.test(s)).length;
    if (classes < 2 || /^[a-z_-]+$/i.test(s)) continue;
    const h = entropy(s);
    if (h < 3.8) continue;
    const before = text.slice(Math.max(0, m.index - 40), m.index).toLowerCase();
    const ctx = CONTEXT.find(w => before.includes(w));
    // Map entropy 3.8 → 0.45 and ≥5.0 → 0.85; context adds 0.25.
    let score = 0.45 + Math.min(1, (h - 3.8) / 1.2) * 0.4 + (ctx ? 0.25 : 0);
    const reasons = [`entropy ${h.toFixed(2)} bits/char`];
    if (ctx) reasons.push(`context “${ctx}”`);
    out.push({ start: m.index, end: m.index + s.length, type: "SECRET", score: Math.min(0.97, score), source: "secrets", reasons });
  }
  return out;
}

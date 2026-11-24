// Injected into the active tab only when the user sends a message. Returns visible text,
// the current selection and filled form fields. Password fields are never read.
(() => {
  const clean = s => String(s || "").replace(/[ \t ]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
  const root = document.querySelector("main, article, [role=main]") || document.body;
  const SKIP = new Set(["password", "hidden", "submit", "button", "reset", "image", "file", "checkbox", "radio"]);
  const fields = [];
  for (const el of document.querySelectorAll("input, textarea, select")) {
    if (fields.length >= 40) break;
    const type = (el.type || "").toLowerCase();
    if (SKIP.has(type) || /password|current-password|new-password|one-time-code/.test(el.autocomplete || "")) continue;
    if (el.checkVisibility && !el.checkVisibility()) continue;
    const value = el.tagName === "SELECT" ? el.selectedOptions[0]?.text : el.value;
    if (!value || !String(value).trim()) continue;
    const label = el.labels?.[0]?.innerText || el.getAttribute("aria-label") || el.placeholder || el.name || type;
    fields.push({ label: clean(label).slice(0, 80), value: clean(value).slice(0, 1000) });
  }
  return {
    title: document.title.slice(0, 300),
    site: location.hostname,
    selection: clean(getSelection()).slice(0, 4000),
    text: clean(root.innerText).slice(0, 60000),
    fields,
  };
})();

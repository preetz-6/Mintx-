// Minimal, safe Markdown renderer: everything is escaped first, then a small subset of
// syntax is turned into HTML. Restored PII values arrive as n markers.
const esc = s => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function inline(s) {
  return s
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
    .replace(/(^|[^_\w])_([^_\s][^_]*)_(?!\w)/g, "$1<em>$2</em>");
}

export function renderMarkdown(src, marks = []) {
  const lines = esc(src).split("\n");
  const html = [];
  let list = null, para = [], code = null;
  const flushPara = () => { if (para.length) { html.push(`<p>${inline(para.join("<br>"))}</p>`); para = []; } };
  const flushList = () => { if (list) { html.push(`<${list.tag}>${list.items.map(i => `<li>${inline(i)}</li>`).join("")}</${list.tag}>`); list = null; } };
  for (const line of lines) {
    if (code !== null) {
      if (/^```/.test(line)) { html.push(`<pre><code>${code.join("\n")}</code></pre>`); code = null; }
      else code.push(line);
      continue;
    }
    if (/^```/.test(line)) { flushPara(); flushList(); code = []; continue; }
    const h = line.match(/^(#{1,4})\s+(.*)/);
    const ul = line.match(/^\s*[-*•]\s+(.*)/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)/);
    if (h) { flushPara(); flushList(); html.push(`<h4>${inline(h[2])}</h4>`); }
    else if (ul || ol) {
      flushPara();
      const tag = ul ? "ul" : "ol";
      if (list && list.tag !== tag) flushList();
      list ??= { tag, items: [] };
      list.items.push((ul || ol)[1]);
    } else if (!line.trim()) { flushPara(); flushList(); }
    else { flushList(); para.push(line); }
  }
  if (code !== null) html.push(`<pre><code>${code.join("\n")}</code></pre>`);
  flushPara(); flushList();
  return html.join("").replace(/(\d+)/g, (_, i) => {
    const m = marks[+i];
    return m ? `<mark class="restored" data-type="${esc(m.type)}" title="${esc(m.token)} · restored on your device">${esc(m.text)}</mark>` : "";
  });
}

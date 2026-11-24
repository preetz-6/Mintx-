// Client side of Layer 4: talks to the NER Web Worker.
let worker, seq = 0;
const pending = new Map();
let onProgress = () => {};

function ensure() {
  if (worker) return worker;
  worker = new Worker(new URL("./ner-worker.js", import.meta.url), { type: "module" });
  worker.onmessage = ({ data }) => {
    if (data.kind === "progress") return onProgress(data.value);
    const p = pending.get(data.id);
    if (!p) return;
    pending.delete(data.id);
    data.kind === "result" ? p.resolve(data.entities) : p.reject(new Error(data.error));
  };
  worker.onerror = e => {
    for (const p of pending.values()) p.reject(new Error(e.message || "NER worker failed"));
    pending.clear(); worker = undefined;
  };
  return worker;
}

export function detectNeural(text, progress) {
  if (!text.trim()) return Promise.resolve([]);
  onProgress = progress || (() => {});
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ensure().postMessage({ id, text });
  });
}

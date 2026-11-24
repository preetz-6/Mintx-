// Runs the transformer NER model in a Web Worker so inference never blocks the chat UI.
// Weights are fetched once from the Hugging Face Hub (or ../models if pre-downloaded),
// cached by the browser, and executed locally with ONNX Runtime WebAssembly.
import { pipeline, env } from "../vendor/transformers.min.js";
import { NER_MODEL, chunk, aggregate } from "./neural-core.js";

env.localModelPath = new URL("../models/", import.meta.url).href;
// Use bundled weights when assistant/models/ was populated (offline mode), else the Hub.
const localCheck = fetch(new URL(`../models/${NER_MODEL}/config.json`, import.meta.url))
  .then(r => r.ok, () => false).then(ok => { env.allowLocalModels = ok; });
env.allowRemoteModels = true;
env.useBrowserCache = true;
env.backends.onnx.wasm.wasmPaths = new URL("../vendor/ort/", import.meta.url).href;
env.backends.onnx.wasm.numThreads = 1;

let ner;
function load() {
  ner ??= localCheck.then(() => pipeline("token-classification", NER_MODEL, {
    dtype: "q8", device: "wasm",
    progress_callback: p => {
      if (p.status === "progress" && p.file?.endsWith(".onnx")) postMessage({ kind: "progress", value: p.progress });
    },
  })).catch(e => { ner = undefined; throw e; });
  return ner;
}

onmessage = async ({ data }) => {
  const { id, text } = data;
  try {
    const model = await load();
    const entities = [];
    for (const c of chunk(text)) {
      const tokens = await model(c.text, { ignore_labels: ["O"] });
      entities.push(...aggregate(c.text, tokens, c.offset));
    }
    postMessage({ id, kind: "result", entities });
  } catch (e) {
    postMessage({ id, kind: "error", error: String(e?.message || e) });
  }
};

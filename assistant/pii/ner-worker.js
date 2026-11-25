// Runs a transformer NER model in a Web Worker so inference never blocks the chat UI.
// Weights come from ../models/<id>/ when present (offline), otherwise from the Hugging Face Hub;
// they are cached by the browser and executed locally with ONNX Runtime WebAssembly.
import { pipeline, env } from "../vendor/transformers.min.js";
import { NER_MODEL, chunk, aggregate } from "./neural-core.js";

env.localModelPath = new URL("../models/", import.meta.url).href;
env.allowRemoteModels = true;
env.useBrowserCache = true;
env.backends.onnx.wasm.wasmPaths = new URL("../vendor/ort/", import.meta.url).href;
env.backends.onnx.wasm.numThreads = 1;

const pipes = new Map();
const hasLocal = id => fetch(new URL(`../models/${id}/config.json`, import.meta.url)).then(r => r.ok, () => false);

function load(model) {
  if (!pipes.has(model)) {
    pipes.set(model, hasLocal(model).then(local => {
      env.allowLocalModels = local;
      return pipeline("token-classification", model, {
        dtype: "q8", device: "wasm", local_files_only: local,
        progress_callback: p => {
          if (p.status === "progress" && p.file?.endsWith(".onnx")) postMessage({ kind: "progress", value: p.progress });
        },
      });
    }).catch(e => { pipes.delete(model); throw e; }));
  }
  return pipes.get(model);
}

onmessage = async ({ data }) => {
  const { id, text, model = NER_MODEL } = data;
  try {
    const ner = await load(model);
    const name = model.split("/").pop();
    const entities = [];
    for (const c of chunk(text)) {
      const tokens = await ner(c.text, { ignore_labels: ["O"] });
      entities.push(...aggregate(c.text, tokens, c.offset, name));
    }
    postMessage({ id, kind: "result", entities });
  } catch (e) {
    postMessage({ id, kind: "error", error: String(e?.message || e) });
  }
};

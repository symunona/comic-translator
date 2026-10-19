import { AutoProcessor, env, Florence2ForConditionalGeneration, pipeline, RawImage } from "@huggingface/transformers";
import { param, run, splitLines } from "./harness.js";

const model = param("model", "trocr-handwritten");

const REPOS = {
  "trocr-handwritten": "Xenova/trocr-small-handwritten",
  "trocr-printed": "Xenova/trocr-small-printed",
  florence: "onnx-community/Florence-2-base-ft",
};

function setup(threads) {
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = "/models/hf/";
  env.useBrowserCache = false;
  env.backends.onnx.wasm.wasmPaths = "/ort-tf/";
  env.backends.onnx.wasm.numThreads = threads;
}

const trocr = {
  name: model,
  async load({ threads }) {
    setup(threads);
    this.pipe = await pipeline("image-to-text", REPOS[model], { device: "wasm", dtype: "q8" });
    return { repo: REPOS[model], dtype: "q8", numThreads: env.backends.onnx.wasm.numThreads };
  },
  async recognize(canvas) {
    const parts = splitLines(canvas);
    const lines = [];
    for (const part of parts) {
      const [r] = await this.pipe(RawImage.fromCanvas(part), { max_new_tokens: 48 });
      lines.push(r.generated_text.trim());
    }
    return { text: lines.join("\n"), lines: parts.length };
  },
};

const florence = {
  name: "florence2-base-ft",
  async load({ threads }) {
    setup(threads);
    const repo = REPOS.florence;
    this.model = await Florence2ForConditionalGeneration.from_pretrained(repo, {
      device: "wasm",
      dtype: { embed_tokens: "q8", vision_encoder: "q8", encoder_model: "q8", decoder_model_merged: "q8" },
    });
    this.processor = await AutoProcessor.from_pretrained(repo);
    return { repo, dtype: "q8", numThreads: env.backends.onnx.wasm.numThreads };
  },
  async recognize(canvas) {
    const image = RawImage.fromCanvas(canvas);
    const task = "<OCR_WITH_REGION>";
    const inputs = await this.processor(image, this.processor.construct_prompts(task));
    const ids = await this.model.generate({ ...inputs, max_new_tokens: 256 });
    const raw = this.processor.batch_decode(ids, { skip_special_tokens: false })[0];
    const { labels } = this.processor.post_process_generation(raw, task, image.size)[task];
    return { text: labels.join("\n"), lines: labels.length, task };
  },
};

run(model === "florence" ? florence : trocr);

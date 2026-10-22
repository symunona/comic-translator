import * as ort from "onnxruntime-web";
import { PaddleOcrService } from "ppu-paddle-ocr/web";
import { run } from "./harness.js";

let service;

const MODELS = {
  "v5-latin": { detection: "PP-OCRv5_mobile_det_infer.onnx", recognition: "latin_PP-OCRv5_mobile_rec_infer.onnx", dict: "ppocrv5_latin_dict.txt" },
  "v6-small": { detection: "PP-OCRv6_small_det.ort", recognition: "PP-OCRv6_small_rec.ort", dict: "ppocrv6_dict.txt" },
  "v6-medium": { detection: "PP-OCRv6_medium_det.ort", recognition: "PP-OCRv6_medium_rec.ort", dict: "ppocrv6_dict.txt" },
};
const variant = new URLSearchParams(location.search).get("model") || "v5-latin";
const m = MODELS[variant];

run({
  name: `paddle-${variant}`,
  async load({ threads }) {
    ort.env.wasm.wasmPaths = "/ort/";
    ort.env.wasm.numThreads = threads;
    service = new PaddleOcrService({
      model: {
        detection: `/models/paddle/${m.detection}`,
        recognition: `/models/paddle/${m.recognition}`,
        charactersDictionary: `/models/paddle/${m.dict}`,
      },
      session: { executionProviders: ["wasm"], graphOptimizationLevel: "all" },
      recognition: { mainThreadYieldMs: 0 },
    });
    await service.initialize();
    return { ort: ort.env.versions.web, numThreads: ort.env.wasm.numThreads };
  },
  async recognize(canvas) {
    const r = await service.recognize(canvas, { noCache: true });
    const lines = (r.lines ?? []).map((line) => line.map((x) => x.text).join(" "));
    return { text: lines.join("\n"), confidence: r.confidence, lines: lines.length };
  },
});

import * as ort from "onnxruntime-web";
import { PaddleOcrService } from "ppu-paddle-ocr/web";
import { run } from "./harness.js";

let service;

run({
  name: "paddle-v5-latin",
  async load({ threads }) {
    ort.env.wasm.wasmPaths = "/ort/";
    ort.env.wasm.numThreads = threads;
    service = new PaddleOcrService({
      model: {
        detection: "/models/paddle/PP-OCRv5_mobile_det_infer.onnx",
        recognition: "/models/paddle/latin_PP-OCRv5_mobile_rec_infer.onnx",
        charactersDictionary: "/models/paddle/ppocrv5_latin_dict.txt",
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

import * as ort from "onnxruntime-web";
import mjsUrl from "onnxruntime-web/ort-wasm-simd-threaded.jsep.mjs?url";
import wasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url";
import { PaddleOcrService } from "ppu-paddle-ocr/web";
import { PADDLE, cachedFetch } from "./models";
import type { OcrLine, OcrMessage, OcrRequest } from "./protocol";

type Scope = { crossOriginIsolated: boolean; postMessage(m: OcrMessage): void; onmessage: ((e: MessageEvent<OcrRequest>) => void) | null };
const scope = self as unknown as Scope;

let service: Promise<PaddleOcrService> | null = null;

function load(): Promise<PaddleOcrService> {
  service ??= (async () => {
    ort.env.wasm.wasmPaths = { mjs: mjsUrl, wasm: wasmUrl };
    ort.env.wasm.numThreads = scope.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
    const sizes = new Map<string, [number, number]>();
    const report = () => {
      let loaded = 0;
      let total = 0;
      for (const [l, t] of sizes.values()) {
        loaded += l;
        total += t;
      }
      scope.postMessage({ type: "loading", loaded, total });
    };
    const get = (url: string) => cachedFetch(url, (l, t) => (sizes.set(url, [l, t]), report()));
    const [detection, recognition, dict] = await Promise.all([get(PADDLE.detection), get(PADDLE.recognition), get(PADDLE.dict)]);
    const s = new PaddleOcrService({
      model: { detection, recognition, charactersDictionary: dict },
      session: { executionProviders: ["wasm"], graphOptimizationLevel: "all" },
    });
    await s.initialize();
    return s;
  })();
  service.catch(() => (service = null));
  return service;
}

scope.onmessage = async (e) => {
  try {
    const s = await load();
    const t0 = performance.now();
    const out: Record<string, OcrLine[]> = {};
    const { crops } = e.data;
    for (let i = 0; i < crops.length; i++) {
      const { id, image } = crops[i];
      const c = new OffscreenCanvas(image.width, image.height);
      c.getContext("2d")!.drawImage(image, 0, 0);
      image.close();
      const r = await s.recognize(c as unknown as HTMLCanvasElement, { noCache: true });
      out[id] = (r.lines ?? []).map((line) => ({ text: line.map((x) => x.text).join(" "), confidence: line.reduce((a, x) => a + x.confidence, 0) / Math.max(line.length, 1) }));
      scope.postMessage({ type: "progress", done: i + 1, total: crops.length });
    }
    scope.postMessage({ type: "result", lines: out, ms: performance.now() - t0 });
  } catch (err) {
    scope.postMessage({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};

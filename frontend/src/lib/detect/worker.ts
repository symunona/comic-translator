import * as ort from "onnxruntime-web/wasm";
import mjsUrl from "onnxruntime-web/ort-wasm-simd-threaded.mjs?url";
import wasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import { DETECTOR_NAME, type ClientPanel, type DetectMessage, type DetectRequest } from "./protocol";

const SIZE = 640;
const QUERIES = 300;
const MIN_SCORE = 0.3;
const CLASSES = ["bubble", "text_bubble", "text_free"];
const MODEL_CACHE = "comic-models-v1";

type Scope = {
  crossOriginIsolated: boolean;
  postMessage(m: DetectMessage): void;
  onmessage: ((e: MessageEvent<DetectRequest>) => void) | null;
};
const scope = self as unknown as Scope;

const threads = scope.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
const device = `wasm×${threads}`;
ort.env.wasm.wasmPaths = { mjs: mjsUrl, wasm: wasmUrl };
ort.env.wasm.numThreads = threads;

let session: Promise<ort.InferenceSession> | null = null;

async function modelBytes(url: string): Promise<ArrayBuffer> {
  const cache = await caches.open(MODEL_CACHE).catch(() => null);
  const hit = await cache?.match(url);
  if (hit) return hit.arrayBuffer();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`detector download failed: ${res.status}`);
  await cache?.put(url, res.clone()).catch(() => {});
  return res.arrayBuffer();
}

function load(url: string) {
  session ??= modelBytes(url).then((buf) => ort.InferenceSession.create(new Uint8Array(buf), { executionProviders: ["wasm"] }));
  session.catch(() => (session = null));
  return session;
}

function pixels(bmp: ImageBitmap): Float32Array {
  const canvas = new OffscreenCanvas(SIZE, SIZE);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bmp, 0, 0);
  const { data } = ctx.getImageData(0, 0, SIZE, SIZE);
  const plane = SIZE * SIZE;
  const out = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    out[i] = data[i * 4] / 255;
    out[plane + i] = data[i * 4 + 1] / 255;
    out[2 * plane + i] = data[i * 4 + 2] / 255;
  }
  return out;
}

async function detect(req: DetectRequest) {
  const t0 = performance.now();
  const s = await load(req.modelUrl);
  const loadMs = performance.now() - t0;
  const img = await createImageBitmap(req.image);
  const panels: ClientPanel[] = [];
  const panelMs: number[] = [];
  for (const [i, p] of req.panels.entries()) {
    const t = performance.now();
    const [x, y, w, h] = p.bbox;
    const bmp = await createImageBitmap(img, x, y, w, h, { resizeWidth: SIZE, resizeHeight: SIZE, resizeQuality: "medium" });
    const out = await s.run({
      images: new ort.Tensor("float32", pixels(bmp), [1, 3, SIZE, SIZE]),
      orig_target_sizes: new ort.Tensor("int64", BigInt64Array.from([BigInt(w), BigInt(h)]), [1, 2]),
    });
    bmp.close();
    const labels = out.labels.data as BigInt64Array;
    const boxes = out.boxes.data as Float32Array;
    const scores = out.scores.data as Float32Array;
    const detections = [];
    for (let q = 0; q < QUERIES; q++) {
      const cls = CLASSES[Number(labels[q])];
      if (scores[q] < MIN_SCORE || !cls) continue;
      const b = boxes.subarray(q * 4, q * 4 + 4);
      detections.push({ class: cls, score: scores[q], box: [b[0], b[1], b[2], b[3]] as [number, number, number, number] });
    }
    panels.push({ panelId: p.id, detections });
    panelMs.push(performance.now() - t);
    scope.postMessage({ type: "progress", done: i + 1, total: req.panels.length, device });
  }
  img.close();
  const ms = performance.now() - t0;
  scope.postMessage({
    type: "result",
    result: { model: DETECTOR_NAME, device, ms: Math.round(ms), panels },
    timing: { loadMs: Math.round(loadMs), firstMs: Math.round(panelMs[0] ?? 0), panelMs: panelMs.map(Math.round) },
  });
}

scope.onmessage = (e) => {
  detect(e.data).catch((err) => scope.postMessage({ type: "error", message: String(err?.message ?? err) }));
};

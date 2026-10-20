import * as ortWasm from "onnxruntime-web/wasm";
import mjsUrl from "onnxruntime-web/ort-wasm-simd-threaded.mjs?url";
import wasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import gpuMjsUrl from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url";
import gpuWasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url";
import { DETECTOR_NAME, type ClientPanel, type DetectEP, type DetectMessage, type DetectRequest } from "./protocol";

type Ort = typeof ortWasm;

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

type Engine = { ort: Ort; session: ortWasm.InferenceSession; device: string };

let wasmEngine: Promise<Engine> | null = null;
let gpuEngine: Promise<Engine> | null = null;
let modelBuf: Promise<ArrayBuffer> | null = null;

async function fetchModel(url: string): Promise<ArrayBuffer> {
  const cache = await caches.open(MODEL_CACHE).catch(() => null);
  const hit = await cache?.match(url);
  if (hit) return hit.arrayBuffer();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`detector download failed: ${res.status}`);
  await cache?.put(url, res.clone()).catch(() => {});
  return res.arrayBuffer();
}

function modelBytes(url: string) {
  modelBuf ??= fetchModel(url);
  modelBuf.catch(() => (modelBuf = null));
  return modelBuf;
}

function wasmThreads(want?: number) {
  const max = scope.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
  return Math.max(1, Math.min(want ?? max, max));
}

function loadWasm(url: string, threads: number): Promise<Engine> {
  wasmEngine ??= (async () => {
    ortWasm.env.wasm.wasmPaths = { mjs: mjsUrl, wasm: wasmUrl };
    ortWasm.env.wasm.numThreads = threads;
    const buf = await modelBytes(url);
    const session = await ortWasm.InferenceSession.create(new Uint8Array(buf), { executionProviders: ["wasm"] });
    return { ort: ortWasm, session, device: `wasm×${threads}` };
  })();
  wasmEngine.catch(() => (wasmEngine = null));
  return wasmEngine;
}

type GPUInfo = { vendor?: string; architecture?: string; description?: string; isFallbackAdapter?: boolean };
type GPUAdapterLike = { info?: GPUInfo; isFallbackAdapter?: boolean };
type GPULike = { requestAdapter(o?: { powerPreference?: string }): Promise<GPUAdapterLike | null> };

async function gpuAdapter(): Promise<GPUAdapterLike | null> {
  const gpu = (navigator as unknown as { gpu?: GPULike }).gpu;
  if (!gpu) return null;
  const a = await gpu.requestAdapter({ powerPreference: "high-performance" }).catch(() => null);
  const info = a?.info;
  if (!a || a.isFallbackAdapter || info?.isFallbackAdapter || /swiftshader|llvmpipe|lavapipe/i.test(`${info?.vendor} ${info?.architecture} ${info?.description}`)) return null;
  return a;
}

function loadGpu(url: string, threads: number): Promise<Engine> {
  gpuEngine ??= (async () => {
    const adapter = await gpuAdapter();
    if (!adapter) throw new Error("no hardware WebGPU adapter");
    const ort = (await import("onnxruntime-web/webgpu")) as unknown as Ort;
    ort.env.wasm.wasmPaths = { mjs: gpuMjsUrl, wasm: gpuWasmUrl };
    ort.env.wasm.numThreads = threads;
    const buf = await modelBytes(url);
    const session = await ort.InferenceSession.create(new Uint8Array(buf), { executionProviders: ["webgpu"] });
    const name = [adapter.info?.vendor, adapter.info?.architecture].filter(Boolean).join(" ");
    return { ort, session, device: name ? `webgpu · ${name}` : "webgpu" };
  })();
  gpuEngine.catch(() => (gpuEngine = null));
  return gpuEngine;
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

async function runPanels(e: Engine, req: DetectRequest, img: ImageBitmap, panelMs: number[]) {
  const panels: ClientPanel[] = [];
  for (const [i, p] of req.panels.entries()) {
    const t = performance.now();
    const [x, y, w, h] = p.bbox;
    const bmp = await createImageBitmap(img, x, y, w, h, { resizeWidth: SIZE, resizeHeight: SIZE, resizeQuality: "medium" });
    const out = await e.session.run({
      images: new e.ort.Tensor("float32", pixels(bmp), [1, 3, SIZE, SIZE]),
      orig_target_sizes: new e.ort.Tensor("int64", BigInt64Array.from([BigInt(w), BigInt(h)]), [1, 2]),
    });
    bmp.close();
    const labels = (await out.labels.getData()) as BigInt64Array;
    const boxes = (await out.boxes.getData()) as Float32Array;
    const scores = (await out.scores.getData()) as Float32Array;
    const detections = [];
    for (let q = 0; q < QUERIES; q++) {
      const cls = CLASSES[Number(labels[q])];
      if (scores[q] < MIN_SCORE || !cls) continue;
      const b = boxes.subarray(q * 4, q * 4 + 4);
      detections.push({ class: cls, score: scores[q], box: [b[0], b[1], b[2], b[3]] as [number, number, number, number] });
    }
    panels.push({ panelId: p.id, detections });
    panelMs.push(performance.now() - t);
    scope.postMessage({ type: "progress", done: i + 1, total: req.panels.length, device: e.device });
  }
  return panels;
}

async function engineFor(ep: DetectEP, req: DetectRequest): Promise<{ engine: Engine; fallback?: string }> {
  const threads = wasmThreads(req.threads);
  if (ep === "wasm") return { engine: await loadWasm(req.modelUrl, threads) };
  try {
    return { engine: await loadGpu(req.modelUrl, threads) };
  } catch (err) {
    if (ep === "webgpu") throw err;
    return { engine: await loadWasm(req.modelUrl, threads), fallback: String((err as Error)?.message ?? err) };
  }
}

async function detect(req: DetectRequest) {
  const t0 = performance.now();
  let { engine, fallback } = await engineFor(req.ep, req);
  const loadMs = performance.now() - t0;
  const img = await createImageBitmap(req.image);
  let panelMs: number[] = [];
  let panels: ClientPanel[];
  try {
    panels = await runPanels(engine, req, img, panelMs);
  } catch (err) {
    if (req.ep !== "auto" || engine.device.startsWith("wasm")) throw err;
    fallback = String((err as Error)?.message ?? err);
    engine = await loadWasm(req.modelUrl, wasmThreads(req.threads));
    panelMs = [];
    panels = await runPanels(engine, req, img, panelMs);
  }
  img.close();
  const ms = performance.now() - t0;
  const bytes = (await modelBuf)?.byteLength;
  scope.postMessage({
    type: "result",
    result: { model: DETECTOR_NAME, bytes, device: engine.device, ms: Math.round(ms), panels },
    timing: { loadMs: Math.round(loadMs), firstMs: Math.round(panelMs[0] ?? 0), panelMs: panelMs.map(Math.round), fallback },
  });
}

scope.onmessage = (e) => {
  detect(e.data).catch((err) => scope.postMessage({ type: "error", message: String(err?.message ?? err) }));
};

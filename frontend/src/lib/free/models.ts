const PADDLE_REPO = "https://huggingface.co/snowfluke/ppu-paddle-ocr-models/resolve/bf1d5edb0335d3262be7caf13f766ba274b4cadd";

export const PADDLE = {
  name: "paddle-v5-latin",
  detection: `${PADDLE_REPO}/detection/PP-OCRv5_mobile_det_infer.onnx`,
  recognition: `${PADDLE_REPO}/recognition/multi/latin/v5/latin_PP-OCRv5_mobile_rec_infer.onnx`,
  dict: `${PADDLE_REPO}/recognition/multi/latin/v5/ppocrv5_latin_dict.txt`,
  mb: 13,
};

export const OPUS_MB = 105;

export const MODEL_CACHE = "comic-models-v1";

export async function cachedFetch(url: string, onBytes?: (loaded: number, total: number) => void): Promise<ArrayBuffer> {
  const cache = await caches.open(MODEL_CACHE).catch(() => null);
  const hit = await cache?.match(url);
  if (hit) return hit.arrayBuffer();
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`model download failed: ${res.status} ${url.split("/").pop()}`);
  const total = Number(res.headers.get("content-length")) || 0;
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    loaded += value.length;
    onBytes?.(loaded, total);
  }
  const buf = new Uint8Array(loaded);
  let off = 0;
  for (const p of parts) {
    buf.set(p, off);
    off += p.length;
  }
  await cache?.put(url, new Response(buf)).catch(() => {});
  return buf.buffer;
}

export async function isCached(urls: string[]): Promise<boolean> {
  const cache = await caches.open(MODEL_CACHE).catch(() => null);
  if (!cache) return false;
  for (const u of urls) if (!(await cache.match(u))) return false;
  return true;
}

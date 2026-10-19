export function param(name, fallback) {
  return new URLSearchParams(location.search).get(name) ?? fallback;
}

async function loadCanvas(url) {
  const bmp = await createImageBitmap(await (await fetch(url)).blob());
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  canvas.getContext("2d", { willReadFrequently: true }).drawImage(bmp, 0, 0);
  return canvas;
}

export function splitLines(canvas) {
  const { width: w, height: h } = canvas;
  const px = canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const ink = (x, y) => {
    const i = (y * w + x) * 4;
    return 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2] < 128;
  };
  const rows = [];
  for (let y = 0; y < h; y++) {
    let n = 0;
    for (let x = 0; x < w; x++) if (ink(x, y)) n++;
    rows.push(n);
  }
  let bands = [];
  let start = -1;
  for (let y = 0; y <= h; y++) {
    const on = y < h && rows[y] > 1;
    if (on && start < 0) start = y;
    if (!on && start >= 0) {
      bands.push([start, y]);
      start = -1;
    }
  }
  const tall = bands.map(([a, b]) => b - a).sort((a, b) => a - b);
  const median = tall[Math.floor(tall.length / 2)] ?? h;
  const merged = [];
  for (const band of bands) {
    const prev = merged.at(-1);
    const small = band[1] - band[0] < median * 0.45;
    if (prev && (small || band[0] - prev[1] < 2) && band[0] - prev[1] < median * 0.6) prev[1] = band[1];
    else if (small && !prev) merged.push([...band]);
    else merged.push([...band]);
  }
  bands = merged.filter(([a, b]) => b - a >= 4);
  if (bands.length <= 1) return [canvas];
  return bands.map(([a, b]) => {
    let x0 = w, x1 = 0;
    for (let y = a; y < b; y++) for (let x = 0; x < w; x++) if (ink(x, y)) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
    const pad = 4;
    const sx = Math.max(0, x0 - pad), sy = Math.max(0, a - pad);
    const sw = Math.min(w, x1 + pad + 1) - sx, sh = Math.min(h, b + pad) - sy;
    const c = document.createElement("canvas");
    c.width = sw;
    c.height = sh;
    c.getContext("2d").drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
    return c;
  });
}

async function memoryBytes() {
  if (!globalThis.crossOriginIsolated || !performance.measureUserAgentSpecificMemory) return null;
  try {
    return (await performance.measureUserAgentSpecificMemory()).bytes;
  } catch {
    return null;
  }
}

export async function run(engine) {
  const threads = Number(param("threads", "1"));
  const limit = Number(param("limit", "0"));
  const out = {
    engine: engine.name,
    threads,
    crossOriginIsolated: globalThis.crossOriginIsolated,
    hardwareConcurrency: navigator.hardwareConcurrency,
    webgpu: !!navigator.gpu,
    preds: [],
  };
  try {
    let crops = await (await fetch("/crops/crops.json")).json();
    if (limit) crops = crops.slice(0, limit);
    const t0 = performance.now();
    out.info = await engine.load({ threads });
    out.loadMs = performance.now() - t0;
    out.memAfterLoad = await memoryBytes();
    for (const c of crops) {
      const canvas = await loadCanvas(`/crops/${c.file}`);
      const s = performance.now();
      const pred = { id: c.id };
      try {
        Object.assign(pred, await engine.recognize(canvas, c));
      } catch (e) {
        pred.error = String(e?.message ?? e);
      }
      pred.ms = performance.now() - s;
      out.preds.push(pred);
      console.log(`${engine.name} ${c.id} ${pred.ms.toFixed(0)}ms ${JSON.stringify(pred.text)}`);
    }
    out.memEnd = await memoryBytes();
  } catch (e) {
    out.fatal = String(e?.stack ?? e);
  }
  window.__result = out;
}

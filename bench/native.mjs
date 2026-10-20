// Same PaddleOCR models as the browser bench, on devbox's CPU through
// onnxruntime-node. Speed comparison; text should match the WASM run.
//   node native.mjs [crops-dir] [v5-latin|v6-small|v6-medium ...]
import { readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { cpus } from "node:os";
import { PaddleOcrService } from "ppu-paddle-ocr";
import { MODELS_DIR } from "./download.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const cropsDir = process.argv[2] ?? join(HERE, "results", "crops-multi");
const variants = process.argv.slice(3).length ? process.argv.slice(3) : ["v5-latin", "v6-small", "v6-medium"];
const P = join(MODELS_DIR, "paddle");
const MODELS = {
  "v5-latin": ["PP-OCRv5_mobile_det_infer.onnx", "latin_PP-OCRv5_mobile_rec_infer.onnx", "ppocrv5_latin_dict.txt"],
  "v6-small": ["PP-OCRv6_small_det.ort", "PP-OCRv6_small_rec.ort", "ppocrv6_dict.txt"],
  "v6-medium": ["PP-OCRv6_medium_det.ort", "PP-OCRv6_medium_rec.ort", "ppocrv6_dict.txt"],
};

const crops = JSON.parse(await readFile(join(cropsDir, "crops.json"), "utf8"));
const runs = [];
for (const v of variants) {
  const [det, rec, dict] = MODELS[v];
  const t0 = performance.now();
  const service = new PaddleOcrService({
    model: { detection: join(P, det), recognition: join(P, rec), charactersDictionary: join(P, dict) },
  });
  await service.initialize();
  const loadMs = performance.now() - t0;
  const preds = [];
  for (const c of crops) {
    const buf = await readFile(join(cropsDir, c.file));
    const s = performance.now();
    const r = await service.recognize(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), { noCache: true });
    const lines = (r.lines ?? []).map((line) => line.map((x) => x.text).join(" "));
    preds.push({ id: c.id, text: lines.join("\n"), confidence: r.confidence, ms: performance.now() - s });
  }
  const ms = preds.map((p) => p.ms).sort((a, b) => a - b);
  const sum = ms.reduce((a, b) => a + b, 0);
  console.log(`${v}: load ${loadMs.toFixed(0)} ms, median ${ms[ms.length >> 1].toFixed(0)} ms, strip-sum ${(sum / 1000).toFixed(1)} s, ${crops.length} crops`);
  runs.push({ model: `paddle-${v}`, where: "devbox onnxruntime-node", cpus: cpus().length, loadMs, msMedian: ms[ms.length >> 1], msSum: sum, preds });
  await service.destroy?.();
}
const out = join(HERE, "results", `ocr-native-${new Date().toISOString().slice(0, 10)}.json`);
await writeFile(out, JSON.stringify({ date: new Date().toISOString(), cropsDir, runs }, null, 1));
console.log(`wrote ${out}`);

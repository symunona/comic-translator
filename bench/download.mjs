import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const MODELS_DIR = process.env.OCR_BENCH_MODELS ?? "/data/cache/models/ocr-bench";

const HF = "https://huggingface.co";
const PADDLE = `${HF}/snowfluke/ppu-paddle-ocr-models/resolve/main`;

export const FILES = {
  paddle: [
    [`${PADDLE}/detection/PP-OCRv5_mobile_det_infer.onnx`, "paddle/PP-OCRv5_mobile_det_infer.onnx"],
    [`${PADDLE}/recognition/multi/latin/v5/latin_PP-OCRv5_mobile_rec_infer.onnx`, "paddle/latin_PP-OCRv5_mobile_rec_infer.onnx"],
    [`${PADDLE}/recognition/multi/latin/v5/ppocrv5_latin_dict.txt`, "paddle/ppocrv5_latin_dict.txt"],
  ],
  "trocr-handwritten": hfRepo("Xenova/trocr-small-handwritten", [
    "config.json", "generation_config.json", "preprocessor_config.json", "tokenizer.json", "tokenizer_config.json", "special_tokens_map.json",
    "onnx/encoder_model_quantized.onnx", "onnx/decoder_model_merged_quantized.onnx",
  ]),
  "trocr-printed": hfRepo("Xenova/trocr-small-printed", [
    "config.json", "generation_config.json", "preprocessor_config.json", "tokenizer.json", "tokenizer_config.json", "special_tokens_map.json",
    "onnx/encoder_model_quantized.onnx", "onnx/decoder_model_merged_quantized.onnx",
  ]),
  florence: hfRepo("onnx-community/Florence-2-base-ft", [
    "config.json", "generation_config.json", "preprocessor_config.json", "tokenizer.json", "tokenizer_config.json", "special_tokens_map.json",
    "added_tokens.json", "vocab.json", "merges.txt",
    "onnx/embed_tokens_quantized.onnx", "onnx/vision_encoder_quantized.onnx", "onnx/encoder_model_quantized.onnx", "onnx/decoder_model_merged_quantized.onnx",
  ]),
  tesseract: [
    ["https://cdn.jsdelivr.net/npm/@tesseract.js-data/hun@1.0.0/4.0.0_best_int/hun.traineddata.gz", "tesseract/hun.traineddata.gz"],
  ],
};

function hfRepo(repo, paths) {
  return paths.map((p) => [`${HF}/${repo}/resolve/main/${p}`, `hf/${repo}/${p}`]);
}

async function exists(p) {
  try { return (await stat(p)).size > 0; } catch { return false; }
}

export async function download(keys = Object.keys(FILES)) {
  const sizes = {};
  for (const key of keys) {
    let total = 0;
    for (const [url, rel] of FILES[key]) {
      const dest = join(MODELS_DIR, rel);
      if (!(await exists(dest))) {
        process.stdout.write(`download ${rel}\n`);
        const res = await fetch(url);
        if (!res.ok) throw new Error(`${url}: ${res.status}`);
        await mkdir(dirname(dest), { recursive: true });
        await writeFile(dest, Buffer.from(await res.arrayBuffer()));
      }
      total += (await stat(dest)).size;
    }
    sizes[key] = total;
  }
  return sizes;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(await download(process.argv.slice(2).length ? process.argv.slice(2) : undefined));
}

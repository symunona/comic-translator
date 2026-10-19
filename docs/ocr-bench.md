# OCR bench: in-browser OCR vs Opus

Strip: kristalyhologram (`data/2afc78b4…`), 45 regions with text (53 minus 8 `none`). Run 2026-10-19, devbox (12 cores), Chromium 1234 headless.
Ground truth: `stages/ocr@v1.json` `source.text` = Claude Opus via claude CLI. Not human-checked: Opus errors count as model errors.

## Run

```sh
cd bench && pnpm install --store-dir /data/cache/pnpm
TMPDIR=$PWD/../.tmp node run.mjs                 # all models, ~50 min (Florence = 45 of it)
TMPDIR=$PWD/../.tmp node run.mjs paddle          # one engine / label
OCR_BENCH_LIMIT=3 OCR_BENCH_VERBOSE=1 node run.mjs paddle   # smoke -> results/ocr-<date>-partial-*.json (gitignored)
node report.mjs                                   # markdown table + samples from newest results
```

| step | what |
|---|---|
| `crops.mjs` | region `textBox` + 4px pad cut from `orig.png` -> `results/crops/<rid>.png` + `crops.json` (gt) |
| `download.mjs` | models -> `/data/cache/models/ocr-bench` (`OCR_BENCH_MODELS`). Skips existing |
| `run.mjs` | esbuild `src/*.js` -> `.dist`, static server `127.0.0.1:4750` (COOP/COEP, `OCR_BENCH_PORT`), fresh headless Chromium per (model, threads), page sets `window.__result`, scores, writes `results/ocr-<date>.json` |
| `src/harness.js` | load timer, per-crop loop, `measureUserAgentSpecificMemory` |
| `metrics.mjs` | normalize (hu uppercase, quotes, whitespace, newline -> space), CER, WER, CER no punct, accent acc |

- WASM EP forced everywhere (`executionProviders: ["wasm"]`, transformers.js `device: "wasm"`). Chromium flags `--disable-gpu --disable-features=WebGPU`.
- Threads: `numThreads` 1 vs 4 (`OCR_BENCH_THREADS`). Page always cross-origin isolated (checked: `crossOriginIsolated=true`).
- Models served locally, `allowRemoteModels=false`. ORT wasm self-hosted: `/ort/` (1.30.0, paddle), `/ort-tf/` (1.31-dev bundled with transformers.js 4.3.1).
- Chromium: `/data/cache/playwright/chromium-1234/chrome-linux64/chrome` (`CHROMIUM` env). playwright-core 1.64.
- Accent acc = GT chars in `ŐŰÁÉÖÜÍÓÚ` reproduced at the aligned position (Levenshtein backtrace). 76 in GT.
- Mem Δ = PSS of whole Chromium tree (peak during run − blank page). UA mem = `measureUserAgentSpecificMemory` (JS + wasm heap) at end.
- Timing caveat: host load avg 9-14 during run (other jobs). ms numbers = upper bound, relative order holds.

## Results

| model | threads | download MB | load ms | ms/crop median | ms/crop mean | CER | CER no punct | WER | exact | accent acc | speech CER | mem Δ MB | UA mem MB |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **PaddleOCR PP-OCRv5 latin mobile** (det+rec) | 1 | 12.8 | 3526 | 230 | 460 | **0.172** | 0.168 | 0.601 | 10/45 | 0.46 | **0.149** | 450 | 103 |
| PaddleOCR PP-OCRv5 latin mobile | 4 | 12.8 | 3462 | **134** | 263 | 0.172 | 0.168 | 0.601 | 10/45 | 0.46 | 0.149 | 470 | 88 |
| TrOCR-small handwritten q8 (line split) | 1 | 68.1 | 5013 | 2621 | 2930 | 0.804 | 0.809 | 1.074 | 1/45 | 0.00 | 0.763 | 554 | 179 |
| TrOCR-small handwritten q8 | 4 | 68.1 | 4928 | 1149 | 1307 | 0.804 | 0.809 | 1.074 | 1/45 | 0.00 | 0.763 | 578 | 180 |
| TrOCR-small printed q8 | 1 | 68.1 | 5075 | 2780 | 3188 | 0.925 | 0.771 | 0.995 | 0/45 | 0.00 | 0.955 | 605 | 179 |
| Florence-2-base-ft q8 (`<OCR_WITH_REGION>`) | 1 | 279.2 | 10223 | 33320 | 34263 | 0.228 | 0.217 | 0.697 | 0/45 | 0.04 | 0.169 | 919 | 824 |
| Florence-2-base-ft q8 | 4 | 279.2 | 10479 | 12668 | 13263 | 0.228 | 0.217 | 0.697 | 0/45 | 0.04 | 0.169 | 1005 | 800 |
| Tesseract.js 7 `hun` (baseline) | 1 | 2.9 | 627 | 99 | 226 | 0.574 | 0.515 | 1.356 | 1/45 | **0.71** | 0.299 | 102 | 44 |

Raw: `bench/results/ocr-2026-10-19.json` (summary + every prediction + per-crop score).

## Findings

- **Paddle v5 latin wins.** Best CER, 13 MB, ~0.13-0.23 s/crop, sane memory. Multi-thread: ~1.7x faster per crop, same output.
- Paddle loses accents: 46% kept. `É->E`, `Á->A`, `Ő->O` on hand lettering. Dict has ő/ű; model just misses small marks. Opus keeps them. Hungarian meaning breaks on accents (`HÁT` vs `HAT`).
- Paddle failure modes: words glued at line joins (`EZA`, `VOLTAZ`), junk from sign borders (`FASZI-100`, `FAS21-1`), big SFX lettering garbage (r46), dense multi-line r30 (CER 0.44).
- TrOCR: unusable. English LM hallucinates (`maleill education.`). Single-line model, no accents in vocab output. Printed variant reads caps a bit better on short lines, still ~0.9 CER.
- Florence-2: second on CER (0.23), handles multi-line via `<OCR_WITH_REGION>`, but drops accents (4%), 279 MB, 13-34 s per crop on WASM, ~1 GB RAM. Not viable in browser.
- Tesseract `hun`: best accents (71%), tiny, fast, but noise from art/borders -> WER 1.36. Speech-only CER 0.30.
- WebGPU not tested (by design). `navigator.gpu` existed despite flag; EP forced to wasm anyway.

## Verdict

- Browser OCR default: **Paddle v5 latin**, 4 threads, worker. ~12 s for the 45-region strip on WASM 4 threads (21 s single). Florence: 10-26 min. TrOCR: 1-2.4 min.
- Not good enough alone for Hungarian: ~1 in 2 accents lost, CER 0.17 vs Opus.
- Plan: Paddle first -> per-region confidence + accent heuristic (Hungarian word list / LLM diacritic restore) -> LLM OCR fallback for low-confidence or SFX/sign regions. Or cheap LLM text-only pass "restore Hungarian accents, keep spelling" over Paddle output (no images, ~cents).
- Next to try: PP-OCRv6 small rec (21 MB, artistic text), upscale small crops 2x, drop det for single-line crops, confidence threshold tuning. Harness takes a new engine as one `src/<engine>.js` + `RUNS` entry.

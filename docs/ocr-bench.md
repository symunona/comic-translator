# OCR bench: in-browser OCR vs Opus

Strip: kristalyhologram (`data/2afc78b4…`), 45 regions with text (53 minus 8 `none`). Run 2026-10-19 (second full run; first run's file was overwritten by a smoke test, accuracy identical, times within ~20%), devbox (12 cores), Chromium 1234 headless.
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
| PaddleOCR PP-OCRv5 latin mobile (det+rec) | 1 | 12.8 | 3175 | 207 | 412 | 0.172 | 0.168 | 0.601 | 10/45 | 0.46 | 0.149 | 446 | 103 |
| PaddleOCR PP-OCRv5 latin mobile (det+rec) | 4 | 12.8 | 3195 | 101 | 227 | 0.172 | 0.168 | 0.601 | 10/45 | 0.46 | 0.149 | 466 | 105 |
| TrOCR-small handwritten q8 (line split) | 1 | 68.1 | 4396 | 2180 | 2491 | 0.804 | 0.809 | 1.074 | 1/45 | 0.00 | 0.763 | 584 | 179 |
| TrOCR-small handwritten q8 (line split) | 4 | 68.1 | 4539 | 1009 | 1170 | 0.804 | 0.809 | 1.074 | 1/45 | 0.00 | 0.763 | 546 | 185 |
| TrOCR-small printed q8 | 1 | 68.1 | 5087 | 2192 | 2523 | 0.925 | 0.771 | 0.995 | 0/45 | 0.00 | 0.955 | 568 | 179 |
| Florence-2-base-ft q8 (`<OCR_WITH_REGION>`) | 1 | 279.2 | 8512 | 25203 | 25435 | 0.228 | 0.217 | 0.697 | 0/45 | 0.04 | 0.169 | 943 | 824 |
| Florence-2-base-ft q8 (`<OCR_WITH_REGION>`) | 4 | 279.2 | 6907 | 11649 | 12118 | 0.228 | 0.217 | 0.697 | 0/45 | 0.04 | 0.169 | 892 | 825 |
| Tesseract.js 7 `hun` (baseline) | 1 | 2.9 | 590 | 107 | 201 | 0.574 | 0.515 | 1.356 | 1/45 | 0.71 | 0.299 | 58 | 44 |

Raw: `bench/results/ocr-2026-10-19.json` (summary + every prediction + per-crop score).

## Findings

- **Paddle v5 latin wins.** Best CER, 13 MB, ~0.10-0.21 s/crop median, sane memory. Multi-thread: ~2x faster per crop, same output.
- Paddle loses accents: 46% kept. `É->E`, `Á->A`, `Ő->O` on hand lettering. Dict has ő/ű; model just misses small marks. Opus keeps them. Hungarian meaning breaks on accents (`HÁT` vs `HAT`).
- Paddle failure modes: words glued at line joins (`EZA`, `VOLTAZ`), junk from sign borders (`FASZI-100`, `FAS21-1`), big SFX lettering garbage (r46), dense multi-line r30 (CER 0.44).
- TrOCR: unusable. English LM hallucinates (`maleill education.`). Single-line model, no accents in vocab output. Printed variant reads caps a bit better on short lines, still ~0.9 CER.
- Florence-2: second on CER (0.23), handles multi-line via `<OCR_WITH_REGION>`, but drops accents (4%), 279 MB, 13-34 s per crop on WASM, ~1 GB RAM. Not viable in browser.
- Tesseract `hun`: best accents (71%), tiny, fast, but noise from art/borders -> WER 1.36. Speech-only CER 0.30.
- WebGPU not tested (by design). `navigator.gpu` existed despite flag; EP forced to wasm anyway.

## Verdict

- Browser OCR default: **Paddle v5 latin**, 4 threads, worker. ~10 s for the 45-region strip on WASM 4 threads (~19 s single, sum of crop times). Florence: 9-19 min. TrOCR: 1-2 min.
- Not good enough alone for Hungarian: ~1 in 2 accents lost, CER 0.17 vs Opus.
- Plan: Paddle first -> per-region confidence + accent heuristic (Hungarian word list / LLM diacritic restore) -> LLM OCR fallback for low-confidence or SFX/sign regions. Or cheap LLM text-only pass "restore Hungarian accents, keep spelling" over Paddle output (no images, ~cents).
- Next to try: PP-OCRv6 small rec (21 MB, artistic text), upscale small crops 2x, drop det for single-line crops, confidence threshold tuning. Harness takes a new engine as one `src/<engine>.js` + `RUNS` entry.

## Translate bench: versions per backend (hu -> en)

Run 2026-10-19/20. `bench/translate-versions.sh` -> `POST /api/strips/{id}/translations/en/versions {spec}` per backend. Full translate + review, scene + 10 panel images. Dump: `bench/results/translate-en-2026-10-20.json` (all versions, regions, usage).

| v | backend | cost $ | in tok | out tok | time | bubbles | note |
|---|---|---|---|---|---|---|---|
| v1 | claude-cli:opus | ? | ? | ? | ? | 45/45 | old pipeline run, migrated, cost not split |
| v2 | user | - | - | - | - | 45/45 | editor test: fork of v1, r0 changed |
| v3 | claude-cli:haiku | 0.025 | 71.5k | 32.6k | 2m07s | 45/45 | more literal |
| v4 | claude-cli:sonnet | 0.269 | 70.6k | 10.8k | 1m10s | 45/45 | close to Opus |
| v5 | claude-cli:opus | 0.669 | 71.7k | 17.6k | 2m27s | 45/45 | quality bar |
| v6 | ollama qwen3.5 4b | 0 | 33.3k | 1.8k | 15m29s | 1/45 | gave up after few bubbles; review bad JSON -> draft kept |
| v7 | ollama gemma4 26b-a4b | 0 | 20.1k | 4.6k | 24m00s | 45/45 | own line breaks, some odd spelling ("YOUND ENUFF"), 5 over budget |
| v8 | ollama gemma4 12b, `json=1` | 0 | 20.2k | 3.4k | 21m28s | 45/45 | 3 runs without `json=1` died on broken JSON |

- claude-cli new versions total: **$0.96** (list-price equivalent, subscription).
- No paid API keys on devbox: anthropic / openrouter / gemini / qwen etc. skipped.
- Ollama: 4 GB GPU (1050 Ti) -> mostly CPU. Context 32k via `bench-*-32k` model tags (`ollama create`, Modelfile `num_ctx 32768`; default `OLLAMA_CONTEXT_LENGTH=12288` too small: prompt ~10-15k tok).
- Local models: **always `json=1`** (ollama grammar-constrained JSON). Without it gemma4 12b: trailing comma (now auto-repaired), raw newline in string, bad escapes.
- Review pass broken -> version keeps translate draft, `reviewError` set.
- Quality: not scored. Read side by side in editor/viewer (`?ver=`) or the bench artifact.

# LLM: cost, backends, browser inference, measurement

Test strip: `kristalyhologram.png` (620x5738, 10 panels, 53 regions). Measured 2026-10-19, `claude` CLI 2.1.303, model `opus` = `claude-opus-5-5`.

## Pricing used ($ / M tokens)

| model | input | cache write (1h, CLI) | cache read | output |
|---|---|---|---|---|
| Opus 5.5 | 4 | 8 | 0.20 | 20 |
| Sonnet 5.5 | 2 | 4 | 0.20 | 10 |
| Haiku 5.5 | 0.10 | 0.20 | - | 0.50 |

- CLI cache write = 2x input: Claude Code uses 1h cache TTL. Derived from CLI `total_cost_usd`, matches to the cent.
- CLI runs on subscription. `total_cost_usd` = list-price equivalent, not billed. Real limit = subscription quota / rate limits.
- Image tokens ≈ `w*h/750`. Panel debug image ~370 tok, 10 panels ~3.7k. Images are cheap. Output is not.

## Q1: translate cost per strip

### Measured, CLI

| what | calls | turns | cache write | cache read | out | $ |
|---|---|---|---|---|---|---|
| harness only, "say ok", full CLI | 1 | 1 | 14.2k | 12.5k | 4 | 0.116 |
| harness only, lean CLI | 1 | 1 | 1.7k | 0 | 4 | 0.013 |
| ocr p3 (5 images), full CLI | 1 | 6 | 17.8k | 41.4k | 773 | 0.166 |
| ocr p3, lean CLI, same output byte-for-byte | 1 | 6 | 4.0k | 4.8k | 773 | 0.049 |
| review:en, lean CLI (5.5k of out = thinking) | 1 | 12 | 22.5k | 41.8k | 10.2k | 0.392 |
| review:en, full CLI (earlier runs) | 1 | ? | ? | ? | ? | 0.53-0.60 |

- Full CLI overhead: Claude Code system prompt + tool defs + CLAUDE.md files under `/data` (cwd = data dir). ~12-14k tok cache write per call = **~$0.11 per call**. Then every Read turn re-reads it.
- Read tool = 1 turn per image. OCR panel with 8 crops = ~10 turns. Each tool result is cache-written at 2x input price.
- Lean flags (now default, `ClaudeCLI.Lean`): `--tools Read --system-prompt <1 line> --setting-sources "" --strict-mcp-config --disable-slash-commands`. `--bare` unusable: needs `ANTHROPIC_API_KEY`, no OAuth.

### Per strip, per stage

API columns = estimate: input ≈ prompt chars × 0.3 + image tokens, output = measured CLI output tokens (incl. thinking), single turn, no caching.

| stage | calls | CLI full (measured) | CLI lean | API Opus 5.5 | API Sonnet 5.5 |
|---|---|---|---|---|---|
| ocr | 10 (1/panel) | 1.80 | ~0.50 (p3 measured 0.049) | ~0.20 | ~0.10 |
| scene | 1 | 0.29-0.42 | ~0.25 est | ~0.29 | ~0.15 |
| translate | 1 | 0.41-0.51 | ~0.30 est | ~0.22 | ~0.11 |
| review | 1 | 0.53-0.60 | 0.39 measured | ~0.26 | ~0.13 |
| **first lang** | 13 | **~3.0** | **~1.45** | **~1.0** | **~0.50** |
| **each extra lang** | 2 | ~1.1 | ~0.70 | ~0.48 | ~0.24 |
| retranslate 1 region | 2 | ~0.5 | ~0.35 | ~0.25 | ~0.12 |

- Wall time first lang: ~5m45s (opus, concurrency 4). Scene + translate + review are serial, 1-2 min each, output-bound.
- Where money goes after lean: **output tokens**, 50-80% of scene/translate/review. Scene writes ~14k chars of JSON. Thinking ~half of review output.
- Haiku 5.5: ~1/40 Opus price. Quality on Hungarian hand lettering + jokes: did not check.

### Cheaper, in order of effort

| lever | saves | where |
|---|---|---|
| lean CLI flags | ~50% | done, this branch |
| cheaper model per stage (`LLM_OCR=...`) | ocr −50-99% | done: Router (Q2) |
| trim scene output (shorter descriptions, notes cap) | scene −30-50% | `prompts/scene.tmpl` |
| lower thinking / effort for ocr, review | 20-40% of output | `?effort=low` on spec (API backends) |
| direct API (no turns, images inline) | ~30% vs lean | done: `anthropic` backend (Q2) |
| prompt caching: panel images + scene as shared prefix of translate → review → extra langs | input side only, small | not done |
| Batch API | −50% | not done; API only, async |

## Q2: LLM backends (swappable, no Claude Code needed)

Pipeline only sees `llm.LLM.Call(ctx, prompt, images, schemaHint) -> JSON`. Built from env at startup (`llm.FromEnv`).

| piece | file | does |
|---|---|---|
| `Backend` interface | `internal/llm/llm.go` | `Complete(ctx, Request{System, Prompt, Images}) -> Response{Text, Usage, CostUSD}` |
| `Client` | `client.go` | schema hint, 1 JSON retry, call log + usage, global concurrency cap |
| `Router` | `router.go` | per-stage backend from `llm.WithStage` (ocr / scene / translate / review) |
| `claude-cli` | `claudecli.go` | `claude -p`, subscription, lean flags. Optional, dev only |
| `anthropic` | `anthropic.go` | official `anthropic-sdk-go`, images inline, streaming, `effort`, server-side refusal fallback |
| OpenAI-compatible | `openai.go` | chat completions + base64 `image_url`. One adapter for every preset below |
| prices | `prices.go` | $/M per model for cost when provider does not return it. `LLM_PRICES` env adds/overrides |

### Config

```sh
LLM=<provider>:<model>[?effort=low&json=1]      # default, every stage
LLM_OCR=...  LLM_SCENE=...  LLM_TRANSLATE=...  LLM_REVIEW=...   # per-stage override
<PROVIDER>_API_KEY=...   <PROVIDER>_BASE_URL=... # override preset URL
```

- No `LLM` -> `claude-cli:<-model flag>` (old behavior).
- `effort`: Anthropic `output_config.effort`; OpenAI-compat `reasoning_effort`. `json=1`: `response_format: json_object` (not all providers accept it with images; JSON is extracted from text anyway).
- Example: `LLM=gemini:gemini-3.8-flash LLM_OCR=qwen:qwen3.8-flash`.

| provider | base URL (preset) | key env |
|---|---|---|
| `anthropic` | SDK default | `ANTHROPIC_API_KEY` |
| `openrouter` | `https://openrouter.ai/api/v1` (returns real cost per call) | `OPENROUTER_API_KEY` |
| `qwen` | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` (new: `https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1` via `QWEN_BASE_URL`) | `DASHSCOPE_API_KEY` |
| `zai` (GLM) | `https://api.z.ai/api/paas/v4` | `ZAI_API_KEY` |
| `moonshot` (Kimi) | `https://api.moonshot.ai/v1` (base64 images only: fine) | `MOONSHOT_API_KEY` |
| `deepseek` | `https://api.deepseek.com` | `DEEPSEEK_API_KEY` |
| `minimax` | `https://api.minimax.io/v1` | `MINIMAX_API_KEY` |
| `stepfun` | `https://api.stepfun.ai/v1` (not verified) | `STEPFUN_API_KEY` |
| `gemini` | `https://generativelanguage.googleapis.com/v1beta/openai` | `GEMINI_API_KEY` |
| `openai` | `https://api.openai.com/v1` | `OPENAI_API_KEY` |
| `mistral` | `https://api.mistral.ai/v1` | `MISTRAL_API_KEY` |
| `siliconflow` | `https://api.siliconflow.com/v1` | `SILICONFLOW_API_KEY` |
| `ollama` | `http://127.0.0.1:11434/v1` | none |

### Compare providers on real prompts

`go run ./cmd/llmprobe -spec <provider>:<model> [-old] data/<id>/llm/<stage>-<n>.json ...` replays logged calls, prints result, tokens, $. Same images, same prompt. Run on 5-10 strips before switching a stage.

### Alternatives ($/strip = 53k in / 38k out, no caching, list price 2026-10-19)

Output is 75-85% of cost: output price decides ranking. Hungarian quality: **unknown for all**, no benchmark found. Eval with `llmprobe`.

| model | provider | vision | $/M in / out | $/strip | notes |
|---|---|---|---|---|---|
| Claude Opus 5.5 | anthropic | yes | 4 / 20 | 0.97 | current quality bar |
| Claude Sonnet 5.5 | anthropic | yes | 2 / 10 | 0.49 | safest cheaper swap |
| Claude Haiku 5.5 | anthropic | yes | 0.10 / 0.50 | 0.024 | cheapest Claude; wordplay untested |
| Gemini 3.8 Flash | gemini | yes | 0.75 / 3.75 | 0.18 | **2027-01-01 doubles** to 1.50 / 7.50. Top translation-index family |
| Gemini 3.1 Flash-Lite | gemini | yes | 0.25 / 1.50 | 0.07 | |
| Qwen3.8-Max | qwen | yes | 2 / 6 | 0.33 | strongest open multilingual family |
| Qwen3.7-Plus | qwen | yes | 0.40 / 1.60 | 0.08 | best Chinese pick for translate |
| Qwen3.8-Flash | qwen | yes | 0.15 / 0.47 | 0.026 | OCR candidate |
| GLM-5.3-Flash | zai | yes | 0.15 / 0.50 | 0.027 | 1M ctx |
| GLM-4.6V-Flash | zai | yes | free | 0 | free tier, OCR experiments |
| Kimi K2.6 | moonshot | yes | 0.95 / 4 | 0.20 | |
| Kimi K3 | moonshot | yes | 3 / 15 | 0.73 | reasoning, not worth it |
| DeepSeek `deepseek-flash` (V4.1) | deepseek | yes | 0.30 / 1.20 peak, half off-peak | 0.03-0.06 | V4-Pro is text only |
| MiniMax-M3 | minimax | yes | 0.30 / 1.20 | 0.06 | |
| GPT-5.6 Luna | openai | yes | 0.20 / 1.20 | 0.056 | |

Suggested trial order:

1. `LLM=anthropic:claude-sonnet-5-5 LLM_OCR=anthropic:claude-haiku-5-5` (~$0.39 -> lower risk, same family).
2. `LLM=gemini:gemini-3.8-flash` (~$0.18).
3. `LLM=qwen:qwen3.7-plus LLM_REVIEW=qwen:qwen3.8-max` (~$0.15).
4. `LLM_OCR=` any of Qwen3.8-Flash / GLM-5.3-Flash / Haiku (~$0.003/panel).

OpenRouter: one key for all of the above except `qwen3-vl-*`. Cheapest third-party hosts there are fp4-quantized: pin provider for stable quality.

## Q3: where inference runs. Target: browser, server runs none

Goal: server (2 cores, ~3.8GB RAM, no GPU) runs **zero inference**. Every model that can run on the client's machine runs in the browser. Server keeps: storage, LLM API proxy (keys stay server-side), usage metering.

| step | model | runs now | target | how |
|---|---|---|---|---|
| ingest, panels, order, erase, fit | none (CV) | server Go | server or browser | cheap CV. Can move to TS later; not inference |
| detect | RT-DETR-v2 ONNX | server CPU | **browser** | onnxruntime-web 1.30.0, WASM multi-thread |
| inpaint (text over art) | none yet | - | **browser** | fill / Telea default; AOT-GAN opt-in |
| ocr | Claude | server -> API | **browser first**, LLM fallback | PaddleOCR PP-OCRv5 latin; low-confidence -> cheap vision LLM |
| scene, translate, review | Claude | server -> API | server -> API (unchanged) | swappable backend (Q2) |

### Detect in browser

| model | size | notes |
|---|---|---|
| `detector.onnx` (current) | 168 MB fp32 | too big. WebGPU: 18x GridSample, AveragePool `ceil_mode=1` -> known ort-web bugs (#32438 D-FINE "Invalid dimension", needs patch) |
| `detector_int8.onnx` | 44 MB | same arch |
| **`detector-v4-s_int8.onnx`** | **11.1 MB** | newer, 10.3M params, static 640x640, same 3 classes, same IO (`orig_target_sizes` = [W,H]). Native CPU 373 ms 1 thread / 176 ms 4 threads; WASM est. 0.3-0.8 s/panel |

- Source: `huggingface.co/ogkalu/comic-text-and-bubble-detector`, Apache-2.0.
- WASM backend: all ops supported. WebGPU: TopK + int8 ops fall back to CPU, little gain. Ship WASM; WebGPU later, optional.
- Multi-thread WASM needs COOP/COEP headers (`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`) on the page. Caddy on server.
- Proven: libre-manga-translator (browser extension) ships this exact 11.1 MB model on ort-web.
- Quality v4-s vs current r50: not compared. Do before switch.

### Inpaint in browser

| model | size | license | use |
|---|---|---|---|
| fill (current Go CV logic, port to TS) | 0 | - | white bubbles. Covers Napirajz |
| OpenCV.js Telea | 11 MB | Apache-2.0 | text on flat color |
| **AOT-GAN** (`ogkalu/aot-inpainting`) | 23 MB | MIT | manga-trained, any size, WebGPU + WASM. Text over art |
| MI-GAN | 28 MB | MIT | photos-trained, 0.5 s on phone |
| LaMa-manga | 206 MB | Apache-2.0 | best, desktop opt-in only |

### OCR in browser

- **Google ML Kit: no.** Android/iOS only. No web, WASM or WebGPU port.
- Chrome `TextDetector` (Shape Detection API): behind flag, wraps OS OCR, no Linux. No.
- Chrome Prompt API (Gemini Nano, image input): desktop only, 22 GB disk, languages en/ja/es/de/fr, **no Hungarian**. No.

| option | download | WebGPU | Hungarian ő/ű | verdict |
|---|---|---|---|---|
| **PaddleOCR PP-OCRv5 latin mobile rec** | 8 MB | yes + WASM | `ppocrv5_latin_dict.txt` has ő Ő ű Ű ("hu" official). Old v3/v4 latin dict lacks ő/ű | **first pick** |
| PP-OCRv6 small rec | 21 MB | yes | dict has ő/ű, "artistic text" benchmark | A/B vs v5 |
| Tesseract.js 7 + `hun` | 3-12 MB | no | ő -> ö errors, weak on hand lettering | no |
| Qwen3.5-0.8B (transformers.js) | ~650 MB | yes | ok-ish, may "fix" spelling | desktop opt-in re-read |
| TrOCR / Florence-2 / SmolVLM / Moondream | 190 MB-1.4 GB | yes | English-centric | no |

- JS package: `ppu-paddle-ocr` 6.6.1 (MIT): `/web` entry, WebGPU with WASM fallback, `V5_LATIN_MOBILE_MODEL` preset.
- Paddle gives text + confidence, not `kind` (speech/sfx/sign) or `caps`. Kind: detector class + scene LLM call can assign. Or: keep LLM OCR only for low-confidence crops.
- Local ollama probe (devbox, earlier): gemma4 12b 1 letter wrong, qwen3.5 4b lost line breaks. Server-side local LLM OCR is out anyway (server).

### Browser budget

- Default download ~20 MB (detector 11 + OCR 8), +23 MB AOT-GAN when needed. Cache via Cache API / OPFS; serve from HF or CDN, not server.
- iOS Safari kills tabs ~1-1.5 GB: no 200 MB+ models on mobile.
- WebGPU: Safari 26 / iOS 26 yes; Firefox Windows + Apple Silicon only; Chrome Android 121+. Design must work on WASM alone.

### Prior art (in-browser)

| project | license | stack |
|---|---|---|
| libre-manga-translator (`github.com/mrdhnto/libre-manga-translator`) | ? | RT-DETR v4-s 11 MB, PaddleOCR / PP-OCRv6, fill -> Telea, LaMa opt-in, WebLLM. Read `docs/technical.md` |
| Kites (`github.com/Unheat/Kites`) | GPL-3.0 | YOLO11n, PaddleOCR v3-v6, LaMa-manga / AOT / Telea, WebLLM |
| vermilion10/comic-translator | MIT | own detector, PP-OCRv6, opencv.js Telea, WebLLM Gemma |

### Migration plan (not started)

1. Frontend: ort-web + v4-s detector in a Web Worker. Output = same `regions` JSON as Go `detect`+`order`. POST to new `PUT /api/strips/{id}/stages/detect` (server validates, stores). Go detector stays as dev fallback, off on server.
2. Compare v4-s (browser) vs r50 (server) boxes on 5-10 strips.
3. PaddleOCR v5 latin in worker per crop; confidence < threshold -> server LLM OCR for that panel only. `kind`/`caps` from scene call.
4. Erase: port Go `clean` CV to TS (canvas), AOT-GAN for non-bubble text. Server stores `clean.png` + overlays uploaded by client.
5. Server: drop ONNX runtime dep on server build.

## Billing (note for later)

- Charge credits for **LLM API usage only** (browser inference is free to us).
- Price = **>= 2x** actual provider cost per call. Source of truth: per-call `costUsd` in `data/<id>/llm/*.json` (provider-reported for OpenRouter, else `prices.go`), aggregated by `GET /api/strips/{id}/usage`.
- Needs later: per-user attribution (calls carry strip id only), cost for `claude-cli` is list-price equivalent, not real spend.

## Q4: per-stage token + cost measurement

| piece | where |
|---|---|
| per call log | `data/<id>/llm/<stage>-<n>.json`: + `usage {input_tokens, cache_creation_input_tokens, cache_read_input_tokens, output_tokens}`, `numTurns`, `modelUsage` (raw, incl. `thinkingTokens`), `costUsd`, `duration` |
| aggregation | `llm.ReadUsage(dir)` -> per stage + total. Computed from logs, no extra file. Stage names: `ocr` (all panels), `scene`, `translate:<lang>`, `review:<lang>`, `retranslate:<lang>` (editor per-region retranslate: translate + review calls) |
| API | `GET /api/strips/{id}/usage` -> `{stages:[StageUsage], total}` |
| frontend | collapsible "LLM cost $X" panel in Work sidebar after first run, refreshes on run done / translation update |
| CLI | `cd backend && go run ./cmd/llmusage [-data dir] [id-prefix ...]`. No ids = every strip |

- Old logs (before this branch) have cost, no tokens: counted as `untracked`, shown as `–` / `*`.
- Totals include every logged call: dev reruns, retries, retranslates. Clean per-run numbers: fresh strip or empty `llm/`.

Example (`go run ./cmd/llmusage 2afc`):

```
2afc78b4  kristalyhologram.png
         stage  calls  turns   input  cache write  cache read  output  cost $  $/call    time
           ocr     10      0       -            -           -       -   1.804   0.180   2m22s
         scene      2      0       -            -           -       -   0.712   0.356   3m58s
  translate:de      1      0       -            -           -       -   0.512   0.512   1m57s
  translate:en      3      0       -            -           -       -   1.119   0.373    3m0s
     review:de      1      0       -            -           -       -   0.596   0.596   2m27s
     review:en      4     12      6*       22508*      41796*  10194*   1.765   0.441   5m47s
         total     21     12      6*       22508*      41796*  10194*   6.508   0.310  19m31s
  * 20 calls logged before token capture: cost known, tokens missing
```

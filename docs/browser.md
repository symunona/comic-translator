# Browser detect (branch `browser-offload`, experimental)

> Describes the server pipeline, kept on tag `server-backend`. The current app runs the pipeline in the browser: see the README.

Q3 step 1 from `docs/llm.md` done: bubble/text detection runs in the browser. Server runs no detector.

Env: https://comic-browser.tmpx.space (server `~/comic-browser`, `comic-browser.service`, port 4740, own data dir, same basic auth as prod). Deploy: `just deploy-browser`. Logs: `just logs-browser`.

## What runs where

| step | where | how |
|---|---|---|
| ingest, panels | server Go | unchanged. `GET /api/strips/{id}/panels` computes + caches panels on demand |
| detect | **browser Web Worker** | onnxruntime-web 1.30.0, WASM EP, `detector-v4-s_int8.onnx` |
| detect postprocess (NMS, contained drop, text→bubble assign) | server Go | same `panelRegions()` as server detector. Browser sends raw model output only |
| order, ocr, scene, clean, translate, review | server | unchanged. LLM = claude CLI on server (env `LLM` unset) |

## Flow

1. `work.ts connect()` -> `GET /api/config` -> `{clientDetect: true}` when server started with `-detector ""`.
2. `GET /api/strips/{id}/panels` -> `{panels, detected}`. `detected` -> skip to 5.
3. Worker (`frontend/src/lib/detect/worker.ts`): fetch `orig.png` once, per panel `createImageBitmap` crop + resize 640x640, RGB/255 CHW, `orig_target_sizes=[w,h]`. Keeps score >= 0.3. Progress -> Checklist "Detect bubbles" bar.
4. `PUT /api/strips/{id}/stages/detect` body `{model, device, ms, panels:[{panelId, detections:[{class, score, box:[x1,y1,x2,y2] panel px]}]}]}`. Server filters score >= 0.35, clips to panel, runs `panelRegions`, saves `stages/detect@v2.json`. Same file shape as server detect. Idempotent: existing detect stage wins.
5. SSE `/events` as before. Detect stage = cached. If detect missing and no server detector: stage error `detect runs in the browser: upload detections first`.

Server flags: `-detector ""` (no ORT load), `-models <dir>` (serves `/models/*.onnx`, immutable cache), `-isolate` (COOP/COEP from Go; local only, Caddy sets them on server), `-debug` (see Debug).

Browser EP: `?ep=wasm|webgpu|auto` and `?threads=N` on the page URL. Default `wasm` (WebGPU slower, see bench). `auto` = WebGPU when a hardware adapter exists (SwiftShader / fallback adapter rejected), WASM on any WebGPU error. WebGPU path lazy-loads `onnxruntime-web/webgpu` + asyncify wasm (26.8 MB, 6.7 MB gzip), only when picked.

## Debug flag

| what | value |
|---|---|
| flag | `-debug` or env `DEBUG=1`. Default off |
| on | `comic-browser.service` only. Prod `comic-translator.service` untouched |
| API | `GET /api/config` -> `{clientDetect, debug}`; debug adds `detector` (server model file, `""` = browser) + `llm: {ocr, scene, translate, review}` backend specs |
| UI, debug on | each step: `where · what` line (`server · CV`, `browser · detector-v4-s_int8.onnx · 11.1 MB · wasm×4 · 9.6s`, `LLM · claude-cli opus`). Local/free steps tagged `local · free` (server CV, browser detector, `ollama`). Substeps: `backend:model · in/out/cache tokens · time · $`. Raw `$` per step + strip, old `LLM cost` table (+ credits column) |
| UI, always | credits per step, `N paid calls` per step, substep list with credits per call, strip total `N paid LLM calls · X credits` |

- Detect run info: browser PUT body now has `bytes` (model size). Server stores `stages/detect-run@v2.json` `{where, model, bytes, device, ms, panels, regions, at}`. Only for browser uploads.
- Not yet run LLM step: shows Router spec + `(planned)`.
- Live: usage refetched on every ocr/scene/translate/review stage event + retranslate. One `ReadDir` + small JSON reads per refresh.

## Credits

| rule | where |
|---|---|
| billed = **2 ×** provider `costUsd` (docs/llm.md Billing) | `backend/internal/llm/credits.go` `BillMarkup` |
| 1 credit = **$0.01 billed** | same, `USDPerCredit` |
| per call `ceil(costUsd × 200)`, step / strip = sum of calls | `llm.Credits` |
| `ollama` (local) and failed calls with $0 = 0 credits, not "paid" | `llm.IsLocal` |
| browser + server CV steps = free | |

- Only place with the rule: Go. Frontend sums `credits` from `GET /api/strips/{id}/usage`.
- `/usage` now also: `calls: [{name, stage, label, backend, model, attempt, error, local, tokens, turns, costUsd, credits, durationMs, time}]`, `paid` + `credits` per stage and total, `detect` (detect-run).
- Language picker estimate (`frontend/src/lib/credits.ts langCredits`): mean credits of translate+review per already done lang. None yet: `ceil(regions × 2.6)` (docs/llm.md: extra lang ~$0.70 lean opus / 53 regions).
- kristalyhologram (all logged calls, incl. dev reruns): 20 paid calls, $6.12, **1234 credits**. One clean lang ~$1.45 lean -> ~290 credits.
- `claude-cli` cost = list-price equivalent, not real spend. Credited anyway (same as API price).

## Sizes

| asset | bytes | note |
|---|---|---|
| `detector-v4-s_int8.onnx` | 11.1 MB | served same-origin from `/models/` (COEP-safe), cached in Cache API `comic-models-v1`. sha256 `5fe9e4f5…31ea79` = HF |
| `ort-wasm-simd-threaded.wasm` | 14.2 MB (3.7 MB gzip) | Caddy `encode_text`. Compression over Caddy not verified (auth) |
| worker chunk + ort glue mjs | 73 KB + 24 KB | |
| main bundle | 80 KB | unchanged-ish |
| server model before | 168 MB | `detector.onnx` r50 fp32 + 20 MB libonnxruntime. Not shipped to `~/comic-browser` |

## Timings (kristalyhologram, 620x5738, 10 panels)

Headless Chrome on devbox (12 cores). Prod build.

| mode | model load+session | first panel | next panels | total |
|---|---|---|---|---|
| wasm×4 (COOP/COEP, `crossOriginIsolated`) | 0.5-0.7 s | 0.39-0.56 s | ~0.35 s | 4.1-4.5 s |
| wasm×1 (no isolation, fallback) | 0.7-0.9 s | ~1.0 s | ~0.87 s | 9.6 s |
| node, ort-web wasm×1, dummy input | - | 1.06 s | 0.87 s | - |

- Threads = `min(4, hardwareConcurrency)` when isolated, else 1. Both paths give byte-identical `detect@v2.json`.
- Laptop / phone timings: did not check. Laptop Chrome needs the basic-auth password, not available to the agent.
- WebGPU: not tried. Brief: known ort-web bugs with this arch.

## v4-s (browser) vs r50 (server) on kristalyhologram

| | server r50 | browser v4-s |
|---|---|---|
| regions | 53 (text_bubble 30, text_free 20, bubble 3) | 44 (text_free 27, text_bubble 16, bubble 1) |
| matched IoU >= 0.5 | 38, mean IoU 0.91, min 0.72 | |
| regions with `replace=true` in prod OCR (22) | 22 | 20 found (>= 80% covered) |
| regions with any OCR text (45) | 45 | 40 covered |

- Misses that matter: `HÍREK` (47x22, p1) and `ROPI` (37x17, p5). Tiny text. Both translated in prod.
- Other server-only: sign/none dupes, overlapping double boxes that v4-s returns as one larger box (p6, p8).
- v4-s labels more as `text_free`, fewer `text_bubble`. Affects nothing downstream except `detClass` shown.
- End to end on server (deployed build, browser boxes): order -> ocr -> scene -> clean -> translate:en -> review:en all done, 39 regions translated.
- Verdict: speech bubbles fine. Tiny captions/signs weaker. Check 5-10 more strips before trusting it (Q3 step 2).

## WASM vs WebGPU bench (2026-10-19, kristalyhologram, 10 panels)

`/bench.html?id=<strip>&modes=wasm:1,wasm:4,webgpu,auto&runs=3` (prod build). Raw: `bench/detect-2026-10-19-{cpu,gpu}.json`, diff: `python3 bench/boxdiff.py bench/*.json`.
Headless Chrome 152 on devbox. **Box loaded**: load avg 14-21 (ollama ~570% CPU + other agent), GPU shared with ollama (3.0 / 4.0 GB). Numbers ~2x the idle ones above. Ranges over 3 runs, seconds, cold worker each run (model bytes from Cache API).

| chrome | mode | device | load+session | first panel | next panels (mean) | total |
|---|---|---|---|---|---|---|
| no GPU (`--disable-gpu`) | wasm×1 | wasm×1 | 1.3-1.9 | 2.1-2.4 | 2.0-2.1 | 21.7-22.4 |
| no GPU | wasm×4 | wasm×4 | 1.1-1.2 | 0.8-1.1 | 0.84-0.89 | 9.6-10.1 |
| no GPU | auto | wasm×4 (no adapter -> fallback) | 1.1 | 0.8-1.0 | 0.88-0.94 | 9.9-10.6 |
| no GPU | webgpu | error `no hardware WebGPU adapter` | | | | |
| GTX 1050 Ti | wasm×1 | wasm×1 | 1.2-2.3 | 2.0-2.7 | 1.8-2.3 | 19.8-25.7 |
| GTX 1050 Ti | wasm×4 | wasm×4 | 1.0-1.3 | 0.8-1.1 | 0.93-0.94 | 10.4-10.8 |
| GTX 1050 Ti | webgpu | webgpu · nvidia pascal | 2.0-4.4 | 3.1-4.5 | 2.4-3.2 | 26.8-35.8 |
| GTX 1050 Ti | auto | webgpu · nvidia pascal | 1.9-2.5 | 3.5-3.8 | 2.4-2.9 | 26.7-32.3 |

Boxes (score >= 0.35, i.e. what server keeps) vs wasm×4:

| vs wasm×4 | dets | matched | min IoU | max box diff | max score diff |
|---|---|---|---|---|---|
| wasm×1, auto(cpu), reruns | 74 / 74 | 74 | 1.0 | 0 px | 0 |
| webgpu | 74 / 77 | 72 | 0.93 | 3.7 px | 0.07 |

- WASM: byte-identical across threads/runs. WebGPU: fp drift, 2-3 boxes cross the 0.35 threshold (e.g. p5 `text_free` 0.348 -> 0.355). Final regions: wasm 44, webgpu 46.
- WebGPU **~3x slower** than wasm×4 here: int8 + TopK ops fall back to CPU, per-op transfers. Hence default `wasm`. Retry on idle box / newer GPU before changing.
- End to end, app (not bench), both chromes: browser detect -> PUT -> `detect-run` saved -> rest of pipeline cached, 0 LLM calls.
- Headless WebGPU on devbox needs: `--enable-unsafe-webgpu --enable-features=Vulkan --use-vulkan=native --use-angle=vulkan --ignore-gpu-blocklist`. Without `--use-vulkan=native`: Dawn only has the ANGLE GLES compat adapter, `requestAdapter()` = null. `--use-webgpu-adapter=default` -> SwiftShader (rejected).
- `onnxruntime-web/webgpu` 1.30 loads `ort-wasm-simd-threaded.asyncify.*`, not `jsep` (`webgpuInit is not a function` with jsep paths).

## Gotchas

- `onnxruntime-web/wasm` bundle + `wasmPaths = {mjs, wasm}` via vite `?url`. `optimizeDeps.exclude: ["onnxruntime-web"]`, `worker.format: "es"`.
- COEP `require-corp`: every subresource must be same-origin or CORP. Model on HF would need CORS + CORP -> served from own server instead.
- HTTP cache keeps old COOP/COEP headers on 304. Testing isolation on/off needs a fresh profile.
- Local dev: API :4740, Vite :4742 (`VITE_PORT=4742 API_TARGET=http://127.0.0.1:4740 pnpm dev`; :4741 is ux-viewer). Vite sends COOP/COEP and proxies `/models`.

## Next

- WebGPU: fp16 model or non-int8 v4-s may change the picture; recheck on idle GPU / Apple Silicon / phone.

- Q3 step 2: compare on 5-10 strips; lower `minScore` for v4-s if tiny text keeps missing.
- Q3 step 3: PaddleOCR in the same worker.
- Drop `onnxruntime_go` from the server build (binary still links it; never loaded with `-detector ""`).

# Browser detect (branch `browser-offload`, experimental)

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

Server flags: `-detector ""` (no ORT load), `-models <dir>` (serves `/models/*.onnx`, immutable cache), `-isolate` (COOP/COEP from Go; local only, Caddy sets them on server).

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

## Gotchas

- `onnxruntime-web/wasm` bundle + `wasmPaths = {mjs, wasm}` via vite `?url`. `optimizeDeps.exclude: ["onnxruntime-web"]`, `worker.format: "es"`.
- COEP `require-corp`: every subresource must be same-origin or CORP. Model on HF would need CORS + CORP -> served from own server instead.
- HTTP cache keeps old COOP/COEP headers on 304. Testing isolation on/off needs a fresh profile.
- Local dev: API :4740, Vite :4742 (`VITE_PORT=4742 API_TARGET=http://127.0.0.1:4740 pnpm dev`; :4741 is ux-viewer). Vite sends COOP/COEP and proxies `/models`.

## Next

- Q3 step 2: compare on 5-10 strips; lower `minScore` for v4-s if tiny text keeps missing.
- Q3 step 3: PaddleOCR in the same worker.
- Drop `onnxruntime_go` from the server build (binary still links it; never loaded with `-detector ""`).

# Free path: the whole pipeline on the user's machine

Goal: a no-key option in the key modal. OCR, source language, translation run in the browser on the user's CPU/GPU from cached HF models. No OpenRouter, no server. Quality below the paid path; must be honest about that in the UI.

Status: v1 and v2 built on branch `free-path` (`frontend/src/lib/free/`), benched 2026-10-27, see **Measured** right below. The design sections after it are the original plan; numbers marked *est.* there were not measured. Model sizes checked on the HF API 2026-10-27.

## Measured (2026-10-27)

10 strips from `ocr/data` (6 hu→en, 4 en→hu), 122 text bubbles, GT boxes from `stages/ocr@v1.json`, GT text from `bench/llm/gt.json`. Reference translation: the paid pipeline's `tr/<lang>@v1.json`. Judge: Opus via claude-cli, blind, per bubble 2 = usable / 1 = gist / 0 = wrong, score = points / max (`bench/free/judge.py`). Same lineup in one pass, so the rows compare.

| system | score | usable | wrong | hu→en score | en→hu score |
|---|---|---|---|---|---|
| **v1**: Paddle + Chrome `Translator` | **45.5%** | 24.6% | 33.6% | 40.7% | 80.0% |
| **v2**: Paddle + Qwen3.5-0.8B re-read + Chrome `Translator` | **57.8%** | 37.7% | 22.1% | 52.8% | 93.3% |
| v1 fallback: Paddle + opus-mt | 38.5% | 23.0% | 45.9% | 35.0% | 63.3% |
| ceiling: perfect OCR + Chrome `Translator` | 79.1% | 62.3% | 4.1% | 77.1% | 93.3% |

- First v1-only pass (same judge, no v2 in the lineup): v1 44.3%. A pass that also had Qwen *translating* (14%, it hallucinates and refuses) inflated everything else by ~9 points: anchor effect, ignore that pass (`free-v2-judge-2026-10-27.json`).
- OCR is the bottleneck, not MT: Chrome on perfect text 79%. Paddle CER 0.181, accents kept 32%. Qwen re-read on the crop with the Paddle draft in the prompt: CER **0.120**, accents 43%. It also recovers whole lines Paddle missed. Guarding the re-read by edit distance to the draft made it worse (0.138), so v2 takes the re-read unless it is empty or chatty.
- Qwen3.5-0.8B as translator: 14%. Not used. Translation stays with Chrome / opus-mt.
- Language guess (auto, no picker): Chrome `LanguageDetector` 10/10 strips. Without it: stopword vote, then `franc-min`: 10/10 (`franc` alone 9/10, called the 40-char "exit vim" strip Polish).
- Speed: Paddle 1-7 s/strip on 1 WASM thread (laptop i7 / devbox). Chrome `Translator` < 1.5 s/strip. opus-mt 1-10 s/strip. **Qwen re-read: ~29 s per bubble on a GTX 1050 Ti** (q4, no `shader-f16`), so 10-20 min for a typical strip. Model 682 MB (q4) / 616 MB (q4f16).
- WebGPU breakage: laptop (Intel Raptor Lake UHD, headless Chrome 148) loads Qwen, then every `OrtRun` fails: `mapAsync … A valid external Instance reference no longer exists`. Also on the main thread, also text-only. devbox (Chromium 1234, NVIDIA Pascal via Vulkan) works. That Chrome ran headless with `--use-angle=swiftshader-webgl`, so this may be a headless artefact; not yet tried in a normal Chrome window. v2 stays opt-in and falls back to Paddle text on any error (it does).
- Chromium (not Chrome) exposes `Translator` with `downloadable` but never downloads. The app gives up after 45 s without progress and falls back to opus-mt when the pair exists.

### Accent restore (word-frequency table)

Paddle and the VLM both drop accents. Fix per word: unaccented form → most frequent accented spelling, only when that spelling has ≥ 70% of the uses. Tables from FrequencyWords (OpenSubtitles 2018, colloquial, fits comics), top 500k words per language, built by `bench/free/accent_tables.py`, hosted on HF: [`bboborjan/comic-translator-accents`](https://huggingface.co/datasets/bboborjan/comic-translator-accents) (dataset, CC BY-SA 4.0, attribution in every file header and the card). App pins revision `ef34796`. Loaded only for the detected source language, cached in `comic-models-v1`. HF serves gzip and CORS for any origin.

28 languages shipped (corpus word accuracy before → after, in-sample, per-language table in the dataset card): hu 62.5 → 96.6%, cs 57 → 96.8, sk 61.7 → 97.3, pl 65.7 → 96.9, tr 61.2 → 96.4, is 49.4 → 99.0, de 93.2 → 99.1, fr 88.2 → 96.1, es 86.9 → 95.2, pt 84.2 → 96.5, ro 75.1 → 91.1, vi 17.9 → 67.1, … Skipped (gain < 2 points): it, nl, af, eu. Sizes 0.02-0.90 MB gzip. Fold map for letters NFD does not split (ł đ ø ß æ œ ı ħ ŀ) must match between the builder and `accents.ts`.

| OCR text (6 hu strips, 107 bubbles) | CER | accents kept |
|---|---|---|
| Paddle | 0.192 | 32% |
| Paddle + accent table | 0.167 | **78%** |
| Paddle + Qwen re-read | 0.132 | 43% |
| Paddle + Qwen re-read + accent table | **0.109** | 80% |

Judged, one pass, five candidates (this pass scored ~5 points higher across the board than the clean pass above, compare within the table):

| system | score | usable | wrong |
|---|---|---|---|
| v1 Paddle + Chrome | 50.4% | 29.5% | 28.7% |
| **v1 + accent table** | **59.0%** | 39.3% | 21.3% |
| v2 + Qwen re-read | 63.5% | 46.7% | 19.7% |
| **v2 + accent table** | **67.2%** | 49.2% | 14.8% |
| ceiling: perfect OCR | 86.5% | 77.0% | 4.1% |

- Most of the GPU model's gain for < 1 MB, no GPU, no wait. Stacks with the re-read. Applied after Paddle and again after the re-read. Ambiguous words (HAT/HÁT, fr OU/OÙ) stay as read.
- Other options seen: `hunaccent` (juditacs, MIT, decision trees, C++, needs a WASM build), Hunspell `dictionary-hu` + `nspell` (Hungarian affix rules too heavy for nspell), HF diacritic models exist for vi/ro/yo only.

Raw: `bench/results/free-acc-2026-10-27.json`, `free-acc-judge-2026-10-27.json`, `bench/results/free-v1-2026-10-27.json`, `free-v2-devbox-2026-10-27.json` (OCR + re-read), `free-v2-2026-10-27.json` (all candidates), `free-v1-judge-*.json`, `free-v2-judge-noqwen-2026-10-27.json`.

### What shipped

| piece | where |
|---|---|
| Paddle v5 latin OCR in a worker, models pinned to HF rev `bf1d5ed…`, Cache API `comic-models-v1` | `lib/free/paddle.worker.ts`, `models.ts` |
| kind from detector class, caps by ≥80% upper letters, low-confidence lines (< 0.5) dropped | `lib/free/engine.ts` |
| language: Chrome `LanguageDetector` → stopwords → `franc-min` | `lib/free/lang.ts` |
| accent restore from per-language word-frequency tables (28 langs, HF) | `lib/free/accents.ts`, `bench/free/accent_tables.py` |
| auto-publish while "I share my translations" is on: right after any run (paid or free), and after edits / retranslate / replace toggles, 15 s after the last edit, at most once a minute per strip; pending publish flushed on language switch and on leaving the page; never pops the captcha (no session → manual button stays) | `lib/work.ts` (`schedulePublish`), `pages/Work.tsx` |
| MT: Chrome `Translator` (one click to download a pack) → opus-mt (direct pair or pivot through en) | `lib/free/mt.ts`, `opus.worker.ts` |
| opt-in GPU re-read: Qwen3.5-0.8B ONNX, transformers.js WebGPU, q4f16 when `shader-f16`, else q4 | `lib/free/vlm.ts`, `vlm.worker.ts` |
| per step, not per app: `settings.steps` holds `free`, `recommended` (= `settings.model`) or any OpenRouter model id for each of ocr / scene / translate / review; free scene and review are skipped. Each step reads its engine when it starts, so a switch mid-run applies from the next step. Dropdown + "rerun" per step in the pipeline (`rerunFrom`: that step and every later one; reruns of text or scene drop every language's drafts); "Other models" lists OpenRouter models with image input. A rerun over hand edits asks first; the edited one stays under Versions | `lib/settings.ts`, `components/Checklist.tsx`, `lib/llm/models.ts`, `lib/work.ts` |
| Free / OpenRouter switch on the home page and in the editor header: sets every step to `free` or `recommended`. While waiting for a key, switching to Free continues the run. After a free run (not edited) the sidebar offers "Run with OpenRouter", a new version on the recommended model | `components/ModeToggle.tsx`, `pages/Upload.tsx`, `pages/Work.tsx` |
| `readFree` / `translateFree` in `work.ts`: free translate skips scene and review, model tagged `free:<reader>+<engine>` (reader from `ocrBy`: `paddle-v5-latin[+qwen3.5-0.8b]`, the SOTA model id, `shared` or `demo`). Paddle OCR marked `ocrFree` so turning SOTA reading on re-runs OCR | `lib/work.ts` |
| "New version" under the pipeline: reruns the read/translate steps with the current toggles, no shared lookup; the current translation moves to `versions[lang]` (10 kept), a picker above the bubbles swaps them back. A new version auto-publishes like any run | `lib/work.ts` (`newVersion`, `pickVersion`), `pages/Work.tsx` |
| first run without a key asks once: "Go with OpenRouter" (opens the key form) or "Free, lower effort" (all steps free). The answer is kept in `settings.pathChoice`; closing the dialog stores `dismissed`, after which it no longer pops up and the sidebar offers the same two buttons | `components/KeyDialog.tsx`, `pages/Work.tsx`, `work.goFree` |
| "Google" per bubble: suggestion from Google Translate's extension endpoint (`clients5.google.com/translate_a/t`, no key, open CORS), shown under the bubble with "use". Sends that bubble's text to Google, only on the click | `lib/free/google.ts`, `components/RegionCard.tsx` |
| key modal card "Or free, on this computer" + GPU checkbox (shown only with a WebGPU adapter) | `components/KeyDialog.tsx` |
| bench: `free-bench.html` (dev only), `bench/free/{fixtures.py,run.mjs,judge.py,e2e.mjs}` | |

Rerun: `python3 -I bench/free/fixtures.py`, vite on :4731, Chrome with CDP, `node bench/free/run.mjs <cdp> "http://127.0.0.1:4731/free-bench.html[?v2=1&systems=]" <out>`, `python3 -I bench/free/judge.py <out> <judge.json> <systems…>`. Chrome `Translator` needs a secure context: tunnel vite to the test box's `127.0.0.1`.

## TL;DR

| | |
|---|---|
| v1 ("Free, quick") | Paddle v5 latin OCR (13 MB, already benched) + Chrome built-in `Translator` (model managed by Chrome) or opus-mt (105 MB/pair, hu↔en only). Scene, review skipped. ~13-120 MB. WASM only, no WebGPU needed |
| v2 ("Free, better", WebGPU) | + Qwen3.5-0.8B VLM, transformers.js ONNX q4f16, **616 MB**. Planned: accent repair on crops, language guess, context translation. **Measured: the re-read helps (45% → 58%), translation by Qwen does not (14%); ~29 s/bubble on a 1050 Ti** |
| later, opt-in | Qwen3.5-2B (WebLLM, 1.0 GB, 2.2 GB VRAM) or Gemma 4 E2B (WebLLM, 2.7 GB, 3.4 GB VRAM) for translate only. Outside the "few hundred MB" budget |
| always first | hub shared translations. A shared file in *another* language already gives LLM-quality OCR + scene; the free path then only translates |

## What browsers can run today

| runtime | what | needs | notes |
|---|---|---|---|
| WASM (onnxruntime-web 1.31.1, transformers.js 4.3.1) | any ONNX model on CPU | nothing | no COOP/COEP here → **single thread**, no SIMD threads. Paddle: ~19 s/strip ×1 vs ~10 s ×4 (`ocr-bench.md`). LLMs >300M params on 1 thread: minutes per strip. Usable for small seq2seq MT and Paddle, not for decoder LLMs |
| WebGPU | ort-web `webgpu` EP, transformers.js `device:"webgpu"`, WebLLM (MLC/TVM) | Chrome/Edge desktop 113+, Chrome Android 121+, Safari 26 / iOS 26, Firefox Windows + Apple Silicon (`llm.md`) | **does not need cross-origin isolation.** The real path for LLM/VLM. int8 ops / TopK fall back to CPU (why the detector stays WASM); fp16/q4f16 LLM graphs are what it is built for. `shader-f16` feature needed for q4f16 (most desktop GPUs; else q4f32 variants, ~+10% size) |
| WebNN | ort-web `webnn` EP, NPU/GPU | Chrome behind flag / origin trial (verify before relying) | not a v1 target |
| Chrome built-in AI | `Translator`, `LanguageDetector` | Chrome desktop 138+, not mobile | Hungarian is in Chrome's Translator language table (`developer.chrome.com/docs/ai/translator-api`). Chrome downloads and owns the pack, not counted against our quota. Plain sentence MT: no context, no length budget, no JSON. Prompt API (Gemini Nano): no Hungarian, 22 GB disk (`llm.md`) — no |

### Limits that shape the model choice

| limit | value | effect |
|---|---|---|
| wasm32 heap | 4 GB max, often ~2 GB usable | ort-web loads `.onnx_data` into JS memory before upload → peak RAM ≈ 2× weights. Single model files >2 GB are fragile; prefer ≤1 GB total |
| WebGPU buffers | default `maxBufferSize` 256 MB, `maxStorageBufferBindingSize` 128 MB; adapters usually allow 1-4 GB if requested | WebLLM/transformers.js request higher limits; probe them (see below) |
| VRAM | WebLLM table: Qwen3.5-0.8B q4f16 **1.6 GB**, 2B **2.2 GB**, Gemma 4 E2B **3.4 GB**, gemma3-1b **0.7 GB** (4k ctx) | integrated GPUs share system RAM. devbox's 1050 Ti (4 GB) = the low end we can test on |
| mobile | iOS Safari kills tabs ~1-1.5 GB (`llm.md`) | v2 off on phones; v1 OK |
| context | WebLLM prebuilt Qwen3.5: `context_window_size 4096` | current translate prompt is ~10-15k tokens with images (`ocr-bench.md`). Free prompts must be text-only, per panel or whole-strip transcript only |

### Caching

| store | fit | quota / eviction |
|---|---|---|
| Cache API | what we use now (`comic-models-v1`); transformers.js default; WebLLM default | whole response is buffered on `put` for some browsers → RAM spike on 400 MB files |
| OPFS | best for big files: streamed writes, `createSyncAccessHandle` in a worker | same quota as Cache API |
| IndexedDB | WebLLM option (`cacheBackend`) | same quota |

- Quota per origin: Chrome ~60% of disk, Firefox ~10% of disk best-effort (50% when persisted), Safari ~60% but **ITP wipes script-writable storage after 7 days of no use**. Call `navigator.storage.persist()` after the user opts in. Check `navigator.storage.estimate()` before the download.
- Pin HF revisions (`/resolve/<sha>/…`), check sha256 like the detector. Same cache key across releases → no re-download.
- Host: HF CDN directly. CORS is fine; no COEP means no `require-corp` problem. Go hub stays out of the byte path (`llm.md`: serve from HF/CDN, not server).

### COOP/COEP

- Dropped for Turnstile. Cost on the free path: WASM runs on **1 thread** (Paddle ~2× slower, opus-mt ~2-3× slower *est.*). WebGPU, WebLLM, transformers.js-webgpu, Chrome Translator: **unaffected**.
- So the heavy (LLM) stages lose nothing; only the CPU stages get slower. Not worth re-isolating for v1.
- If wanted later: `COEP: credentialless` + COOP on the work page, Turnstile moved to a popup/other route. Isolation is per document, so it is all-or-nothing for `/strip/*`.

## Candidates per stage

Sizes = sum of the files the runtime actually downloads for that dtype.

### OCR (+ kind, caps, line breaks)

| model | runtime | download | Hungarian | verdict |
|---|---|---|---|---|
| **PaddleOCR v5 latin mobile** det+rec | ort-web WASM (`ppu-paddle-ocr`) | **12.8 MB** | CER 0.165, accents 33-46% kept | **v1 OCR.** Benched |
| Tesseract.js `hun` | WASM | 2.9 MB | CER 0.45-0.57, accents 70% | no; maybe accent voter only |
| **Qwen3.5-0.8B** (`onnx-community/Qwen3.5-0.8B-ONNX`, q4f16: decoder 416 + embed 140 + vision 59) | transformers.js WebGPU | **616 MB** | 201 languages per card; `llm.md`: "ok-ish, may fix spelling". Not benched on our crops | **v2 accent/line repair**: input = crop + Paddle lines, output = corrected lines JSON. Bench first |
| Qwen3.5-2B ONNX q4f16 | transformers.js WebGPU | 1.5 GB | better *est.* | over budget |
| PaddleOCR-VL 1.5 (`onnx-community/PaddleOCR-VL-1.5-ONNX`, q4 dec+vision+embed) | custom ort-web graph, not transformers.js pipeline | 847 MB | multilingual doc OCR | too big, needs own glue |
| Gemma 4 E2B ONNX q4f16 (no audio) | transformers.js | 3.1 GB (embed_tokens alone 1.5 GB) | good *est.* | no |
| LFM2-VL-450M | transformers.js | 302 MB | card: **English only** | no |
| Florence-2 / TrOCR / SmolVLM | | 68-280 MB+ | benched bad / English | no |

- Paddle gives no `kind`. Derive: `text_free` + few short lines + large `glyphHeight` → `sfx`; `bubble`/`text_bubble` → `speech`; other `text_free` → `caption`. `replace` via existing `defaultReplace`. Paddle output is all caps: `caps: true`, MT gets sentence case (see below).

### Source language

| option | download | notes |
|---|---|---|
| Chrome `LanguageDetector` | 0 (Chrome) | desktop Chrome only. Short accentless caps text: unreliable *est.* |
| Qwen3.5-0.8B (v2) | shared with OCR | ask in the same OCR-repair call: `{"lang": "hu"}` |
| ~~user picks~~ **auto** (shipped) | 0 | Chrome `LanguageDetector`, else a stopword vote, else `franc-min`. No picker: 10/10 strips either way |

### Scene / speakers

- **Skip in v1 and v2.** A 0.8B model does not attribute speakers well, and the 4k context does not fit panel images + transcript. Store an empty `Scene` (`{summary:"",characters:[],panels:[],speakers:{},notes:[]}`) so `sharedFile()` and the renderer keep working.
- Any hub file in another language brings a real scene → used for free.

### Translate

| model | runtime | download | license | quality *est.* | fit |
|---|---|---|---|---|---|
| **Chrome `Translator`** | built-in | 0 (Chrome-managed pack) | Chrome ToS | Google-Translate-class sentence MT. No context, no jokes, no budget | **v1 default when `Translator.availability()` ≠ "unavailable"** |
| **opus-mt-hu-en / en-hu** (`Xenova/…`, int8 enc + merged dec) | transformers.js WASM | **105 MB per direction** | Apache-2.0 | Marian, okay on plain sentences, weak on slang | **v1 fallback** (Firefox/Safari). Only hu↔en in Xenova; other targets = pivot via en (2 × 105 MB, worse) or not offered |
| **Qwen3.5-0.8B** (same weights as OCR repair) | transformers.js WebGPU | 0 extra | Apache-2.0 | can take transcript + budget + `json` → `TRANSLATE_SCHEMA`-shaped. Small-model Hungarian: weak *est.* | **v2** |
| Qwen3.5-0.8B MLC q4f16 (text only) | WebLLM | 404 MB | Apache-2.0 | same model, faster decode, xgrammar JSON | only if WebLLM is chosen over transformers.js; no vision in WebLLM for Qwen3.5 (only Phi-3.5-vision is VLM there) → two downloads |
| Qwen3.5-2B MLC q4f16 | WebLLM | 1010 MB, 2.2 GB VRAM | Apache-2.0 | clearly better than 0.8B *est.* | opt-in "large" |
| Gemma 4 E2B MLC q4f16 | WebLLM | 2667 MB, 3.4 GB VRAM | Apache-2.0 | best multilingual small model here *est.* | opt-in "large" |
| gemma3-1b MLC | WebLLM | 536 MB, 0.7 GB VRAM | Gemma | weaker than Qwen3.5-0.8B on hu *est.* | no |
| NLLB-200-distilled-600M (`Xenova/…`, int8) | transformers.js | 853 MB | **CC-BY-NC-4.0** | good coverage | **no**: license + size |
| TranslateGemma 4B text ONNX q4f16 | transformers.js | 2.6 GB | Gemma | strong MT | too big |
| MADLAD-400 3B | — | no web build; >1.5 GB at int4 | Apache-2.0 | | no |

- MT input prep: join `source.lines` into one sentence, case-fold caps to sentence case (`Source.caps` keeps the render style), restore once: `ÉN`→`Én`. Hyphenated line breaks (`VOL-` / `TAM`) joined.
- Length budget: Chrome/opus-mt ignore it. Rendering already fits text into `fitBox`; overflow shows. Acceptable for "free, rough".

### Review

- Skip. Stage status `skipped`, message `free mode`. Translation stored `draft: false` (nothing to review against), `model: "local:…"`.

## Download budget

| tier | files | first-run download | per-strip time *est.* (mid desktop) |
|---|---|---|---|
| already shipped | detector 11.1 MB + ort wasm 3.7 MB gz | 0 new | detect ~10 s ×1 thread |
| **v1, Chrome** | Paddle 12.8 MB | **~13 MB** (+ Chrome's pack, once per language pair) | OCR ~19 s, translate ~1-3 s |
| **v1, other browsers, hu↔en** | Paddle 12.8 + opus-mt 105 | **~118 MB** | OCR ~19 s, translate ~20-40 s on 1 thread |
| **v2 (WebGPU)** | v1 + Qwen3.5-0.8B q4f16 616 MB (+ tokenizer 18 MB) | **~650 MB** | repair 45 crops ~30-90 s, translate ~20-60 s |
| large, opt-in | v1 + Gemma 4 E2B MLC 2.7 GB | ~2.7 GB | |

"A few hundred MB" holds for v1 everywhere and is ~650 MB for v2. Nothing below ~600 MB both sees images and handles Hungarian (LFM2-VL is English-only, SmolVLM English-centric), so v2 stays at 616 MB or gives up on vision.

## UX in the key modal

`KeyDialog.tsx` today: Connect with OpenRouter / paste key / how-to, then sharing. Add a second card, same weight as the key card, below it:

```
┌ Free, on this computer ─────────────────────────────┐
│ Rougher than the AI: accents may be missed, jokes   │
│ come out literal. You can fix any bubble by hand.   │
│                                                     │
│ ✓ Works in this browser · Chrome translator · 13 MB │
│ [ Translate for free ]                              │
│                                                     │
│ ▸ Better free version · needs a GPU · 650 MB        │
│   GPU: NVIDIA GTX 1050 Ti · 3.9 GB free on disk ok  │
│   [ Download (650 MB) ]                             │
└─────────────────────────────────────────────────────┘
```

### Capability probe (on dialog open, < 300 ms, no downloads)

| check | how | drives |
|---|---|---|
| Chrome translator | `"Translator" in self && await Translator.availability({sourceLanguage: src, targetLanguage: lang})` → `available` / `downloadable` / `unavailable` | v1 engine choice |
| opus-mt pair | static table `{hu:en, en:hu}` | v1 fallback; otherwise "free mode doesn't support <lang> in this browser, try Chrome" |
| WebGPU | `navigator.gpu?.requestAdapter()`; reject `isFallbackAdapter` / SwiftShader (detect worker does this already); `adapter.info` for name; `features.has("shader-f16")`; `limits.maxBufferSize ≥ 1 GB` | v2 shown / disabled with reason |
| memory | `navigator.deviceMemory` (Chrome, capped 8) ≥ 4; mobile UA → v2 hidden | v2 |
| disk | `navigator.storage.estimate()` free ≥ 2 × download | v2 |
| already cached | `caches.match` / OPFS file exists with right size | label "Downloaded ✓", button says "Use" |

### Flow

1. User picks free → `settings.engine = "local"` (+ `localTier: "quick" | "gpu"`). Remembered: next strips skip the modal, like a saved key.
2. v2: download button only after explicit click. Progress per file (bytes/total, MB/s, ETA) in the card, cancelable, resumable per file (HTTP Range on HF). On done: `navigator.storage.persist()`.
3. Dialog closes, `work.retry()`. Model loading shows in the stage line (`ocr · loading Paddle… 8/13 MB`), same as detect's `loading detector…`.
4. Failure fallback, in order: WebGPU device lost / OOM → drop to v1 for this strip, chip "ran the quick free version"; v1 pair unsupported → back to the modal with the reason; everything failed → "Edit by hand" (`editEmpty`) stays offered.
5. Settings menu: "Free mode: on · 650 MB cached · [Delete models]". Switching back to a key = the existing dialog.

Copy: no "AI-quality" claims. Lead line: "No account, nothing leaves your computer. Slower and rougher than with a key."

## Plugging into work.ts

Today the paid stages are hard-wired: `run()` gates on `settings.apiKey()`, then calls `runOCR` / `runScene` / `translatePass` / `reviewPass` from `pipeline.ts` with `llm(stage, signal)` options. `retranslate` checks the key too.

### Engine seam

```ts
type Engine = {
  id: string;                       // "openrouter:google/gemini-3.8-flash" | "local:paddle+chrome" | "local:qwen3.5-0.8b"
  ready(): boolean;                 // key present / models cached or downloadable
  ocr(img, rec, signal, onProgress): Promise<{ regions; srcLang; unboxed }>;
  scene?(img, rec, signal): Promise<Scene>;
  translate(img, rec, pass, signal, onProgress): Promise<Record<string, RegionTranslation>>;
  review?(img, rec, pass, draft, signal): Promise<Record<string, RegionTranslation>>;
};
```

- `pipeline.ts` functions become the OpenRouter engine unchanged (wrap with `llm(...)`).
- New `lib/free/` (not `lib/local.ts`, that is storage): `engine.ts` (the `Engine`), `ocr.worker.ts` (Paddle, ort-web WASM, reuses the detect worker's Cache API fetch + sha check), `mt.ts` (Chrome `Translator` on main thread; opus-mt in a worker), `vlm.worker.ts` (v2, transformers.js WebGPU, owns the model across strips; disposed on `pagehide` or after N min idle to free VRAM), `probe.ts` (capability checks above), `models.ts` (pinned URLs, sizes, sha256).
- `work.ts` changes:
  - `const engine = pickEngine()` from settings; `phase = "needKey"` only when `!engine.ready()`.
  - `scene`/`review` absent → `stage(s, { status: "skipped", message: "free mode" })`, empty `Scene` stored.
  - Stage progress: engines report `{done,total}` (crops, regions, download bytes) → existing `StageState.progress` bar.
  - `CallStat` per local call with `costUsd: 0`, `model: engine.id` → the research/debug view shows "local · free" like `browser.md`'s debug UI.
  - `Translation.model = engine.id`, `origin: "llm"` (or new `"local"`; renderer only cares about `regions`).
  - `retranslate`: use the engine; with hint and no LLM (v1) → just re-run MT on that region (hint ignored, button label says so).
- Hub:
  - Reading: unchanged. The `shared` stage runs before the engine gate, so free users get exact matches and reuse other-language OCR + scene.
  - Writing: *(superseded 2026-10-27: free translations are shared like paid ones when the box is on, tagged `model: free:…`; the ranking concern below is still open)* **do not auto-share local translations in v1.** An `exact` hub hit makes everyone skip their own pipeline (`work.ts` `exact` branch), so a rough local file would replace paid-quality runs. Option later: share with `model: "local:…"` and let `listings` rank non-local first and not treat local as `exact`. Contributing local **OCR** to another language is just as risky (it sets `r.ocr = true` for the next person).

## Risks

| risk | impact | mitigation |
|---|---|---|
| Accent loss (Paddle keeps 33-46%) feeds MT | Hungarian meaning flips (`HÁT`/`HAT`), MT garbage | v2 VLM repair; hub OCR when present; per-bubble edit. Bench MT on Paddle text vs Opus text before shipping v1 |
| 0.8B Hungarian quality unknown | v2 might not beat Chrome Translator | gate v2 on the bench below; ship v1 alone if it loses |
| Chrome-only v1 quality path | Firefox/Safari get opus-mt hu↔en only | say so in the card; offer pair list |
| VRAM / device lost mid-strip | tab crash, lost work | stages persist per step already (`mutate` → `saveStrip`); catch `GPUDevice.lost`, fall back to v1 |
| iOS/ITP storage eviction | silent 650 MB re-download | `persist()`, show cached state honestly, never auto-download |
| HF availability / renamed repos | broken free mode | pin revision SHAs; optional mirror on a CDN bucket later |
| Licenses | NLLB NC, Gemma terms, LFM license | v1/v2 picks are Apache-2.0 only (Paddle, opus-mt, Qwen3.5, Gemma 4) |
| transformers.js qwen3_5 / ort-web op gaps on WebGPU | v2 slow or broken on some GPUs | probe-run a 1-token generation after load; on failure fall back |
| Single-thread WASM | v1 Paddle ~19 s, opus-mt slow | acceptable; WebGPU EP for Paddle is an option (`ppu-paddle-ocr` has it) but `llm.md` showed little gain for int8 |
| Expectations | users judge the product by the free run | copy says rough; "Use a key for this strip" button on the result |

## Bench before building (extend `bench/`)

Same strip set as `cost-opt.md`, same metrics/judges:

1. MT only: Chrome `Translator` and opus-mt on (a) Opus OCR text, (b) Paddle text. Judged 1-10 like translate+review. Tells whether v1 is worth shipping and how much accents cost.
2. Qwen3.5-0.8B ONNX q4f16 WebGPU on devbox's 1050 Ti: OCR repair (Paddle draft + crop) → CER / accent acc; translate with transcript + budget → judged. Time + peak VRAM.
3. Same with Qwen3.5-2B MLC to see if the "large" tier is worth offering.

## Recommended minimal first version

1. `Engine` seam in `work.ts`, OpenRouter engine = today's code, no behavior change.
2. Free engine v1: Paddle v5 latin in a worker (WASM, 12.8 MB, pinned + sha256, Cache API `comic-models-v1`), `kind` from detector class, source language = user-picked (default `hu`), translate with Chrome `Translator` when available, else opus-mt for hu↔en, else "not supported here". Scene and review skipped. No hub contribution.
3. Key modal: "Free, on this computer" card with the probe line, one button, remembered choice, delete-models entry in settings.
4. Ship behind `?free=1` until bench step 1 says Paddle → MT is readable on Napirajz-type strips.
5. Then v2 (Qwen3.5-0.8B, 616 MB, WebGPU) only if bench step 2 beats v1.

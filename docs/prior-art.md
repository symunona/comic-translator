# Prior art — comic/manga bubble translate pipelines

Checked 2026-10-19. Repo metadata via `gh api` (license, stars, last push). Feature claims from READMEs / HF cards.
**No tool tested on real Napirajz pages.** Quality notes = inferred from training data + design. Run a bake-off before trusting.

## TL;DR

- **Build own pipeline. Reuse models, not apps.**
- No tool targets: Hungarian, hand-lettered ALL CAPS, free-floating text, pun-heavy, context translation with human checkpoint.
- All mature tools = manga-first (JP→EN/ZH). Western support = detector training data only.
- Every full app = Python or Rust desktop GUI. None = clean Go-callable library. Two have HTTP APIs (MIT `shared`, Saber REST); both GPL-3.0.
- Reuse: **ogkalu RT-DETR detector (Apache-2.0, ONNX)** + **LaMa ONNX (Apache-2.0)** via `onnxruntime_go` (MIT). OCR + translate = Claude vision. Study comic-translate + Koharu for typeset/fit logic.

## Full apps

| tool | link | license | maintained | stars | stages | LLM / Claude | Western / handwritten | Go reuse |
|---|---|---|---|---|---|---|---|---|
| manga-image-translator | github.com/zyddnys/manga-image-translator | GPL-3.0 | yes, push 2026-10-11 | 10.5k | detect, OCR, translate, inpaint, render | OpenAI, Gemini, DeepSeek, Groq, `custom_openai`, Ollama, Sakura, DeepL, NLLB, m2m100. **No native Claude** (OpenAI-compat proxy only) | detectors manga-tuned; `craft` generic. OCR models JP/EN/ZH 32/48px — not trained on HU diacritics (ÁÉÍÓÖŐÚÜŰ). Render `manga2eng` = EN only | **HTTP**: `shared` mode, port 5003, `/docs`. Python sidecar + GPL. Viable as black-box service, not lib |
| BallonsTranslator | github.com/dmMaze/BallonsTranslator | GPL-3.0 | yes, push 2026-10-18 | 5.2k | detect, OCR, translate, inpaint (AOT, LaMa ft, PatchMatch), WYSIWYG typeset | OpenAI-compat LLM w/ context, glossary, vision. No native Claude | detection "JP + EN only"; README claims 美漫 (US comics) support. OCR JP/EN/ZH | headless CLI (`--headless --exec_dirs`), no HTTP. Qt GUI. Poor fit for service |
| comic-translate | github.com/ogkalu2/comic-translate | **Apache-2.0** | yes, push 2026-09-11 | 3.0k | bubble+text detect, OCR, translate, inpaint, render | GPT-4.1, Gemini 2.5, **Claude 4.5 native**. Gemini/Azure OCR option | **detector trained on Western comics** (same author as ogkalu detector). OCR non-JP/KO = PPOCRv5 — weak on hand lettering | GUI only (`uv run comic.py`), no API. Best code to read: Apache, closest to our goal |
| Koharu | github.com/koharu-rs/koharu (was mayocream/koharu) | **Apache-2.0** (MIT/Apache dual per README) | very active, push 2026-10-19 | 6.4k | detect+seg (RF-DETR Seg 2XL), OCR (PaddleOCR-VL 1.6, Manga OCR…), translate, inpaint (LaMa, AOT, RORem, FLUX.2 Klein), shaping/auto-fit typeset, PSD export, proofreading | local GGUF + **Claude**, OpenAI, Gemini, Grok, DeepSeek, OpenRouter, OpenAI-compat | manga-first; CJK vertical + RTL. Western not mentioned. PaddleOCR-VL = general multilingual, might handle HU | Rust workspace, 23 crates (`koharu-renderer`, `koharu-rasterizer`, `koharu-pipeline`, `koharu-ml`…). Tauri desktop. "Agent" = in-app Codex client, not MCP/HTTP. No documented external API. Could port renderer ideas; FFI from Go = heavy |
| Saber-Translator | github.com/MashiroSaber03/Saber-Translator | GPL-3.0 | yes, push 2026-10-13 | 3.7k | detect (DBNet, CTD, YOLO variants, manual), OCR (MangaOCR, 48px, PP-OCR, PaddleOCR-VL, **AI vision OCR**), translate, inpaint (LaMa, MI-GAN), render | SiliconFlow, DeepSeek, Gemini, Volcano, Ollama, Sakura; `openai` pkg. No native Claude. "High quality" multimodal mode | JP→ZH focus. Western not mentioned | **REST + SSE**, `openapi/v2.yaml`. Python web app, GPL. Service-callable but wrong language pair focus |
| ImageTrans | alternativeto.net/software/imagetrans | proprietary, one-time license (BasicCAT / xulihang) | unknown — did not check | — | CAT-tool style: detect, OCR, MT, inpaint, typeset | unknown | unknown | closed. Skip |
| Cotrans | github.com/VoileLabs/cotrans | GPL-3.0 | **dead**, push 2024-02-19; demo "no longer working" per MIT README | 279 | hosted MIT frontend/userscript | — | — | skip |

## Components / models

| piece | link | license | maintained | what | fit for Napirajz | Go reuse |
|---|---|---|---|---|---|---|
| ogkalu comic-text-and-bubble-detector | huggingface.co/ogkalu/comic-text-and-bubble-detector | **Apache-2.0** | updated 2025-09-08 | RT-DETR-v2 r50vd, 42.9M params. Classes: `bubble`, `text_bubble`, `text_free`. ~11k imgs manga/webtoon/manhua/**Western**. 640px input | **best candidate**. `text_free` class = Napirajz floating text. Boxes only, no masks | **ONNX** available → `onnxruntime_go` |
| ogkalu YOLOv8m speech bubble | huggingface.co/ogkalu | check card | 2024-01-31 | bubbles only, ~8k imgs incl Western | fallback | ONNX export trivial |
| kitsumed yolov8m_seg-speech-bubble | huggingface.co/kitsumed/yolov8m_seg-speech-bubble | check card | — | bubble **masks**; edges wavy | bubble interior mask for inpaint + shape-aware fit | ONNX |
| Koharu Layout RF-DETR Seg 2XL | huggingface.co/mayocream/koharu-layout-rfdetr-seg-2xl-1152 | check card | active | text + bubble + cleanup **segmentation**, 1152px | strong if masks needed; manga-trained | ONNX? did not check |
| comic-text-detector (CTD) | github.com/dmMaze/comic-text-detector | GPL-3.0 | **stale**, push 2023-08-13 | YOLOv5 blocks + text lines + **pixel text mask**. 13k imgs: Manga109-s, DCM (Digital Comic Museum = Western golden age), synthetic | text pixel mask useful for tight inpaint. GPL weights | ONNX exists in MIT/BT ecosystems; license taints |
| Magi v1/v2/v3 | github.com/ragavsachdeva/magi | **academic research only** | push 2025-06-27 | panels, text, characters, reading order, **speaker attribution**, OCR | idea source for speaker step. Manga-only. License blocks product use | no |
| LaMa (big-lama) | github.com/advimman/lama | Apache-2.0 | stale (2025-02) but done | large-mask inpaint | fine for flat-color strip backgrounds | — |
| LaMa ONNX | huggingface.co/Carve/LaMa-ONNX, huggingface.co/sapienkit/LaMa-ONNX | Apache-2.0 (sapienkit card) | — | fp32 512×512, opset 17. In: img `[1,3,512,512]` /255 + mask `[1,1,512,512]`. Out 0–255 | crop-around-mask then paste back | **ONNX → Go direct** |
| lama-manga (Koharu) / MIT `lama_large` | huggingface.co/mayocream/lama-manga | check card | — | LaMa fine-tuned on manga | maybe better on line art; test vs big-lama | ONNX? did not check |
| IOPaint (ex lama-cleaner) | github.com/Sanster/IOPaint | Apache-2.0 | **archived** 2025-04 | inpaint server, many models | skip; take ONNX directly | HTTP, but archived |
| onnxruntime_go | github.com/yalue/onnxruntime_go | MIT | yes, push 2026-09-04 | Go bindings, CGo + ORT shared lib | runtime for detector + LaMa | **yes** |

## Napirajz-specific gaps (nobody solves)

- **Hungarian OCR**: all bundled OCR = JP/ZH/EN/KO tuned. Hand-lettered caps + double acute (Ő Ű) → expect errors. Claude vision OCR = our call; PaddleOCR-VL (Koharu/Saber) = only general multilingual alternative worth a test.
- **Free-floating text**: only ogkalu `text_free` class models it explicitly. Others assume bubbles.
- **Speaker attribution**: only Magi (non-commercial, manga). Our numbered-box overlay → Claude = novel, keep.
- **Context translation + self-critique + char budget**: tools translate per page with glossary/context at most. None do critique loop or per-bubble length budget. Keep ours.
- **Human checkpoint between OCR and translate**: BallonsTranslator, Koharu (proofreading), comic-translate allow manual edit — but in desktop GUI, not as pipeline stage. Ours = web.
- **Lettering style**: render engines ship manga/anime fonts. Need hand-lettered caps font with full HU glyphs. Font choice = ours.

## Verdict

- **Build** pipeline + Go backend + SolidJS UI. Do not fork.
  - Fork MIT/BT/Saber → GPL-3.0, Python, manga assumptions baked in, GUI-centric.
  - Fork Koharu → Apache, best tech, but Rust/Tauri desktop, no external API; we'd be rewriting its frontend + agent anyway.
  - comic-translate → Apache, Claude native, Western detector — but Python Qt GUI, no API, single-pass translate (same failure we already hit).
- **Reuse components:**

| our stage | reuse | how |
|---|---|---|
| panel split | none good; classic CV (gutters/contours) or Claude | own |
| text region detect | **ogkalu comic-text-and-bubble-detector** ONNX | `onnxruntime_go` in Go |
| masks | kitsumed bubble-seg or Koharu RF-DETR seg; or derive text mask: dark-pixel threshold inside detected box | test both; threshold likely enough for black hand lettering on flat bg |
| reading order | rule-based (panel order → y/x within panel) + Claude fix-up | own |
| OCR | **Claude vision** per crop + full-page context | own prompt |
| speaker attribution | numbered-box overlay → Claude | own (Magi = idea only) |
| translate + critique + budget | Claude | own |
| inpaint | mask fill (flat bg) → **LaMa ONNX** fallback | `onnxruntime_go`, 512 crop |
| text fit / render | read comic-translate (Apache) + Koharu `koharu-renderer` (Apache) for fit algorithms | reimplement in TS (shared preview/export) or Go |

- Optional black-box baseline: run manga-image-translator `shared` HTTP (port 5003) on 10 strips w/ OpenAI-compat → Claude proxy. Calibration only. Not a dependency.

## Bake-off before committing (not done)

- 10–20 Napirajz strips, mix: bubbles, floating text, SFX, captions.
- Detect recall: ogkalu RT-DETR vs Koharu RF-DETR vs CTD. Metric: missed `text_free` regions.
- OCR CER: Claude vision vs PaddleOCR-VL 1.6. Focus Ő/Ű/accents.
- Inpaint: threshold+fill vs big-lama vs lama-manga.
- End-to-end baseline: comic-translate w/ Claude, to see how far off-the-shelf gets.

## Sources

- github.com/zyddnys/manga-image-translator
- github.com/dmMaze/BallonsTranslator
- github.com/dmMaze/comic-text-detector
- github.com/ogkalu2/comic-translate
- github.com/koharu-rs/koharu, koharu.rs/agent/projects, koharu.rs/agent/setup.md
- github.com/MashiroSaber03/Saber-Translator
- github.com/VoileLabs/cotrans
- github.com/ragavsachdeva/magi
- github.com/advimman/lama, github.com/Sanster/IOPaint
- github.com/yalue/onnxruntime_go
- huggingface.co/ogkalu/comic-text-and-bubble-detector, huggingface.co/ogkalu
- huggingface.co/kitsumed/yolov8m_seg-speech-bubble
- huggingface.co/Carve/LaMa-ONNX, huggingface.co/sapienkit/LaMa-ONNX
- alternativeto.net/software/imagetrans

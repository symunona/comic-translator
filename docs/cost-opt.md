# Cost optimization: model per step (2026-10-20)

Goal: cheapest per-step model combo with Sonnet-or-better quality. No Opus in prod.
OpenRouter key (experiment budget $4, spent $2.29). Claude via `claude-cli` (subscription, list-price equivalent).

## Test set

| strip | id | src -> dst | why |
|---|---|---|---|
| kristalyhologram | 2afc78b4 | hu -> en | OCR only (45 boxes) |
| zsenialis_rendszer | 6cbd56cd | hu -> en | Napirajz, profanity |
| hatos_csavar | 3b343686 | hu -> en | Napirajz, pun ("NEM EGY, ÖT!") |
| ket_nagy_szatyor | 0c0bd5d5 | hu -> en | Napirajz, signs, numbers |
| Pepper&Carrot E06 P01, P02 | 89371298, 35ce81ab | en -> hu | CC-BY, colour, typed lettering, **official hu = human reference** |
| vim.jpg, my computer.jpg (vault) | 8f3737ae, 246d3aa3 | en -> hu | meme captions |
| az_izzo_liget, vodorre | 7f454423, e3d568ca | hu -> en | end-to-end only, unseen |

Strips stay in `.tmp/strips` + `data/` (gitignored). P&C pages: peppercarrot.com, CC-BY 4.0, David Revoy.

## Batching (Q: single call?)

| step | calls per strip | batched? |
|---|---|---|
| ocr (old) | 1 per panel (5-10) | no |
| ocr (new default) | **1 per strip** (all panels + all crops) | yes. `-ocr-per-panel` keeps old |
| scene | 1 | yes |
| translate | 1 (all bubbles) | yes |
| review | 1 (all bubbles) | yes |
| editor retranslate | 2 per region click | per region, full context resent |

- OCR whole strip vs per panel: Opus 0.002 vs 0.004 CER, gemini-3.8-flash 0.009 vs 0.013, haiku 0.010 vs 0.018. Cheaper (images + rules sent once) and as good or better.
- Exceptions: Sonnet whole strip 0.016 vs 0.008 (1 box missed), gemini-3.1-flash-lite 0.070 vs 0.010 (4 boxes missed). Weak or lazy models skip boxes in long lists.
- Translate is already one call: needs cross-bubble context (jokes span bubbles, running tics). Splitting would resend images + scene N times.

## OCR (104 boxes with text, 8 strips, GT = Opus audited by eye on 32 disputed crops)

Full table: `bench/results/ocr-v2-2026-10-20.json`. `python3 -I bench/llm/score_ocr.py`.

| model | where | method | CER | accents | $/strip |
|---|---|---|---|---|---|
| Opus | claude-cli | whole strip | 0.002 | 98% | 0.146 |
| Sonnet | claude-cli | per panel (**prod now**) | 0.008 | 97% | 0.096 |
| gemini-3.1-flash-lite | OpenRouter | **Paddle draft + crops, 1 call** | 0.009 | 98% | **0.007** |
| gemini-3.8-flash (effort low) | OpenRouter | **whole strip** | 0.009 | 99% | 0.022 |
| Haiku | claude-cli | whole strip | 0.010 | 98% | 0.006 |
| glm-5.3-flash | OpenRouter | whole strip | 0.019 | 94% | 0.010, slow (140 s) |
| qwen3.8-flash | OpenRouter | whole strip | 0.052 | 95% | 0.006, slow, 429s |
| PaddleOCR v5 latin | browser WASM×4 / devbox native | per crop | 0.165 / 0.170 | 33% | 0 |
| PaddleOCR v6 small/medium | browser / native | per crop | 0.30-0.31 | 7-16% | 0 |
| Tesseract.js hun | browser | per crop | 0.447 | 70% | 0 |
| gemma4 12B | ollama devbox | per panel, json | 0.27 (2 strips) | 58% | 0, ~10 min/strip CPU |

- Paddle alone: not usable (accents lost). Paddle + one cheap LLM call with crops: Sonnet quality at 1/14 the price. Draft helps weak models (lite 0.070 -> 0.009), not strong ones (gemini-3.8-flash 0.009 -> 0.010).
- Draft without crops (panel images only): cheaper, worse (0.013-0.064). Close-ups matter for accents.
- Browser WASM vs devbox native Paddle: same text (CER 0.165 vs 0.170: different crop decode). Native ~45 ms/crop idle, WASM×4 ~100 ms.
- PP-OCRv6: worse than v5 latin on hand lettering.

## Scene / translate+review (judged)

Blind, two judges from different families (Opus via claude-cli, gemini-3.8-flash via OpenRouter), 1-10 overall, panel images given, P&C official hu page given as reference. Each judge rates its own family a bit higher: read both.

| step | backend | $/strip | opus judge | gemini judge |
|---|---|---|---|---|
| scene | Opus | 0.150 | 10.0 | 10.0 |
| scene | **gemini-3.8-flash** | **0.017** | 8.0 | 9.9 |
| scene | Sonnet | 0.037 | 4.7 | 7.2 |
| scene | deepseek-v4.1-flash | 0.025 | 4.7 | 6.2 |
| scene | gpt-5.6-luna / Haiku | 0.005 / 0.009 | 2.3 / 1.7 | 3.0 / 3.7 |
| translate+review | **gemini-3.8-flash** | **0.055** | 7.9 | 7.9 |
| translate+review | Opus | 0.239 | 8.3 | 7.0 |
| translate+review | deepseek-v4.1-flash | 0.016 | 7.6 | 6.4 |
| translate+review | gpt-5.6-luna | 0.008 | 7.0 | 6.4 |
| translate+review | Sonnet | 0.092 | 6.9 | 6.4 |
| translate+review | qwen3.7-plus | 0.009 | 6.2 | 5.6 (5 of 7 strips) |
| translate+review | Haiku | 0.009 | 5.9 | 5.0 |

- Scene is where cheap models break: wrong speaker attribution. Sonnet weak here too. gemini-3.8-flash near Opus.
- Review pass (mean of both judges, draft -> reviewed): gemini +0.7, Sonnet +0.8, deepseek +0.7, Opus +0.2, luna -0.3, Haiku -0.3. Worth it for strong models only.
- qwen3.7-plus (Alibaba provider) aborts on profane strips: `finish_reason: error`, empty reply. 2 of 3 Napirajz strips. Unusable for this content.
- deepseek-v4.1-flash: slow (2-3 min per call), review JSON broke once.

## End to end (2 unseen strips, all steps one backend)

| strip | gemini-3.8-flash pipeline | Sonnet pipeline (claude-cli) |
|---|---|---|
| az_izzo_liget | **$0.078**, judged 9 / 8 | $0.363, judged 6 / 7 |
| vodorre | **$0.053**, judged 4 / 4 | $0.198, judged 7 / 7 |

- vodorre loss: gemini left the parody names (SZAKADT PATENT, ELVONT SÖRÉNY) untranslated, killing the joke. Fixable in prompt (say: localize invented names).
- n=2. Not proof. Direction matches per-step results.

## Recommendation

| step | pick | budget alt | premium |
|---|---|---|---|
| detect | browser (done, prod) | | |
| ocr | browser Paddle v5 draft + gemini-3.1-flash-lite, 1 call (~$0.007) | Haiku whole strip | gemini-3.8-flash whole strip ($0.022) |
| scene | gemini-3.8-flash (~$0.017) | | Opus ($0.15) |
| translate + review | gemini-3.8-flash (~$0.055) | gpt-5.6-luna ($0.008) / deepseek-v4.1-flash ($0.016) | Opus ($0.24) |
| **strip total** | **~$0.08** | ~$0.03 | ~$0.40 |

- vs Sonnet now ~$0.23 (claude-cli list) and Opus ~$1.45.
- Gemini Flash price risk: docs/llm.md notes Gemini 3.8 Flash price doubles 2027-01-01 (direct API). Re-check OpenRouter price then.
- Prod not switched: needs an API key on server. Config: `LLM=openrouter:google/gemini-3.8-flash LLM_OCR=openrouter:google/gemini-3.8-flash?effort=low`, drop `-ocr-per-panel`. Paddle-draft OCR needs browser Paddle wiring (not built).

## Rerun

```sh
cd backend
./bin/ocrprompts -data ../data -out ../bench/llm/prompts -drafts paddle=../bench/llm/drafts-paddle5.json <ids...>
./bin/llmbench -out ../bench/llm/answers -max-usd 0.5 -spec openrouter:<model> ../bench/llm/prompts/*/llm/ocr-*.json
python3 -I ../bench/llm/gt_build.py <ids...>; python3 -I ../bench/llm/score_ocr.py
bench/translate-versions.sh <api> <id> <lang> <spec...>          # translate+review versions
python3 -I bench/llm/judge.py build <ids> --lang en [--ref page.jpg]; llmbench -spec claude-cli:opus bench/llm/judge/*/llm/*.json
python3 -I bench/llm/judge.py collect; python3 -I bench/llm/costs.py
```

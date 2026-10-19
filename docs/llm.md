# LLM: cost, abstraction, local models, measurement

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
| Sonnet for ocr (spec: reads images fine, ~7s) | ocr −50%, faster | per-stage model, needs routing (Q2) |
| trim scene output (shorter descriptions, notes cap) | scene −30-50% | `prompts/scene.tmpl` |
| lower thinking / effort for ocr, review | 20-40% of output | API only (CLI: did not check flag) |
| direct API (no turns, images inline) | ~30% vs lean | new adapter (Q2) |
| prompt caching: panel images + scene as shared prefix of translate → review → extra langs | input side only, small | API adapter |
| Batch API | −50% | API only, async; fine for non-interactive runs |

## Q2: LLM abstraction

Status: **yes, thin.** `backend/internal/llm/llm.go`:

```go
type LLM interface {
	Call(ctx context.Context, prompt string, images []string, schemaHint string) (json.RawMessage, error)
}
```

| aspect | state |
|---|---|
| provider-neutral signature (text + image paths + schema hint -> JSON) | yes |
| pipeline knows nothing about CLI | yes, only `LLM.Call` |
| "Read these images with the Read tool" wording | inside `claudecli.go` `buildPrompt`, not in templates. Good |
| JSON extraction + 1 retry | `ExtractJSON` in `llm` pkg, reusable by other impls |
| call logging + usage | via ctx (`WithLog`), written by impl. Other impls must call `writeLog` with `Usage` filled |
| model choice | one global model (`-model`). No per-stage routing |
| usage returned to caller | no, side-channel log only. Fine for accounting |
| impls | only `ClaudeCLI` |

To add:

| what | how |
|---|---|
| `anthropic-sdk-go` adapter | same interface. Images base64 inline, one turn, `output_config` structured JSON from schema, `usage` -> `logEntry.Usage`, cost from price table. Needs API key: right fit for server (no CLI login there) |
| per-stage routing | `map[stage]LLM` or `Router` impl of `LLM` reading stage from ctx (`WithLog` already carries stage name). E.g. ocr=sonnet, rest=opus |
| ollama / OpenAI-compatible adapter | same interface, `images` -> base64 `images` field. For local OCR experiments (Q3) |
| prompt caching | API adapter: put panel images + scene first, `cache_control` on that block; translate/review/extra langs reuse |

## Q3: which steps need / could use local models

| step | model now | local? | notes |
|---|---|---|---|
| ingest, panels, order, clean (erase), fit | none, classic CV | n/a | no model |
| detect | ONNX RT-DETR-v2, local CPU | **required local, already** | ~0.7s/panel CPU. GPU (1050 Ti) optional, small win |
| inpaint (LaMa, future: non-white bg, free text) | none yet | **could, should be local** | LaMa ONNX ~200MB, CPU ok for bubble-sized crops |
| ocr | Claude opus | **could** | probe below. Text mostly right, misses 1 letter / line breaks. Kind classification + unboxed text not tested |
| scene | Claude opus | shouldn't | needs world + cultural knowledge, humor, 10-panel reasoning |
| translate | Claude opus | shouldn't | jokes, wordplay, register. Local = draft quality only |
| review | Claude opus | shouldn't | critique of jokes/fit; weakest local fit |

Local OCR probe (devbox, ollama, 1 crop each, temp 0, no thinking, time incl. model load):

| model | r12 truth: `NEM BAJ, AZ EMBER / AZÉRT FIATAL, HOGY / TANULJON.` | r9 `NA. PATTANJ FEL!` | time |
|---|---|---|---|
| gemma4:12b-it-qat (7.2GB, partial GPU offload) | `TANULKON.` (1 letter wrong), line breaks kept | exact | 15-17s |
| qwen3.5:4b-q4_K_M (3.4GB) | text exact, line breaks lost | exact | 13-14s |

Other candidates, not tested: PaddleOCR-VL (0.9B, fits 4GB VRAM, strong OCR, Hungarian accents unknown), gemma4 26b-a4b (18GB, CPU offload, slow), gemma4 E2B. manga-ocr: Japanese only, no.

Plausible local OCR split: local model does per-crop text, Claude/Sonnet does nothing for ocr or only kind + verification. Saves ~$0.10-0.50/strip. Low priority: ocr is cheap after lean.

Hosts:

| host | hw | local models |
|---|---|---|
| devbox | GTX 1050 Ti 4GB, 12 cores, 30GB RAM | detector, LaMa, ≤4B vision LLM on GPU, 12B with offload |
| server (deploy) | 2 cores, ~3.8GB RAM, no GPU | detector only (slower than 0.7s/panel), maybe LaMa. **No local LLMs**: no RAM, no GPU. LLM stages must call an API |

- server + `claude` CLI needs a logged-in subscription session on the server. API-key adapter is cleaner there.

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

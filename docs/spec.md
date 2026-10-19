# comic-translator spec (v1)

Goal: upload comic strip -> detect -> OCR -> context -> translate -> erase text -> editor -> final PNG.
Demo target: Napirajz `kristalyhologram.png` (620x5738, vertical, B/W hand lettering, white bubbles, Hungarian).
Test file: `~/dropx/org/90-99 misc logs, admin, docs, and dumps/93 resources/memestream, comics, napirajz/napirajz-archivum/kristalyhologram.png`

## Layout

| path | what |
|---|---|
| `backend/` | Go 1.27 module `comic-translator/backend`. `cmd/server`, `internal/{store,pipeline,detect,imgproc,llm,api}` |
| `frontend/` | SolidJS + Vite + TS. pnpm |
| `data/` | per-hash store (gitignored) |
| `docs/` | spec, prior-art |
| `dev.sh` | starts both in tmux session `comic-translator` |

## Ports / env

- API `127.0.0.1:4720`. Vite `127.0.0.1:4721`, `--strictPort`, proxies `/api` -> 4720.
- `TMPDIR`, `GOCACHE`, `GOMODCACHE`, pnpm store: under `/data/cache` or `/data/dev/comic-translator/.tmp`. Never `/tmp` or `~`.
- Detector ONNX: `/data/cache/models/comic-detector/detector.onnx` (already downloaded).
- ONNX Runtime shared lib: `/data/cache/onnxruntime/` (backend agent installs; version must match `github.com/yalue/onnxruntime_go`). Env `ORT_LIB`.
- LLM: swappable backend, env `LLM` (default `claude-cli`). See LLM section.

## Coordinates

All boxes = original image pixels, `[x, y, w, h]` ints.

## Store (filesystem adapter, interface so sqlite later)

```
data/<sha256-hex>/
  meta.json            {id, origName, createdAt RFC3339, width, height, mime}
  orig.<ext>           original bytes, untouched
  orig.png             normalized RGB png
  clean.png            text erased
  overlays/<rid>.png   opaque crop of clean.png at region overlayBox
  debug/<panelId>.png  panel crop with numbered boxes (also LLM input)
  stages/<stage>@v<N>.json
  tr/<lang>@v<N>.json  pipeline translation (review stage cache)
  tr/<lang>.versions.json  saved translation versions, see Translation versions
  tr/<lang>.edit.json  legacy user edit (read once for migration, never written)
  out/<lang>.png       final export
```

- ID = sha256 of uploaded bytes. Upload same bytes -> same ID -> everything cached; only missing `tr/<lang>` runs.
- Stage cache key = stage name + version const. Bump const -> rerun.
- Recent list: read `meta.json` createdAt, newest 10. Not folder times.

## Pipeline stages (order)

| # | stage | how | output (stages/*.json) |
|---|---|---|---|
| 1 | `ingest` | hash, store, decode (png/jpg/webp), meta | meta.json |
| 2 | `panels` | XY-cut on ink projection. Ink = luma < 128. Row/col blank if ink px <= 3 (dust specks). Gap >= 12px splits. Panel min size 60px. Recursive rows then cols. Trim to ink bbox + 4px pad | `[{id:"p0", order, bbox}]` |
| 3 | `detect` | ONNX per panel crop (better res than whole strip). See Detector. conf >= 0.35. Class-wise NMS IoU 0.5. Pair `text_bubble` with smallest `bubble` containing its center -> `bubbleBox`. `text_free` -> kind `free`. Bubble with no text box -> region with textBox = bubble box shrunk 12%. Drop text boxes > 90% inside another same-class box | regions (no text yet) |
| 4 | `order` | per panel: sort by top y, cluster rows (y overlap > 50%), left->right within row. Global id `r0..rN` in reading order | regions ordered |
| 5 | `ocr` | per panel, parallel 4: LLM gets `debug/<panel>.png` (crop with red numbered boxes, number = region index) + per-region crops. Returns per region text, lines, align, kind. Keep spelling EXACTLY incl. dialect/typos ("ELJÖTTÉ" stays). Keep line breaks. `kind`: speech/thought/caption/sfx/sign/none | regions + `source` |
| 6 | `scene` | one LLM call: all panel debug images in order + full transcript. Returns characters, speaker per region, panel descriptions, summary, jokes/wordplay/cultural notes, which signs are meaningful | scene |
| 7 | `clean` | erase text for regions with `replace=true`. See Erase. Writes clean.png + overlays | regions + overlayBox, overlayUrl |
| 8 | `translate:<lang>` | LLM: all panel debug images + transcript with speakers + scene + per-region budget. Returns literal + adapted + notes per region | tr draft |
| 9 | `review:<lang>` | LLM critique pass on draft: joke lands? register? over budget? -> rewritten final | tr/<lang>@vN.json |

Default `replace`: kind speech/thought/caption -> true. sfx/sign/none -> false (editor can toggle; v1 does not erase free text, LaMa later).
Budget: `maxChars = ceil(len(source) * 1.2)`, `maxLines = max(len(lines), 1) + 1`.

### Detector (ogkalu/comic-text-and-bubble-detector, RT-DETR-v2)

- Inputs: `images` float32 `[1,3,640,640]` RGB, plain resize (no letterbox), /255, NO mean/std. `orig_target_sizes` int64 `[[W,H]]` of the crop.
- Outputs: `labels` int64 `[1,300]`, `boxes` float32 `[1,300,4]` xyxy in crop pixels, `scores` float32 `[1,300]`.
- Classes: 0 bubble, 1 text_bubble, 2 text_free. ~0.7s per 640 on CPU.
- Verified in python. Known misses: tiny bubbles (`HÍREK`, `E!`). Truck signs come back as text_free -> OCR marks `sign`.

### Erase (classic CV, white bubbles + dark ink)

For region with bubbleBox (or textBox when none):
1. Work area A = textBox padded 6px, clipped to bubbleBox.
2. Binarize: ink = luma < 160.
3. Connected components (8-conn) of ink inside A.
4. Drop component if it touches A's border (bubble outline, tail, art) OR its height > 3x median component height (inner bubble outline in nested bubbles).
5. Dilate kept pixels 2px; fill with bubble paper color = median luma of non-ink px in A (white for Napirajz).
- overlayBox = A. overlay png = clean.png crop at A.
- fitBox (after all regions are erased): paper px (luma >= 160) 4-connected to the erased px, limited to bubbleBox (A when none), eroded 4px, piece overlapping textBox most, largest inscribed axis-aligned rectangle.
- glyphHeight = median height of erased letter components (accents/punctuation under half the 75th percentile skipped).

### LLM adapter

Interface `LLM.Call(ctx, prompt string, images []string /*abs paths*/, schemaHint string) (json.RawMessage, error)`. Details, providers, prices: `docs/llm.md`.

- Backend from env: `LLM=<provider>:<model>[?effort=..&json=1]`, per stage `LLM_OCR|SCENE|TRANSLATE|REVIEW`. Unset -> `claude-cli:<-model>`.
- Providers: `anthropic` (official Go SDK), OpenAI-compatible presets (`openrouter`, `qwen`, `zai`, `moonshot`, `deepseek`, `minimax`, `stepfun`, `gemini`, `openai`, `mistral`, `siliconflow`, `ollama`), `claude-cli` (dev, subscription, lean flags).
- Images: inline base64 (API backends); Read tool paths (`claude-cli`).
- Extract first `{...}` block, `json.Unmarshal`. Retry once on parse fail with "return ONLY valid JSON".
- Log prompt + result + `usage` tokens + `costUsd` + backend/model to `data/<id>/llm/<stage>-<n>.json`. Editor retranslate logs as `retranslate-<lang>`.
- Usage: `llm.ReadUsage` aggregates per stage. `go run ./cmd/llmusage [id-prefix]` prints table. `go run ./cmd/llmprobe -spec ... <log.json>` replays a logged call on another backend.
- Concurrency cap 4 global (shared by all backends).

## API (Go, net/http, JSON)

| method | path | body / resp |
|---|---|---|
| GET | `/api/strips?limit=10` | `[StripSummary]` newest first: `{id, origName, createdAt, width, height, thumbUrl, langs:[...] }` |
| POST | `/api/strips` | multipart `file`. resp `{id, existing:bool}`. Does ingest only |
| GET | `/api/strips/{id}` | `Strip` (full current state, whatever stages done) |
| GET | `/api/strips/{id}/usage` | `{stages:[StageUsage], total}` LLM tokens + cost per stage, from `llm/` logs |
| GET | `/api/strips/{id}/events?lang=en` | SSE. Starts/joins pipeline job for (id, lang). Replays done stages first (status `cached`), then live |
| GET | `/api/strips/{id}/image/orig.png`, `/clean.png`, `/overlays/{rid}.png`, `/debug/{pid}.png`, `/out/{lang}.png` | files |
| GET | `/api/strips/{id}/translations/{lang}` | `Translation` of the active version |
| PUT | `/api/strips/{id}/translations/{lang}` | `Translation` -> active version if `user`, else forks a new `user` version (`Edit of <label>`), makes it active |
| GET | `/api/strips/{id}/translations/{lang}/versions` | `TrVersions` |
| POST | `/api/strips/{id}/translations/{lang}/versions` | `{spec?, label?, from?, regions?}`. `spec` -> run translate+review on that backend (sync, minutes), needs `LLM_ALLOW_SPECS`. No spec -> copy `from` (default active) as `user` version. New version becomes active. 201 `TrVersion` |
| PATCH | `/api/strips/{id}/translations/{lang}/versions/{vid}` | `{label?, regions?}` in place -> `TrVersion` |
| POST | `/api/strips/{id}/translations/{lang}/versions/{vid}/activate` | -> `TrVersions` |
| DELETE | `/api/strips/{id}/translations/{lang}/versions/{vid}` | -> `TrVersions`. Last version: 409 |
| POST | `/api/strips/{id}/retranslate/{lang}` | body `{regionIds?:[...], hint?:string}` -> reruns translate+review for those regions, merges into active version (usage added), returns Translation |
| POST | `/api/strips/{id}/render/{lang}` | body `image/png` -> `out/<lang>.png`, resp `{url}` |
| PATCH | `/api/strips/{id}/regions/{rid}` | `{replace?:bool, source?:{text,lines}}` -> updates stage json, re-cleans if replace changed. resp Region |

Job manager: one job per (id, lang) at a time; multiple SSE subscribers fan-out; job survives client disconnect.

### SSE events

`event: stage` data `{stage, status: "running"|"done"|"cached"|"error", message?, progress?:{done,total}}`
`event: data` data `{kind, payload}`:

| kind | payload | when |
|---|---|---|
| `meta` | `{id, origName, width, height, imageUrl}` | ingest |
| `panels` | `[Panel]` | panels |
| `regions` | `[Region]` (boxes only) | detect/order |
| `region` | `Region` (with source) | each ocr result, streamed per panel |
| `scene` | `Scene` | scene |
| `overlays` | `[Region]` with overlayBox/overlayUrl | clean |
| `translation` | `Translation` | translate (draft) and review (final, `final:true`) |

`event: done` data `{}`. `event: fatal` data `{message}`.

### Types (JSON)

```ts
type Box = [number, number, number, number] // x,y,w,h
type Panel = { id: string; order: number; bbox: Box }
type Region = {
  id: string; panelId: string; order: number
  detClass: "bubble" | "text_bubble" | "text_free"; score: number
  textBox: Box; bubbleBox?: Box
  kind?: "speech" | "thought" | "caption" | "sfx" | "sign" | "none"
  replace: boolean
  source?: { text: string; lines: string[]; align: "left" | "center" | "right"; caps: boolean }
  speaker?: string
  overlayBox?: Box; overlayUrl?: string
  fitBox?: Box; glyphHeight?: number
}
type Scene = {
  summary: string
  characters: { name: string; description: string }[]
  panels: { panelId: string; description: string }[]
  speakers: Record<string, string> // regionId -> character name
  notes: string[] // jokes, wordplay, cultural refs, sign meaning
}
type Translation = {
  lang: string; final: boolean; edited: boolean; updatedAt: string
  regions: Record<string, { text: string; literal?: string; notes?: string; maxChars?: number; maxLines?: number }>
  version?: string; label?: string; source?: string; model?: string // active version
}
type TrVersion = {
  id: string /* v1.. */; label: string; source: "user" | "llm"; model?: string /* "claude-cli:opus, ..." */
  from?: string; createdAt: string; updatedAt: string
  usage?: { calls: number; tokens: TokenUsage; costUsd: number; durationMs: number; models: string[] }
  regions: Translation["regions"]
}
type TrVersions = { lang: string; active: string; versions: TrVersion[] }
type Strip = { meta: {...}; panels: Panel[]; regions: Region[]; scene?: Scene; stages: Record<string, string>; imageUrl: string; cleanUrl?: string }
```

## Translation versions

- N versions per (strip, lang) in `tr/<lang>.versions.json`. One active. Ids `v1..`, never reused.
- Pipeline review run -> appends `llm` version (model = backends used, usage = translate+review calls via `llm.Meter`), activates it.
- LLM versions stay as generated. Review pass fails (weak local model, bad JSON) -> version keeps translate draft, `reviewError` set, UI chip "unreviewed draft". First editor edit forks `user` version; later edits in place.
- Migration (lazy, in memory until first write): `tr/<lang>@v1.json` -> v1 `llm` (model from `llm/review-<lang>-0.json`), `tr/<lang>.edit.json` -> v2 `user` active.
- Backend per request: `llm.WithSpec(ctx, spec)` on Router, `?timeout=90m` for slow local OpenAI-compat backends.
- `LLM_ALLOW_SPECS`: comma list of specs clients may request, `*` = any. Empty = no client specs (prod default).
- Editor: version select + facts (source, model, $, tokens, time) + rename + "Copy as mine" + delete.
- Viewer: version select in top bar when >1 version, `?ver=v3`. Local choice, does not activate. Edit link passes `ver` -> editor activates it.
- Bench: `bench/translate-versions.sh [api] [id] [lang] [spec...]` -> one version per spec, dump `bench/results/translate-<lang>-<date>.json`.

## Frontend (SolidJS)

Routes: `/` upload, `/s/:id?lang=en` work view (loading + editor are ONE component, no route change = seamless).

### Upload `/`
- Drop zone + file picker. Target lang select (en default; de, fr, es, it, pl, hu).
- Recent 10 grid: thumb (orig.png, css-scaled), name, date, langs. Click -> `/s/:id?lang=…`.
- Upload -> POST -> navigate `/s/:id?lang=`.

### Work view `/s/:id`
- Left: strip, scrollable (tall strips), scaled to column width; all overlays positioned in % of original size.
- Right sidebar during load: step checklist (ingest, panels, detect, order, ocr, scene, clean, translate, review) with state icon + message + progress.
- Streaming visuals:
  - panels -> thin outlines.
  - regions -> highlighted boxes (pulsing) on strip.
  - region (ocr) -> card appears in sidebar list with source text; box stops pulsing.
  - overlays -> overlay pngs placed -> bubbles appear empty.
  - translation -> translated text fitted into bubbles.
- On `done`: checklist collapses (animated) -> sidebar becomes editor list. Same DOM, same strip.
- Region highlight boxes: pulsing/filled only while streaming; in the editor only on hover/selection. A `regions` event replaces the list (detect ids `d*` are superseded by order ids `r*`).
- Editor card per region (reading order): `#n`, speaker, kind chip, source text (read-only), literal (small, muted), textarea translated (live preview in bubble), replace toggle, per-region "retranslate" button. Hover card <-> highlight bubble both ways.
- Top bar: lang select (switching -> new SSE for that lang; cached stages instant), "Save" -> render PNG -> POST render -> download link + show.
- Toggle: show original / translated.

### Text fit (one engine, preview == export)
- `layout(text, box, font, align) -> {fontSize, lines[], lineHeight}` with canvas `measureText`. Uppercase if source.caps. Word wrap greedy; binary search font size 6..64 px (original pixel units) until lines fit width and total height fits box. Long single word -> allow break.
- Box = region.fitBox, fallback textBox padded 2px. Max size: rendered cap height ("H" actualBoundingBoxAscent) <= glyphHeight * 1.15, keeps lettering size close to the original.
- Fit and vertical centering use the measured ink extent (first line ascent .. last line descent), not the line boxes.
- Preview: absolutely positioned div per region rendering `lines` at computed size (no CSS wrapping).
- Export: canvas at original size: draw clean.png (or orig.png + overlays), then the same layout lines. `document.fonts.ready` first.
- Font: hand-lettering Google font with latin-ext (ő ű). Default `Patrick Hand`. Woff2 bundled in `frontend/public/fonts/` (no CDN at runtime).

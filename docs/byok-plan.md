# BYOK, browser pipeline, serverless, credit proxy: plan (2026-10-20)

Status: **plan only. No code until approved.**
Inputs: `docs/llm.md` (Q3, billing), `docs/cost-opt.md` (model picks, ~$0.08/strip), `docs/browser.md` (browser detect).

Goal: whole pipeline runs in the browser. User brings LLM key. Site = static files. Server optional: share links + paid credits later.

## 0. Target shape

| step | now | target | who pays |
|---|---|---|---|
| ingest, panels (XY-cut) | Go | **TS** (canvas) | nobody |
| detect | browser WASM (done) | browser | nobody |
| detect postprocess (NMS, assign) | Go `cvstages.go:78-188` | **TS** | nobody |
| order | Go `readingOrder` | **TS** | nobody |
| ocr draft | - | browser PaddleOCR v5 latin | nobody |
| ocr, scene, translate, review | Go -> LLM | **browser -> LLM direct** | user key, or credits |
| clean (erase, fitBox, glyphHeight) | Go `imgproc/erase.go`, `interior.go` | **TS** (worker) | nobody |
| layout, render, export | TS (done: `layout.ts`, `render.ts`) | TS | nobody |
| storage | Go fs per sha256 | **browser OPFS** per sha256; optional cloud for share | - |

Go server becomes optional: (a) dev/bench tooling stays, (b) later credit proxy + share store.

## 1. BYO key: options

CORS preflight probed 2026-10-20 from fake origin `https://example.app`:

| provider | browser CORS | notes |
|---|---|---|
| OpenRouter `/api/v1/chat/completions` | **yes**, `ACAO: *` | returns `usage.cost` per call. One key, all models |
| OpenRouter `/api/v1/auth/keys` (PKCE exchange) | **yes** | OAuth PKCE works from a static page |
| Gemini OpenAI-compat `/v1beta/openai` | yes (echoes origin) | direct Google key. EU: free tier not for EEA users (did not re-check clause) |
| OpenAI | yes | |
| DeepSeek | yes | |
| Anthropic `/v1/messages` | only with header `anthropic-dangerous-direct-browser-access: true` | preflight w/o it -> 400 |

| option | UX | security | effort | verdict |
|---|---|---|---|---|
| A. paste OpenRouter key | user creates key, copies | key in browser storage; XSS = key theft | tiny | fallback |
| **B. OpenRouter OAuth PKCE** ("Connect OpenRouter") | 1 click, login, back. User sets spend limit on consent screen | key minted per app, user can revoke, limit set by user | small | **pick** |
| C. paste any provider key (Gemini, OpenAI, Anthropic, DeepSeek) | per provider, per-stage model map | same as A | medium: per-provider quirks (Anthropic format, Gemini JSON mode) | later, power users |
| D. local model (ollama `http://127.0.0.1:11434`) | needs `OLLAMA_ORIGINS` set | no key | small | later. Quality bad (cost-opt.md: gemma4 CER 0.27) |
| E. Chrome built-in AI (Gemini Nano) | no key | - | - | no: no Hungarian, desktop only |

Pick: **B, with A as "advanced: paste key"**. OpenRouter = one key, real per-call cost, all cost-opt.md picks available (`google/gemini-3.8-flash`, `google/gemini-3.1-flash-lite`).

### PKCE flow (OpenRouter)

1. `code_verifier` = 32 random bytes b64url. `code_challenge` = S256. Save verifier in `sessionStorage`.
2. Full-page redirect (not popup: COOP `same-origin` severs `window.opener`) to `https://openrouter.ai/auth?callback_url=<origin>/auth/cb&code_challenge=…&code_challenge_method=S256`.
3. Callback page reads `?code=`, `POST https://openrouter.ai/api/v1/auth/keys {code, code_verifier, code_challenge_method}` -> `{key}`.
4. Store key. Strip `?code` from URL (`history.replaceState`).

### Key storage

| where | survives reload | XSS readable | pick |
|---|---|---|---|
| memory only | no | yes | option: "don't remember" |
| `localStorage` | yes | yes | no |
| IndexedDB, AES-GCM wrapped by non-extractable `CryptoKey` | yes | **raw key not extractable**, but XSS can still call `decrypt` in-page | **default**. Stops casual disk/extension scraping, not XSS |

- Real XSS defense = no XSS: strict CSP. `default-src 'self'; connect-src 'self' https://openrouter.ai https://huggingface.co https://*.hf.co …; script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; base-uri 'none'`. No third-party scripts, no analytics JS.
- LLM output never rendered as HTML. Already text-only in Solid; keep it (no `innerHTML`).
- UI: show key prefix, "Disconnect" (delete + link to revoke on openrouter.ai), spend so far (sum of `usage.cost`).
- **Warning to user, in UI:** key lives in this browser. Shared computer -> use "don't remember".

## 2. Browser-direct LLM architecture

### Pieces (new TS, `frontend/src/lib/llm/`)

| file | does | ports from |
|---|---|---|
| `transport.ts` | `interface Transport { complete(req): Promise<Res> }`. `Req {stage, model, system, prompt, images: Blob[], effort?, json?}`. `Res {text, usage, costUsd, ms}` | `llm/llm.go` Backend |
| `openai.ts` | OpenAI-compat chat completions, base64 `image_url`, `reasoning_effort`, `usage.cost` read. `fetch` + `AbortSignal`, streaming optional | `llm/openai.go` |
| `client.ts` | schema hint, extract JSON, 1 retry on bad JSON, concurrency cap (4), call log | `llm/client.go` |
| `router.ts` | per stage model spec (`ocr`, `scene`, `translate`, `review`) from settings | `llm/router.go` + `config.go` |
| `prices.ts` | fallback $/M when provider returns no cost | `llm/prices.go` |
| `proxy.ts` | same `Transport`, calls our server with session (section 5) | new |

### Prompts: one source, two runtimes

- Go `text/template` files in `backend/internal/pipeline/prompts/*.tmpl` today.
- Plan: keep `.tmpl` as source. Templates use only `{{.X}}`, `{{range}}`, `{{if}}`: check, then render in TS with a ~80-line mini renderer, or rewrite as TS template functions and **delete Go copies** once Go pipeline is dev-only.
- Pick: **move prompts to TS** (`frontend/src/lib/pipeline/prompts.ts`), Go bench tools read them via a generated JSON (`prompts.json`, built by a `just` step). One source of truth, no template-language drift.
- Port `llmstages.go` (539 lines): `transcript`, `budget`, `applySpeakers`, `translatable`, `ocrReply.apply`, `cleanLines`, `normAlign`, `critiqueText`. Pure functions -> straight port + unit tests (vitest) against fixtures from `data/<id>/stages/*.json`.

### Orchestration

- `frontend/src/lib/pipeline/run.ts`: same stage list + cache semantics as Go: stage key = name + version const, result in OPFS `strips/<sha256>/stages/<stage>@v<N>.json`. Same JSON shapes = existing UI code unchanged.
- Run in a Web Worker (CV) + main thread fetches (LLM). Progress events replace SSE `/events`.
- `work.ts` gets a `Backend` switch: `server` (today) | `local` (new). Same UI.
- Call log: OPFS `llm/<stage>-<n>.json`, same shape -> `credits.ts`/usage panel reused.

### Images to LLM

- Debug panel images (`Annotate`: numbered red boxes) -> canvas port, ~40 lines. Font: bundled Patrick Hand (OFL) or system sans.
- Crops: `OffscreenCanvas.convertToBlob({type:"image/webp"})` (smaller than PNG) -> base64. Check provider accepts webp (Gemini, OpenAI: yes; others: did not check -> fallback png).
- Payload size: whole-strip OCR with crops ~ few MB base64. Fine for fetch.

### Failure modes

| case | handling |
|---|---|
| 401 / revoked key | drop key, prompt reconnect |
| 402 / OpenRouter credits out | show "top up on openrouter.ai" link |
| 429 | backoff 2^n, max 3 |
| provider content refusal (qwen on profanity, cost-opt.md) | fallback model per stage in settings |
| tab closed mid-run | stage cache in OPFS -> resume at next missing stage |

## 3. Infill (clean) port to browser

Port `imgproc` to TS, run in the detect worker (already has the image).

| Go | lines | TS target | notes |
|---|---|---|---|
| `panels.go` `Panels`, inkMap, despeckle, segments | 137 | `cv/panels.ts` | Uint8 luma buffer from `getImageData` |
| `cvstages.go` `panelRegions`, `nms`, `dropContained`, `smallestContaining`, `iou`, `shrink` | ~110 | `cv/regions.ts` | replaces server postprocess in `clientdetect.go` |
| `cvstages.go` `readingOrder`, `verticalOverlap` | ~30 | `cv/order.ts` | |
| `erase.go` `EraseArea`, `searchArea`, `Erase`, `glyphHeight`, `encloses`, `components` | 192 | `cv/erase.ts` | 8-conn CC: iterative stack, typed arrays |
| `interior.go` `FitBox`, `flood`, `erode`, `bestPiece`, `maxRect` | 165 | `cv/fitbox.ts` | |
| `annotate.go` | 86 | `cv/annotate.ts` | canvas strokeRect + fillText |
| `cvstages.go` `erase()` overlays | ~45 | `cv/clean.ts` | overlays = `ImageBitmap` crops, not files |

- **Parity tests:** Go writes golden JSON (regions, eraseArea, fitBox, glyphHeight, pixel hash of clean.png) for the 10 cost-opt strips. TS tests must match exactly (same luma formula `image.go:84`, same thresholds). Small off-by-one in loops = visible drift, so golden tests first.
- **Re-erase on replace toggle:** editor toggles `replace` -> worker re-runs `Erase` for that region only on a copy of orig, patches `clean` bitmap + overlay. <50 ms per region expected (did not measure).
- clean.png no longer stored server side in local mode. Export uses `render.ts` with in-memory clean bitmap.
- Text over art (non-bubble): out of scope here. Later AOT-GAN 23 MB opt-in (`docs/llm.md` Inpaint).
- Rejected: compile Go `imgproc` to WASM. One source, but +2-5 MB wasm, second runtime in worker, harder debug. Code is ~700 lines of plain loops: TS port cheaper to own.

## 4. Serverless hosting

### What must be served

| asset | size | source |
|---|---|---|
| app JS/CSS | <1 MB | static host |
| ort-web WASM (threaded SIMD) | ~12 MB (did not re-measure) | static host or jsDelivr |
| ort-web WebGPU asyncify (opt-in) | 26.8 MB raw / 6.7 MB gz | same. **> 25 MiB Cloudflare Pages per-file limit** |
| detector v4-s int8 | 11.1 MB | HF `ogkalu/comic-text-and-bubble-detector` (Apache-2.0) direct, CORS ok |
| PaddleOCR v5 latin det + rec + dict | ~8-12 MB | HF / jsDelivr |
| fonts | <200 KB | static host |

- Models: fetch from HF `resolve/<commit-sha>/…` (pin commit, not `main`), cache in Cache API, verify sha256 before use. Mirror to own bucket if HF rate-limits.

### Cross-origin isolation (threads need `SharedArrayBuffer`)

- Headers on HTML: `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`.
- Under COEP: every cross-origin subresource needs CORS or `Cross-Origin-Resource-Policy`. `fetch()` to HF/OpenRouter = CORS mode, fine. `<img src=other-origin>` without CORP breaks: avoid; load via `fetch` -> blob URL.
- `COEP: credentialless` = looser, but Safari support: did not check. Use `require-corp`.
- OAuth: redirect flow only (popup + COOP breaks opener).
- Host without custom headers (GitHub Pages): `coi-serviceworker` hack (SW injects headers, page reloads once). Works, ugly first load. Fallback: single-thread WASM (`numThreads=1`, ~2-4x slower detect).

| host | custom headers | file limit | cost | verdict |
|---|---|---|---|---|
| **Cloudflare Pages** | `_headers` file | 25 MiB/file, 20k files | free, unmetered bandwidth | **pick**. WebGPU wasm from jsDelivr (CORS ok) |
| Netlify | `_headers` | ok | free tier 100 GB/mo | ok |
| Vercel | `vercel.json` | ok | hobby = non-commercial ToS | no, if monetized |
| GitHub Pages | no | 100 MB | free | coi-serviceworker hack. Fine for FOSS demo |
| server + Caddy (now) | yes | - | own box | keep for server mode |

### Storage

| need | local mode | with server |
|---|---|---|
| strips, stages, translations | OPFS per sha256. `navigator.storage.persist()` | same, + sync |
| share link | no | upload rendered PNG + translation JSON to R2 via presigned PUT (tiny Worker). Read-only page |
| backup | export/import `.zip` of a strip folder | - |

- iOS Safari OPFS: works, evicts after 7 days w/o use unless installed as PWA. Tell user; export zip.
- Share store is the first point where we host user content -> legal section 3 (DSA, takedown).

## 5. Later: paid-credit proxy (Go)

Two designs.

| | P1. Go proxy | P2. OpenRouter per-user keys (Provisioning API) |
|---|---|---|
| how | browser `proxy.ts` -> `POST /api/llm/complete` -> Go -> OpenRouter, our key | server mints a sub-key per user with $ limit = paid / 2; browser calls OpenRouter direct |
| server load | proxies image payloads (few MB per call). server 2 cores ok for low volume | none after mint |
| control | full: model allowlist, prompt must be ours, max_tokens cap | user holds a real key: can use it outside app, any model, up to limit |
| markup | per call, exact | baked into limit. Same 2x |
| ToS risk | low: we sell an app feature | **higher**: handing out raw API access = resale. Did not check OpenRouter clause |
| pick | **P1** | no |

### P1 design

- Reuse Go: `llm/openai.go`, `client.go`, `meter.go`, `credits.go` (2x, 1 credit = $0.01 billed, ceil per call).
- Auth: email magic link or passkey. Session cookie `HttpOnly; Secure; SameSite=Strict`. No passwords.
- Ledger (sqlite, `store` interface already planned): `users`, `ledger(id, user, delta_credits, kind: purchase|hold|settle|refund, ref, at)`. Balance = sum. Append only.
- Call path:
  1. Request `{stage, model, messages}`. Reject if model not in allowlist or stage unknown.
  2. Pre-hold: worst case credits = price(model, input est, max_tokens cap). Balance < hold -> 402.
  3. Call OpenRouter with `usage: {include: true}`. Settle with real `usage.cost` x 2. Release rest of hold.
  4. Log call (no image bytes stored; prompt hash only).
- Abuse limits: per-user concurrency 4, per-user $/day cap, image count + byte cap per call, prompts from server-side templates only (client sends data, server renders prompt -> proxy can't be used as generic LLM). This means prompt rendering in Go again for proxy mode: keep the generated `prompts.json` shared by both.
- Payments: Merchant of Record (Paddle / Lemon Squeezy / Polar). Webhook `purchase.completed` -> ledger `+credits`. Packs: $5 = 250 credits (~30 strips at ~$0.08 x2), $15 = 800.
- Free trial: 20 credits per verified email (~2 strips). Card-less trials attract abuse: cap signups per IP/day.
- UI: same `credits.ts` display; "Use my key" vs "Use credits" toggle per session.

## 6. Phases

| # | what | done when |
|---|---|---|
| 1 | TS LLM transport + OpenRouter PKCE + paste key + settings (models per stage) | browser runs ocr/scene/translate/review vs current Go server for storage |
| 2 | Prompts + `llmstages` port, OPFS store, local pipeline runner | full run with server down, same JSON as Go on 10 strips |
| 3 | CV port (panels, regions, order, erase, fitBox, annotate) with Go golden tests | pixel-exact clean on 10 strips; replace toggle re-erases client side |
| 4 | Static build + Cloudflare Pages + CSP/COOP/COEP `_headers`, models from HF pinned | public URL, no backend, works in Chrome, Firefox, Safari 26, iOS |
| 5 | Share links (R2 + Worker) | optional |
| 6 | Credit proxy P1 + MoR payments + ToS/privacy pages | only if phase 4 gets users (see opinion) |

Phase 1-3 each shippable alone. Server mode (server) keeps working the whole time.

---

# Opinion

Not legal or tax advice. Hungarian/EU facts from memory, not re-checked today. Ask a könyvelő and, before charging money, a lawyer.

## O1. Monetization

- Unit economics fine: cost ~$0.08/strip, sell at 2x = $0.16. Margin per strip ~$0.08 minus payment fees (MoR ~5% + $0.50/txn -> on $5 pack: ~$0.75 gone). Small packs barely pay.
- Market is the problem, not margin:
  - Manga/manhwa readers: crowded, free (browser extensions, Kites, libre-manga-translator, Cotrans, ichigo). They already run free local pipelines + free LLM tiers. Hard to charge.
  - Western/Hungarian strip readers: tiny niche. Napirajz -> English audience: hundreds of people, not thousands.
- Money that exists: **creators** translating **their own** comics (webcomic artists, small publishers, Pepper&Carrot-style community translations). They own rights, need quality + editor + lettering, will pay $10-30/mo or per-book. Legally clean. Our edge (scene context, jokes, review pass, editor) fits them, not pirates.
- Pick: **FOSS + BYOK free forever; credits as convenience; aim pitch at creators**. Expect $0-50/mo first year. Treat as portfolio + tool you use, not income.

## O2. Business plan (lean, with kill criteria)

| stage | spend | measure | kill / go |
|---|---|---|---|
| 1. FOSS + static BYOK site | ~0 (CF Pages, domain $10/yr) | GitHub stars, weekly active strips (count via opt-in, no tracking JS) | <20 WAU after 3 months -> stays hobby |
| 2. Creator outreach | time | 10 webcomic creators try it; Napirajz authors asked for partnership | 0 of 10 would pay -> no credits |
| 3. Credits proxy | ~1-2 weeks build, MoR setup, ÁSZF/privacy | paying users, refund rate | <5 payers in 3 months -> turn off proxy, keep BYOK |
| 4. Creator tier | multi-page projects, glossary per series, consistent character voices, export to print sizes | MRR | - |

- Distribution: r/webcomics, Pepper&Carrot translator community (they translate by hand into 60+ langs: perfect showcase, CC-BY), Hungarian comic scene, HN "Show HN" for the browser-only angle.
- Costs that bite: support email + abuse handling, not servers.

## O3. Legal

### Copyright: translating others' comics

- Translation = adaptation. Exclusive right of author (HU Szjt. 1999. évi LXXVI. tv., EU same). Publishing a translated Napirajz without permission = infringement, even non-commercial.
- Private use by a natural person: HU private-copy exception covers copies for own use; translation for own private reading = grey but low risk. **Sharing/hosting = not covered.**
- **The tool itself is legal** (like Google Translate, DeepL, browser translate). Risk sits with hosting outputs and with marketing.
- Do:
  - Local mode stores nothing on our side -> we host nothing.
  - Share links (phase 5) -> we are a hosting provider: DSA notice-and-action (contact point, takedown form, act fast), ToS: user warrants rights. Or: no public share at all, only download.
  - Demo with CC-BY (Pepper&Carrot, attribution) and own/permitted strips. **Do not use Napirajz in public demos/marketing without written permission.** Ask the Napirajz authors: likely happy with an English audience, may become partners/showcase.
  - Don't pitch "read any comic in your language" (pirate positioning). Pitch "translate your comic".
- Models: detector Apache-2.0, Paddle Apache-2.0, `ppu-paddle-ocr` MIT, Patrick Hand OFL: all ok for FOSS + commercial. Keep NOTICE file.

### LLM provider ToS

- BYOK: contract is user <-> provider. We are a client app. Fine. Their key, their data terms.
- Credits (P1): we sell an app feature that uses an API. Normal (every AI SaaS). Don't expose a general-purpose endpoint (P1 restricts model + prompt for this reason).
- Gemini: free tier forbidden for EEA-facing services + trains on data (as I recall: verify). Use paid tier / OpenRouter.
- Content: profanity fine; provider usage policies forbid some content; images are user-uploaded -> ToS: user responsible, we can block.
- Data: images go to OpenRouter + downstream provider. Privacy policy must name them. Under P1 we are controller for account data, processor chain for images: DPA with OpenRouter (did not check they offer one).

### EU VAT + consumer law (selling credits)

- B2C digital services in EU: VAT at **customer's** country rate. Direct selling = OSS registration, VAT per country, invoices (HU: NAV online számla for HU buyers). Painful for a sole trader.
- **Merchant of Record** (Paddle / Lemon Squeezy / Polar): they are the seller, handle VAT worldwide, refunds, chargebacks. You invoice them monthly = one B2B export service. **Strongly recommended.** Cost ~5% + fixed fee.
- 14-day withdrawal right for digital content: lost only if user expressly consents to immediate performance and acknowledges loss of right -> checkbox at checkout (MoR usually handles). Offer refund of **unused** credits anyway: cheap goodwill.
- Credits = closed-loop, single-purpose: not e-money (limited-network exclusion). Don't let them be transferable or cashable.
- Expiry: avoid or ≥ 12 months, stated up front.
- HU webshop basics: ÁSZF (terms), adatkezelési tájékoztató (privacy), impresszum (name, address, adószám, contact). Cookie banner not needed if only strictly necessary session cookie.

### Hungary sole trader

- Egyéni vállalkozó, TEÁOR for software/online service. Tax: **átalányadózás** (flat-rate deductible cost ratio, 40% for most services: confirm category with könyvelő) is usually best for low-cost income.
- **KATA: no.** Since 2022 KATA only allows income from private individuals; MoR payouts come from a company.
- VAT: alanyi adómentesség (domestic threshold ~18M HUF/yr, check current) works when MoR is the seller: your supply is B2B to a foreign company -> reverse charge, still need EU VAT number (közösségi adószám) for that.
- Alternative before registering: run BYOK-only (no revenue) + GitHub Sponsors / Ko-fi. Donations to a private person: tax treatment unclear -> ask könyvelő before taking regular sponsorship.

## O4. FOSS + passive side gig

- License: **AGPL-3.0** for app + Go proxy. Hosted clones must share changes; you own copyright -> can dual-license or sell. Need a CLA (or DCO + keep proxy separate) if you want to relicense contributions later. Alternative MIT = max adoption, anyone can host a paid clone. Pick AGPL.
- Repo has **no LICENSE file** today. Must add before going public. Also strip `data/`, `.tmp/`, bench strips (Napirajz images, vault memes) from history: check `git log --all -- '*.png'` before publishing.
- Passive reality:
  - BYOK static site: ~$0/mo, near-zero ops. Truly passive. Earns nothing directly.
  - Credits: not passive. Payments, refunds, abuse, support, provider price changes (Gemini Flash doubles 2027-01-01: reprice credits, credits.go markup is per call so margin holds, but "~30 strips per $5" claim breaks).
  - Model churn: provider model names change every few months. Settings must let user pick; defaults need a yearly review.
- Recommended order: phases 1-4, release FOSS + BYOK, write up the browser-only pipeline (good blog/HN material), approach Napirajz authors + Pepper&Carrot community. Decide on phase 6 only with real usage numbers.

## Open questions for user

1. OK to drop Go pipeline to dev-only once TS pipeline matches (one pipeline, not two)?
2. Prompts move to TS as source of truth: OK?
3. Static host: Cloudflare Pages OK, or stay on server only?
4. License: AGPL-3.0 OK?
5. Credits: build at all, or BYOK only until users show up?

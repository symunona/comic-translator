# comic-translator

Drop a comic strip → detect bubbles → erase → read → get the joke → translate + review → letter it back → PNG.
Built for Napirajz (Hungarian, hand-lettered); any source language (detected) to any target language.

Live: https://comic.tmpx.space (public). The old server-side pipeline is tag `server-backend` (docs/spec.md describes it).

## How it works

Everything runs in the browser, on the user's own OpenRouter key.

| step | where | how |
|---|---|---|
| panels, erase, fit box | browser | `frontend/src/lib/cv/` (TS ports of the Go CV) |
| bubble detect | browser worker | onnxruntime-web, `detector-v4-s_int8.onnx` served at `/models/` |
| shared lookup | hub | image SHA-256 → translations others shared (only when the user shares) |
| ocr + source language, scene, translate, review | browser → OpenRouter | `google/gemini-3.8-flash`, prompts `frontend/src/lib/llm/prompts.ts`. ~$0.04 per strip, ~$0.016 per extra language |

- Key: localStorage only (`ct.apiKey`), pasted or via OpenRouter OAuth (PKCE, `/oauth`). Never sent to the hub.
- Strips: records in localStorage (`ct.strip.<hash>`), images in IndexedDB. Nothing leaves the browser unless shared.
- Sharing (checkbox, default on, optional nickname): Cloudflare Turnstile once → 30-day hub session. Posted: hash + translation file (boxes, OCR text, scene, translation). Never the image. Sharers get existing translations for the same image without a key, and reuse OCR + scene for a new language.
- Demos: `frontend/public/demos/` (5 Napirajz strips, en + de), bundled translation files, no key needed.

## hub (`hub/`)

Go, stdlib + `modernc.org/sqlite` (static, CGO off). `127.0.0.1:4750`.

| method | path | |
|---|---|---|
| GET | `/api/config` | `{turnstileSiteKey}` |
| POST | `/api/session` | `{token}` Turnstile → `{token, exp}` HMAC session (header `X-Session`) |
| GET | `/api/comics/{hash}` | session. `{translations:[{id, lang, srcLang, nick, createdAt}]}` |
| GET | `/api/translations/{id}` | session. the translation file |
| POST | `/api/comics/{hash}/translations` | session. file ≤ 1 MB; nickname claimed by first `X-Nick-Secret` (random, per browser) |
| GET | `/api/nicks/{nick}` | contributions of a nickname |
| GET | `/api/fetch?url=` | image proxy for the URL input. Public addresses only, images only, ≤ 30 MB |

Per-IP hourly limits. Also serves the built frontend (SPA fallback) and `/models/`.

## Dev (devbox)

```sh
just serve     # hub :4750 (tmux comic-hub) + vite :4721 (tmux comic-translator-web), Turnstile test keys
just check     # tsc + go vet + hub tests
```

## Prod (server)

```sh
just deploy    # build, rsync to ~/comic-hub, restart comic-hub.service
just logs
```

| thing | where |
|---|---|
| service | `~/.config/systemd/user/comic-hub.service` (from `deploy/`) |
| app dir | `~/comic-hub/{bin,web,data,vendor}`, db `data/hub.db`, session key `data/session.key` |
| secrets | `~/comic-hub/.env` (0600): `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET` |
| proxy | Caddy block `comic.tmpx.space` → `127.0.0.1:4750`, no auth |

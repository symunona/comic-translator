# comic-translator

Upload comic strip → detect bubbles → OCR → scene context → translate + review → erase text → edit → export PNG.
Built for Napirajz (Hungarian, hand-lettered). Spec: [docs/spec.md](docs/spec.md). Prior art: [docs/prior-art.md](docs/prior-art.md).

## Stack

| part | what |
|---|---|
| `backend/` | Go API, pipeline, per-hash FS store, SSE |
| detector | ogkalu/comic-text-and-bubble-detector ONNX via onnxruntime_go (CPU) |
| LLM | `claude -p` CLI (Claude Code subscription auth), opus. Prompts `backend/internal/pipeline/prompts/` |
| `frontend/` | SolidJS + Vite. One layout engine for preview + export |

## Dev (devbox)

```sh
just serve     # API :4720 + vite :4721 in tmux comic-translator-api / -web
just stop
just check     # tsc + go vet
```

Needs: ONNX Runtime 1.29.0 at `/data/cache/onnxruntime/…` (or `ORT_LIB`), detector at `/data/cache/models/comic-detector/detector.onnx`, `claude` logged in.

## Prod: https://comic.tmpx.space (server)

```sh
just deploy    # build on devbox, rsync to server, restart user service
just logs
just status
```

| thing | where |
|---|---|
| service | `~/.config/systemd/user/comic-translator.service` (from `deploy/`) |
| app dir | `~/comic-translator/{bin,web,data,tmp,vendor}` |
| port | `127.0.0.1:4720`, behind Caddy |
| TLS + basic auth | `~/caddy/Caddyfile` block `comic.tmpx.space`. users as hashes only, never in repo |
| DNS | Cloudflare A record, DNS-only |
| limits | `-llm-concurrency 2`, `MemoryMax=1800M` (box has ~3.8 GB) |

Binary built on devbox (glibc 2.43) runs on server (2.39): deploy checks max `GLIBC_` symbol ≤ 2.39, fails otherwise.
Prereqs on server: `claude` CLI logged in (`~/.local/bin/claude`). ORT + detector auto-downloaded to `vendor/` on first deploy.

#!/usr/bin/env bash
# Dev: hub :4750 (tmux comic-hub) + vite :4721 (tmux comic-translator-web).
# Turnstile test keys always pass; set TURNSTILE_SITE_KEY / TURNSTILE_SECRET to try real ones.
set -euo pipefail
root="$(cd "$(dirname "$0")" && pwd)"
export TURNSTILE_SITE_KEY=${TURNSTILE_SITE_KEY:-1x00000000000000000000AA}
export TURNSTILE_SECRET=${TURNSTILE_SECRET:-1x0000000000000000000000000000000AA}
tmux has-session -t comic-translator-web 2>/dev/null && tmux kill-session -t comic-translator-web
make -C "$root/hub" tmux
tmux new-session -d -s comic-translator-web -c "$root/frontend" "TMPDIR=$root/.tmp pnpm dev; read"
echo "hub :4750 (tmux comic-hub), web :4721 (tmux comic-translator-web)"

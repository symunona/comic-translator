#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")" && pwd)"
for s in comic-translator-web; do
  tmux has-session -t "$s" 2>/dev/null && tmux kill-session -t "$s"
done
make -C "$root/backend" tmux
tmux new-session -d -s comic-translator-web -c "$root/frontend" "TMPDIR=$root/.tmp pnpm dev; read"
echo "api :4720 (tmux comic-translator-api), web :4721 (tmux comic-translator-web)"

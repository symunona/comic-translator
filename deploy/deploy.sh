#!/usr/bin/env bash
# Build on devbox, ship to server, restart the user service.
# Detect runs in the browser (onnxruntime-web); the server serves the model and runs no inference.
set -euo pipefail

host=${DEPLOY_HOST:-server}
remote=comic-translator
root="$(cd "$(dirname "$0")/.." && pwd)"
model=detector-v4-s_int8.onnx
model_url="https://huggingface.co/ogkalu/comic-text-and-bubble-detector/resolve/main/$model"
model_sha=5fe9e4f576e49d4e7e8b0e029d6d3cdc252abd4694113e1cae120e62c931ea79
max_glibc=2.39

export TMPDIR="$root/.tmp"
mkdir -p "$TMPDIR"

echo "== build frontend"
(cd "$root/frontend" && pnpm install --frozen-lockfile --silent && pnpm build)

echo "== build backend"
make -C "$root/backend" build vet

need=$(objdump -T "$root/backend/bin/server" | grep -o 'GLIBC_[0-9.]*' | sed 's/GLIBC_//' | sort -uV | tail -1)
if [ "$(printf '%s\n%s\n' "$need" "$max_glibc" | sort -V | tail -1)" != "$max_glibc" ]; then
  echo "binary needs GLIBC $need, $host has $max_glibc" >&2
  exit 1
fi

echo "== prepare $host"
ssh "$host" bash -s -- "$remote" "$model" "$model_url" "$model_sha" <<'REMOTE'
set -euo pipefail
dir=$HOME/$1; model=$2; url=$3; sha=$4
mkdir -p "$dir"/{bin,web,data,tmp,vendor/models}
if ! echo "$sha  $dir/vendor/models/$model" | sha256sum -c --quiet >/dev/null 2>&1; then
  curl -fsSL -o "$dir/vendor/models/$model.part" "$url"
  echo "$sha  $dir/vendor/models/$model.part" | sha256sum -c --quiet
  mv "$dir/vendor/models/$model.part" "$dir/vendor/models/$model"
fi
grep -q "^OPENROUTER_API_KEY=." "$dir/.env" 2>/dev/null || { echo "OPENROUTER_API_KEY missing in $dir/.env on $(hostname)" >&2; exit 1; }
REMOTE

echo "== ship"
rsync -az --delete "$root/frontend/dist/" "$host:$remote/web/"
rsync -az "$root/backend/bin/server" "$host:$remote/bin/server.new"
rsync -az "$root/deploy/comic-translator.service" "$host:.config/systemd/user/comic-translator.service"

echo "== restart"
ssh "$host" "mv $remote/bin/server.new $remote/bin/server \
  && systemctl --user daemon-reload \
  && systemctl --user enable --quiet comic-translator \
  && systemctl --user restart comic-translator"

for _ in $(seq 1 20); do
  if ssh "$host" "curl -sf -o /dev/null 127.0.0.1:4720/api/strips"; then
    echo "== up: https://comic.tmpx.space"
    exit 0
  fi
  sleep 1
done
ssh "$host" "journalctl --user -u comic-translator -n 30 --no-pager" >&2
exit 1

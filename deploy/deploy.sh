#!/usr/bin/env bash
# Build on devbox, ship to server ~/comic-hub, restart comic-hub.service.
# Everything but the hub runs in the browser; the hub binary is static (CGO off).
set -euo pipefail

host=${DEPLOY_HOST:-server}
remote=comic-hub
port=4750
root="$(cd "$(dirname "$0")/.." && pwd)"
model=detector-v4-s_int8.onnx
model_url="https://huggingface.co/ogkalu/comic-text-and-bubble-detector/resolve/main/$model"
model_sha=5fe9e4f576e49d4e7e8b0e029d6d3cdc252abd4694113e1cae120e62c931ea79

export TMPDIR="$root/.tmp"
mkdir -p "$TMPDIR"

echo "== build frontend"
(cd "$root/frontend" && pnpm install --frozen-lockfile --silent && pnpm build)

echo "== build hub"
make -C "$root/hub" build vet test

echo "== prepare $host"
ssh "$host" bash -s -- "$remote" "$model" "$model_url" "$model_sha" <<'REMOTE'
set -euo pipefail
dir=$HOME/$1; model=$2; url=$3; sha=$4
mkdir -p "$dir"/{bin,web,data,vendor/models}
if ! echo "$sha  $dir/vendor/models/$model" | sha256sum -c --quiet >/dev/null 2>&1; then
  curl -fsSL -o "$dir/vendor/models/$model.part" "$url"
  echo "$sha  $dir/vendor/models/$model.part" | sha256sum -c --quiet
  mv "$dir/vendor/models/$model.part" "$dir/vendor/models/$model"
fi
grep -q "^TURNSTILE_SECRET=." "$dir/.env" 2>/dev/null || { echo "TURNSTILE_SITE_KEY / TURNSTILE_SECRET missing in $dir/.env on $(hostname)" >&2; exit 1; }
REMOTE

echo "== ship"
rsync -az --delete "$root/frontend/dist/" "$host:$remote/web/"
rsync -az "$root/hub/bin/hub" "$host:$remote/bin/hub.new"
rsync -az "$root/deploy/comic-hub.service" "$host:.config/systemd/user/comic-hub.service"

echo "== restart"
ssh "$host" "mv $remote/bin/hub.new $remote/bin/hub \
  && systemctl --user daemon-reload \
  && systemctl --user enable --quiet comic-hub \
  && systemctl --user restart comic-hub"

for _ in $(seq 1 20); do
  if ssh "$host" "curl -sf -o /dev/null 127.0.0.1:$port/api/config"; then
    echo "== up: https://comic.tmpx.space"
    exit 0
  fi
  sleep 1
done
ssh "$host" "journalctl --user -u comic-hub -n 30 --no-pager" >&2
exit 1

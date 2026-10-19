#!/usr/bin/env bash
# Build on devbox, ship to server, restart the user service.
set -euo pipefail

host=${DEPLOY_HOST:-server}
remote=comic-translator
root="$(cd "$(dirname "$0")/.." && pwd)"
ort_ver=1.29.0
ort_url="https://github.com/microsoft/onnxruntime/releases/download/v${ort_ver}/onnxruntime-linux-x64-${ort_ver}.tgz"
det_url="https://huggingface.co/ogkalu/comic-text-and-bubble-detector/resolve/main/detector.onnx"
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
ssh "$host" bash -s -- "$remote" "$ort_ver" "$ort_url" "$det_url" <<'REMOTE'
set -euo pipefail
dir=$HOME/$1; ort_ver=$2; ort_url=$3; det_url=$4
mkdir -p "$dir"/{bin,web,data,tmp,vendor}
if [ ! -f "$dir/vendor/onnxruntime/lib/libonnxruntime.so" ]; then
  curl -fsSL "$ort_url" | tar -xz -C "$dir/vendor"
  ln -sfn "onnxruntime-linux-x64-$ort_ver" "$dir/vendor/onnxruntime"
fi
if [ ! -s "$dir/vendor/detector.onnx" ]; then
  curl -fsSL -o "$dir/vendor/detector.onnx.part" "$det_url"
  mv "$dir/vendor/detector.onnx.part" "$dir/vendor/detector.onnx"
fi
command -v claude >/dev/null || { echo "claude CLI missing on $(hostname)" >&2; exit 1; }
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

#!/usr/bin/env bash
# Generate one translation version per backend for a strip via the API, then
# dump all versions + usage to bench/results/translate-<lang>-<date>.json.
# usage: bench/translate-versions.sh [api] [strip-id] [lang] [spec ...]
set -euo pipefail
api=${1:-http://127.0.0.1:4751}
id=${2:-2afc78b45293acd677ffcba91f53fea50838d406d2dd965846e83408657e58c7}
lang=${3:-en}
shift $(( $# < 3 ? $# : 3 ))
specs=("$@")
if [ ${#specs[@]} -eq 0 ]; then
  specs=(claude-cli:opus claude-cli:sonnet claude-cli:haiku)
fi
here=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$here/results"
for spec in "${specs[@]}"; do
  echo "== $spec"
  start=$(date +%s)
  curl -sS --max-time 7200 -X POST "$api/api/strips/$id/translations/$lang/versions" \
    -H 'content-type: application/json' \
    -d "$(jq -n --arg s "$spec" '{spec: $s}')" |
    jq -c '{id, label, model, error, usage: (.usage // {} | {calls, costUsd, durationMs, in: .tokens.input_tokens, out: .tokens.output_tokens})}'
  echo "   wall $(( $(date +%s) - start ))s"
done
curl -sS "$api/api/strips/$id/translations/$lang/versions" >"$here/results/translate-$lang-$(date +%F).json"
echo "saved $here/results/translate-$lang-$(date +%F).json"

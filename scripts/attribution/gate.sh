#!/usr/bin/env bash
# Atribuicao de commit (AI-07, AI-08, AI-09).
#
# Recusa Co-Authored-By que nomeia modelo e Signed-off-by num commit que ja
# carrega Assisted-by (maquina se passando por certificacao humana). Nao
# exige Assisted-by em commit puramente humano.
#
# Uso:
#   scripts/attribution/gate.sh                 # origin/main..HEAD, ou so HEAD
#   scripts/attribution/gate.sh <base> <head>

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly ROOT

BASE="${1:-}"
HEAD="${2:-HEAD}"

if [[ -z "${BASE}" ]]; then
  if git -C "${ROOT}" rev-parse --verify --quiet origin/main >/dev/null; then
    BASE="origin/main"
  else
    BASE=""
  fi
fi

model_coauthor() {
  grep -Ei '^[[:space:]]*Co-Authored-By:.*(claude|chatgpt|gpt-|grok|composer|cursor|copilot|gemini|sonnet|opus|codex)' <<<"$1"
}

machine_signoff() {
  grep -qi '^[[:space:]]*Assisted-by:' <<<"$1" && grep -qi '^[[:space:]]*Signed-off-by:' <<<"$1"
}

failures=0
shas=()
if [[ -n "${BASE}" ]] && git -C "${ROOT}" rev-parse --verify --quiet "${BASE}" >/dev/null &&
  git -C "${ROOT}" rev-parse --verify --quiet "${HEAD}" >/dev/null; then
  merge="$(git -C "${ROOT}" merge-base "${BASE}" "${HEAD}")"
  mapfile -t shas < <(git -C "${ROOT}" rev-list "${merge}..${HEAD}")
else
  if git -C "${ROOT}" rev-parse --verify --quiet "${HEAD}" >/dev/null; then
    shas=("$(git -C "${ROOT}" rev-parse "${HEAD}")")
    echo "attribution-gate: sem base de PR; checando ${HEAD}."
  else
    echo "attribution-gate: ref head nao encontrada: ${HEAD}" >&2
    exit 2
  fi
fi

if ((${#shas[@]} == 0)); then
  echo "attribution-gate: nenhum commit no intervalo."
  exit 0
fi

for sha in "${shas[@]}"; do
  body="$(git -C "${ROOT}" show -s --format=%B "${sha}")"
  if model_coauthor "${body}" >/dev/null; then
    echo "  FALHA: ${sha:0:8} usa Co-Authored-By de modelo (AI-09)" >&2
    failures=$((failures + 1))
  fi
  if machine_signoff "${body}"; then
    echo "  FALHA: ${sha:0:8} mistura Assisted-by com Signed-off-by (AI-08)" >&2
    failures=$((failures + 1))
  fi
done

if ((failures > 0)); then
  echo >&2
  echo "attribution-gate: ${failures} problema(s). Gate fecha." >&2
  exit 1
fi

echo "attribution-gate: atribuicao dos commits no intervalo e humana ou Assisted-by."

#!/usr/bin/env bash
# Gate de error-masking no diff (FR-7 / GitClear +47%).
#
# Nao liga `clippy::let_underscore_must_use = deny` no workspace: ha dezenas
# de `let _ =` legados, muitos em `fmt::Write`. O que este gate recusa e um
# descarte NOVO no diff, visto pelo clippy (`let_underscore_must_use` e
# `unused_must_use`) na intersecao com linhas adicionadas. Excecao so com
# `mascarado-porque:` na linha ou na anterior.
#
# Uso:
#   scripts/error-masking/gate.sh                      # origin/main..HEAD
#   scripts/error-masking/gate.sh <base> <head>
#   scripts/error-masking/gate.sh --from <diff> <json> <raiz>

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly ROOT

added_lines() {
  local file="" new=0
  local line
  while IFS= read -r line || [[ -n "${line}" ]]; do
    if [[ "${line}" == +++[[:space:]]* ]]; then
      file="${line#+++ }"
      file="${file#b/}"
      continue
    fi
    if [[ "${line}" =~ ^@@[[:space:]] ]]; then
      local plus
      plus="$(sed -n 's/^@@ [^@]*+\([0-9]*\)[^@]*@@.*/\1/p' <<<"${line}")"
      new="${plus:-0}"
      continue
    fi
    [[ -z "${file}" || "${file}" == /dev/null ]] && continue
    if [[ "${line}" == +* && "${line}" != +++* ]]; then
      printf '%s:%s\n' "${file}" "${new}"
      new=$((new + 1))
    elif [[ "${line}" != -* ]]; then
      new=$((new + 1))
    fi
  done
}

normalize_path() {
  local f="$1"
  if [[ "${f#crates/}" != "${f}" ]]; then
    printf '%s' "${f}"
  elif [[ "${f}" == *"/crates/"* ]]; then
    printf 'crates/%s' "${f##*/crates/}"
  else
    printf '%s' "${f}"
  fi
}

diagnostics() {
  local json="$1"
  if ! command -v jq >/dev/null 2>&1; then
    echo "error-masking-gate: jq e obrigatorio" >&2
    return 2
  fi
  [[ -s "${json}" ]] || return 0
  jq -r '
    select(.reason == "compiler-message")
    | .message
    | select(.code != null)
    | select(.code.code == "clippy::let_underscore_must_use" or .code.code == "unused_must_use")
    | .spans[]?
    | select(.is_primary == true)
    | "\(.file_name):\(.line_start)"
  ' "${json}" | while IFS= read -r hit; do
    [[ -z "${hit}" ]] && continue
    local path="${hit%:*}"
    local n="${hit##*:}"
    printf '%s:%s\n' "$(normalize_path "${path}")" "${n}"
  done
}

annotated() {
  local raiz="$1" rel="$2" n="$3"
  local src="${raiz}/${rel}"
  [[ -f "${src}" ]] || return 1
  local prev=$((n - 1))
  local cur prev_txt=""
  cur="$(sed -n "${n}p" "${src}")"
  if ((prev >= 1)); then
    prev_txt="$(sed -n "${prev}p" "${src}")"
  fi
  [[ "${cur}" == *"mascarado-porque:"* || "${prev_txt}" == *"mascarado-porque:"* ]]
}

allow_in_diff() {
  local file="" new=0 line
  while IFS= read -r line || [[ -n "${line}" ]]; do
    if [[ "${line}" == +++[[:space:]]* ]]; then
      file="${line#+++ }"
      file="${file#b/}"
      continue
    fi
    if [[ "${line}" =~ ^@@[[:space:]] ]]; then
      local plus
      plus="$(sed -n 's/^@@ [^@]*+\([0-9]*\)[^@]*@@.*/\1/p' <<<"${line}")"
      new="${plus:-0}"
      continue
    fi
    [[ -z "${file}" || "${file}" == /dev/null ]] && continue
    if [[ "${line}" == +* && "${line}" != +++* ]]; then
      if [[ "${line}" == *"allow(unused_must_use)"* || "${line}" == *"allow(clippy::let_underscore_must_use)"* ]]; then
        printf '%s:%s\n' "${file}" "${new}"
      fi
      new=$((new + 1))
    elif [[ "${line}" != -* ]]; then
      new=$((new + 1))
    fi
  done
}

run_from() {
  local diff_file="$1" json_file="$2" raiz="$3"
  local failures=0
  declare -A added
  local hit

  while IFS= read -r hit; do
    [[ -z "${hit}" ]] && continue
    added["${hit}"]=1
  done < <(added_lines <"${diff_file}")

  while IFS= read -r hit; do
    [[ -z "${hit}" ]] && continue
    [[ -n "${added[${hit}]+x}" ]] || continue
    local rel="${hit%:*}" n="${hit##*:}"
    if annotated "${raiz}" "${rel}" "${n}"; then
      continue
    fi
    echo "  FALHA: ${rel}:${n} descarta falha sem mascarado-porque:" >&2
    failures=$((failures + 1))
  done < <(diagnostics "${json_file}")

  while IFS= read -r hit; do
    [[ -z "${hit}" ]] && continue
    local rel="${hit%:*}" n="${hit##*:}"
    if annotated "${raiz}" "${rel}" "${n}"; then
      continue
    fi
    echo "  FALHA: ${rel}:${n} adiciona allow(unused_must_use) sem mascarado-porque:" >&2
    failures=$((failures + 1))
  done < <(allow_in_diff <"${diff_file}")

  if ((failures > 0)); then
    echo >&2
    echo "error-masking-gate: ${failures} problema(s). Gate fecha." >&2
    return 1
  fi
  echo "error-masking-gate: nenhum descarte novo sem razao gravada."
  return 0
}

if [[ "${1:-}" == "--from" ]]; then
  run_from "${2:?}" "${3:?}" "${4:?}"
  exit $?
fi

if [[ -n "${1:-}" ]]; then
  BASE="$1"
elif git -C "${ROOT}" rev-parse --verify --quiet origin/main >/dev/null; then
  BASE="origin/main"
elif git -C "${ROOT}" rev-parse --verify --quiet main >/dev/null; then
  BASE="main"
else
  echo "error-masking-gate: nenhuma ref base (origin/main ou main)" >&2
  exit 2
fi
HEAD="${2:-HEAD}"

if ! git -C "${ROOT}" rev-parse --verify --quiet "${BASE}" >/dev/null; then
  echo "error-masking-gate: ref base nao encontrada: ${BASE}" >&2
  exit 2
fi
if ! git -C "${ROOT}" rev-parse --verify --quiet "${HEAD}" >/dev/null; then
  echo "error-masking-gate: ref head nao encontrada: ${HEAD}" >&2
  exit 2
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "error-masking-gate: jq e obrigatorio" >&2
  exit 2
fi

diff_file="$(mktemp)"
json_file="$(mktemp)"
cleanup_tmp() {
  python3 -c 'import os, sys
for p in sys.argv[1:]:
    try:
        os.remove(p)
    except FileNotFoundError:
        pass
' "${diff_file}" "${json_file}"
}
trap cleanup_tmp EXIT

git -C "${ROOT}" diff "${BASE}" "${HEAD}" -- '*.rs' >"${diff_file}"
if [[ ! -s "${diff_file}" ]]; then
  echo "error-masking-gate: nenhuma mudanca em .rs; nada para checar."
  exit 0
fi

declare -A pkgs
while IFS= read -r hit; do
  [[ -z "${hit}" ]] && continue
  rel="${hit%:*}"
  case "${rel}" in
  crates/*)
    rest="${rel#crates/}"
    pkgs["${rest%%/*}"]=1
    ;;
  esac
done < <(added_lines <"${diff_file}")

if [[ ${#pkgs[@]} -eq 0 ]]; then
  echo "error-masking-gate: nenhuma linha adicionada em crates/; nada para checar."
  exit 0
fi

args=()
for p in "${!pkgs[@]}"; do
  args+=(-p "${p}")
done

if ! cargo clippy --manifest-path "${ROOT}/Cargo.toml" "${args[@]}" \
  --all-targets --all-features --message-format=json \
  -- -W clippy::let_underscore_must_use -W unused_must_use \
  >"${json_file}" 2>/dev/null; then
  if [[ ! -s "${json_file}" ]]; then
    echo "error-masking-gate: cargo clippy nao produziu JSON." >&2
    exit 2
  fi
fi

run_from "${diff_file}" "${json_file}" "${ROOT}"

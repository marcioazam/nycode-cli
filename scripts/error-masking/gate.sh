#!/usr/bin/env bash
# Gate de error-masking no diff (FR-7 / GitClear +47%).
#
# Nao liga `clippy::let_underscore_must_use = deny` no workspace: ha dezenas
# de `let _ =` legados, muitos em `fmt::Write`. O que este gate recusa e um
# descarte NOVO no diff, visto pelo clippy (`let_underscore_must_use` e
# `unused_must_use`) na intersecao com linhas adicionadas. Excecao so com
# `mascarado-porque:` na linha ou num comentario na anterior.
#
# Uso:
#   scripts/error-masking/gate.sh                      # origin/main..HEAD
#   scripts/error-masking/gate.sh <base> <head>
#   scripts/error-masking/gate.sh --from <diff> <json> <raiz>

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly ROOT

is_file_header() {
  [[ "$1" == +++[[:space:]]b/* || "$1" == +++[[:space:]]/dev/null ]]
}

walk_added() {
  local file="" new=0
  local line plus
  while IFS= read -r line || [[ -n "${line}" ]]; do
    if [[ "${line}" == '\\ No newline at end of file' ]]; then
      continue
    fi
    if is_file_header "${line}"; then
      file="${line#+++ }"
      file="${file#b/}"
      continue
    fi
    if [[ "${line}" =~ ^@@[[:space:]] ]]; then
      plus="$(sed -n 's/^@@ [^@]*+\([0-9][0-9]*\)[^@]*@@.*/\1/p' <<<"${line}")"
      if [[ -z "${plus}" ]]; then
        echo "error-masking-gate: hunk ilegivel: ${line}" >&2
        return 2
      fi
      new="${plus}"
      continue
    fi
    [[ -z "${file}" || "${file}" == /dev/null ]] && continue
    if [[ "${line}" == +* && "${line}" != +++* ]]; then
      printf '%s:%s\n' "${file}" "${new}"
      new=$((new + 1))
    elif [[ "${line}" == ' '* ]]; then
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
  local raw hit path n
  if ! command -v jq >/dev/null 2>&1; then
    echo "error-masking-gate: jq e obrigatorio" >&2
    return 2
  fi
  if [[ ! -f "${json}" ]]; then
    echo "error-masking-gate: json ausente: ${json}" >&2
    return 2
  fi
  [[ -s "${json}" ]] || return 0
  raw="$(mktemp)"
  if ! jq -r '
    select(.reason == "compiler-message")
    | .message
    | select(.code != null)
    | select(.code.code == "clippy::let_underscore_must_use" or .code.code == "unused_must_use")
    | .spans[]?
    | select(.is_primary == true)
    | "\(.file_name):\(.line_start)"
  ' "${json}" >"${raw}"; then
    rm -f -- "${raw}"
    echo "error-masking-gate: jq nao parseou o JSON do clippy." >&2
    return 2
  fi
  while IFS= read -r hit || [[ -n "${hit}" ]]; do
    [[ -z "${hit}" ]] && continue
    path="${hit%:*}"
    n="${hit##*:}"
    printf '%s:%s\n' "$(normalize_path "${path}")" "${n}"
  done <"${raw}"
  rm -f -- "${raw}"
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
  [[ "${cur}" == *"mascarado-porque:"* ]] && return 0
  [[ "${prev_txt}" == *"mascarado-porque:"* && "${prev_txt}" == *"//"* ]]
}

is_must_use_allow() {
  local line="$1"
  [[ "${line}" == *"unused_must_use"* || "${line}" == *"let_underscore_must_use"* ]] || return 1
  [[ "${line}" == *"allow("* || "${line}" == *"expect("* ]]
}

allow_in_diff() {
  local file="" new=0 line plus
  while IFS= read -r line || [[ -n "${line}" ]]; do
    if [[ "${line}" == '\\ No newline at end of file' ]]; then
      continue
    fi
    if is_file_header "${line}"; then
      file="${line#+++ }"
      file="${file#b/}"
      continue
    fi
    if [[ "${line}" =~ ^@@[[:space:]] ]]; then
      plus="$(sed -n 's/^@@ [^@]*+\([0-9][0-9]*\)[^@]*@@.*/\1/p' <<<"${line}")"
      if [[ -z "${plus}" ]]; then
        echo "error-masking-gate: hunk ilegivel: ${line}" >&2
        return 2
      fi
      new="${plus}"
      continue
    fi
    [[ -z "${file}" || "${file}" == /dev/null ]] && continue
    if [[ "${line}" == +* && "${line}" != +++* ]]; then
      if is_must_use_allow "${line}"; then
        printf '%s:%s\n' "${file}" "${new}"
      fi
      new=$((new + 1))
    elif [[ "${line}" == ' '* ]]; then
      new=$((new + 1))
    fi
  done
}

run_from() {
  local diff_file="$1" json_file="$2" raiz="$3"
  local failures=0
  declare -A added
  local hit rel n
  local added_tmp diag_tmp allow_tmp
  added_tmp="$(mktemp)"
  diag_tmp="$(mktemp)"
  allow_tmp="$(mktemp)"

  if ! walk_added <"${diff_file}" >"${added_tmp}"; then
    rm -f -- "${added_tmp}" "${diag_tmp}" "${allow_tmp}"
    return 2
  fi
  if ! diagnostics "${json_file}" >"${diag_tmp}"; then
    rm -f -- "${added_tmp}" "${diag_tmp}" "${allow_tmp}"
    return 2
  fi
  if ! allow_in_diff <"${diff_file}" >"${allow_tmp}"; then
    rm -f -- "${added_tmp}" "${diag_tmp}" "${allow_tmp}"
    return 2
  fi

  while IFS= read -r hit || [[ -n "${hit}" ]]; do
    [[ -z "${hit}" ]] && continue
    added["${hit}"]=1
  done <"${added_tmp}"

  while IFS= read -r hit || [[ -n "${hit}" ]]; do
    [[ -z "${hit}" ]] && continue
    [[ -n "${added[${hit}]+x}" ]] || continue
    rel="${hit%:*}" n="${hit##*:}"
    if annotated "${raiz}" "${rel}" "${n}"; then
      continue
    fi
    echo "  FALHA: ${rel}:${n} descarta falha sem mascarado-porque:" >&2
    failures=$((failures + 1))
  done <"${diag_tmp}"

  while IFS= read -r hit || [[ -n "${hit}" ]]; do
    [[ -z "${hit}" ]] && continue
    rel="${hit%:*}" n="${hit##*:}"
    if annotated "${raiz}" "${rel}" "${n}"; then
      continue
    fi
    echo "  FALHA: ${rel}:${n} adiciona allow(unused_must_use) sem mascarado-porque:" >&2
    failures=$((failures + 1))
  done <"${allow_tmp}"

  rm -f -- "${added_tmp}" "${diag_tmp}" "${allow_tmp}"

  if ((failures > 0)); then
    echo >&2
    echo "error-masking-gate: ${failures} problema(s). Gate fecha." >&2
    return 1
  fi
  echo "error-masking-gate: nenhum descarte novo sem razao gravada."
  return 0
}

if [[ "${1:-}" == "--from" ]]; then
  if [[ -z "${2:-}" || -z "${3:-}" || -z "${4:-}" ]]; then
    echo "error-masking-gate: --from exige <diff> <json> <raiz>" >&2
    exit 2
  fi
  run_from "$2" "$3" "$4"
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

tmp_dir="$(mktemp -d)"
diff_file="${tmp_dir}/diff"
json_file="${tmp_dir}/clippy.json"
clippy_err="${tmp_dir}/clippy.err"
cleanup_tmp() {
  rm -rf -- "${tmp_dir}"
}
trap cleanup_tmp EXIT

git -C "${ROOT}" diff "${BASE}" "${HEAD}" -- '*.rs' >"${diff_file}" ||
  {
    echo "error-masking-gate: git diff falhou." >&2
    exit 2
  }
if [[ ! -s "${diff_file}" ]]; then
  echo "error-masking-gate: nenhuma mudanca em .rs; nada para checar." >&2
  exit 0
fi

declare -A pkgs
added_for_pkgs="$(mktemp)"
if ! walk_added <"${diff_file}" >"${added_for_pkgs}"; then
  rm -f -- "${added_for_pkgs}"
  echo "error-masking-gate: nao deu para parsear o diff." >&2
  exit 2
fi
while IFS= read -r hit || [[ -n "${hit}" ]]; do
  [[ -z "${hit}" ]] && continue
  rel="${hit%:*}"
  case "${rel}" in
  crates/*)
    rest="${rel#crates/}"
    pkgs["${rest%%/*}"]=1
    ;;
  esac
done <"${added_for_pkgs}"
rm -f -- "${added_for_pkgs}"

if [[ ${#pkgs[@]} -eq 0 ]]; then
  echo "error-masking-gate: nenhuma linha adicionada em crates/; nada para checar." >&2
  exit 0
fi

args=()
for p in "${!pkgs[@]}"; do
  args+=(-p "${p}")
done

if ! cargo clippy --manifest-path "${ROOT}/Cargo.toml" "${args[@]}" \
  --all-targets --all-features --message-format=json \
  -- -W clippy::let_underscore_must_use -W unused_must_use \
  >"${json_file}" 2>"${clippy_err}"; then
  cat "${clippy_err}" >&2
  echo "error-masking-gate: cargo clippy falhou; medicao incompleta." >&2
  exit 2
fi

run_from "${diff_file}" "${json_file}" "${ROOT}"

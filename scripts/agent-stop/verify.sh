#!/usr/bin/env bash
# Verificacao no Stop do agente (Claude Code, Codex, Cursor).
#
# Fail-closed: Claude/Codex usam exit 2 (exit 1 e fail-open nas tres
# ferramentas). Cursor ja encerrou o loop — a continuacao e JSON
# `followup_message` com exit 0. Nao escreve stdout no sucesso: o Stop
# do Codex trata texto puro como JSON invalido.
#
# Pula quando o Stop ja continuou (`stop_hook_active`), quando o Cursor
# abortou ou bateu o teto de loop, ou quando nenhum `.rs` em `crates/`
# esta sujo. Senao roda `cargo test` so nos crates tocados. `cargo` vai
# para stderr para nao quebrar o JSON do Cursor nem o stdout vazio do Codex.
#
# Uso (stdin = JSON do hook):
#   scripts/agent-stop/verify.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
if [[ -n "${CLAUDE_PROJECT_DIR:-}" ]]; then
  ROOT="${CLAUDE_PROJECT_DIR}"
fi
readonly ROOT

input=""
if [[ ! -t 0 ]]; then
  input="$(cat || true)"
fi

jq_ok=0
if command -v jq >/dev/null 2>&1 && [[ -n "${input}" ]]; then
  if jq -e . >/dev/null 2>&1 <<<"${input}"; then
    jq_ok=1
  fi
fi

field_true() {
  local key="$1"
  if [[ "${jq_ok}" -eq 1 ]]; then
    [[ "$(jq -r --arg k "${key}" '.[$k] == true' <<<"${input}")" == true ]]
    return
  fi
  printf '%s' "${input}" | grep -q "\"${key}\"[[:space:]]*:[[:space:]]*true"
}

field_str() {
  local key="$1"
  if [[ "${jq_ok}" -eq 1 ]]; then
    jq -r --arg k "${key}" 'if (.[$k] | type) == "string" then .[$k] else empty end' <<<"${input}"
    return
  fi
  printf '%s' "${input}" | sed -n "s/.*\"${key}\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p" | head -n 1
}

loop_count() {
  local n
  if [[ "${jq_ok}" -eq 1 ]]; then
    n="$(jq -r '.loop_count // 0' <<<"${input}")"
    printf '%s' "${n}"
    return
  fi
  n="$(printf '%s' "${input}" | sed -n 's/.*"loop_count"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' | head -n 1)"
  printf '%s' "${n:-0}"
}

cursor_stop=0
if [[ -z "$(field_str hook_event_name)" && -n "$(field_str status)" ]]; then
  cursor_stop=1
fi

allow_stop() {
  exit 0
}

reason="agent-stop: cargo test falhou nos crates sujos. Corrija antes de parar. (scripts/agent-stop/verify.sh)"

fail_closed() {
  echo "${reason}" >&2
  if [[ "${cursor_stop}" -eq 1 ]]; then
    printf '%s\n' '{"followup_message":"agent-stop: cargo test falhou nos crates sujos. Corrija antes de parar."}'
    exit 0
  fi
  exit 2
}

porcelain_paths() {
  local rec xy path
  local status_out
  status_out="$(mktemp)"
  if ! git -C "${ROOT}" status --porcelain -z -uall -- crates >"${status_out}"; then
    rm -f -- "${status_out}"
    return 2
  fi
  local rc=0
  while IFS= read -r -d '' rec || [[ -n "${rec}" ]]; do
    [[ -z "${rec}" ]] && continue
    xy="${rec:0:2}"
    path="${rec:3}"
    if [[ "${xy}" == R* || "${xy}" == C* ]]; then
      if ! IFS= read -r -d '' path; then
        rc=2
        break
      fi
    fi
    printf '%s\n' "${path}"
  done <"${status_out}"
  rm -f -- "${status_out}"
  return "${rc}"
}

if field_true stop_hook_active; then
  allow_stop
fi

status="$(field_str status)"
if [[ "${status}" == aborted || "${status}" == error ]]; then
  allow_stop
fi

if [[ "${cursor_stop}" -eq 1 ]]; then
  if (("$(loop_count)" >= 5)); then
    allow_stop
  fi
fi

dirty=0
if [[ -n "${NYCODE_AGENT_STOP_FORCE_DIRTY:-}" ]]; then
  dirty=1
elif [[ -n "${NYCODE_AGENT_STOP_FORCE_CLEAN:-}" ]]; then
  dirty=0
else
  paths_tmp="$(mktemp)"
  if ! porcelain_paths >"${paths_tmp}"; then
    rm -f -- "${paths_tmp}"
    reason="agent-stop: git status falhou; nao da para afirmar que a arvore esta limpa."
    fail_closed
  fi
  while IFS= read -r path || [[ -n "${path}" ]]; do
    [[ -z "${path}" ]] && continue
    if [[ "${path}" == crates/* && "${path}" == *.rs ]]; then
      dirty=1
      break
    fi
  done <"${paths_tmp}"
  rm -f -- "${paths_tmp}"
fi

if [[ "${dirty}" -eq 0 ]]; then
  allow_stop
fi

verify_cmd="${NYCODE_AGENT_STOP_VERIFY_CMD:-}"
if [[ -n "${verify_cmd}" ]]; then
  if ! (cd "${ROOT}" && bash -c "${verify_cmd}"); then
    fail_closed
  fi
  exit 0
fi

packages=()
declare -A seen=()
paths_tmp="$(mktemp)"
if ! porcelain_paths >"${paths_tmp}"; then
  rm -f -- "${paths_tmp}"
  reason="agent-stop: git status falhou; nao da para listar crates sujos."
  fail_closed
fi
while IFS= read -r path || [[ -n "${path}" ]]; do
  [[ -z "${path}" ]] && continue
  case "${path}" in
  crates/*)
    crate="${path#crates/}"
    crate="${crate%%/*}"
    if [[ -n "${crate}" && -z "${seen[${crate}]+x}" ]]; then
      seen["${crate}"]=1
      packages+=("${crate}")
    fi
    ;;
  esac
done <"${paths_tmp}"
rm -f -- "${paths_tmp}"

args=(test --manifest-path "${ROOT}/Cargo.toml" --all-features)
if [[ ${#packages[@]} -gt 0 ]]; then
  for p in "${packages[@]}"; do
    args+=(-p "${p}")
  done
else
  args+=(--workspace)
fi

if ! (cd "${ROOT}" && cargo "${args[@]}" >&2); then
  fail_closed
fi
exit 0

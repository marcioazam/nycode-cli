#!/usr/bin/env bash
# Bateria do hook de Stop do agente.
#
# O script de producao falha fechado (exit 2) no Claude/Codex e, no Cursor,
# devolve followup_message com exit 0 — o loop do Cursor ja encerrou.
# Uso: scripts/agent-stop/gate-test.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly ROOT
readonly VERIFY="${ROOT}/scripts/agent-stop/verify.sh"

passed=0
failed=0

run() {
  local json="$1"
  shift
  printf '%s\n' "${json}" | env "$@" bash "${VERIFY}"
}

check() {
  local want="$1" desc="$2" json="$3"
  shift 3
  local output status=0
  output="$(run "${json}" "$@" 2>&1)" || status=$?
  if [[ "${status}" -ne "${want}" ]]; then
    printf 'FALHOU  %s\n        esperava exit %s, veio %s:\n%s\n' \
      "${desc}" "${want}" "${status}" "${output}"
    failed=$((failed + 1))
    return
  fi
  printf 'ok      %s\n' "${desc}"
  passed=$((passed + 1))
}

check_stdout() {
  local want="$1" needle="$2" desc="$3" json="$4"
  shift 4
  local stdout status=0
  stdout="$(run "${json}" "$@" 2>/dev/null)" || status=$?
  if [[ "${status}" -ne "${want}" ]]; then
    printf 'FALHOU  %s\n        esperava exit %s, veio %s\n' \
      "${desc}" "${want}" "${status}"
    failed=$((failed + 1))
    return
  fi
  if [[ -n "${needle}" && "${stdout}" != *"${needle}"* ]]; then
    printf 'FALHOU  %s\n        stdout nao contem "%s":\n%s\n' \
      "${desc}" "${needle}" "${stdout}"
    failed=$((failed + 1))
    return
  fi
  if [[ -z "${needle}" && -n "${stdout}" ]]; then
    printf 'FALHOU  %s\n        stdout tinha de ser vazio:\n%s\n' \
      "${desc}" "${stdout}"
    failed=$((failed + 1))
    return
  fi
  printf 'ok      %s\n' "${desc}"
  passed=$((passed + 1))
}

check 0 "stop_hook_active ignora a verificacao" \
  '{"hook_event_name":"Stop","stop_hook_active":true}' \
  NYCODE_AGENT_STOP_FORCE_DIRTY=1 NYCODE_AGENT_STOP_VERIFY_CMD=false

check 0 "arvore limpa nao roda teste" \
  '{"hook_event_name":"Stop","stop_hook_active":false}' \
  NYCODE_AGENT_STOP_FORCE_CLEAN=1 NYCODE_AGENT_STOP_VERIFY_CMD=false

check 0 "verificacao verde deixa parar" \
  '{"hook_event_name":"Stop","stop_hook_active":false}' \
  NYCODE_AGENT_STOP_FORCE_DIRTY=1 NYCODE_AGENT_STOP_VERIFY_CMD=true

check 2 "verificacao vermelha no Stop e exit 2" \
  '{"hook_event_name":"Stop","stop_hook_active":false}' \
  NYCODE_AGENT_STOP_FORCE_DIRTY=1 NYCODE_AGENT_STOP_VERIFY_CMD=false

check_stdout 0 "followup_message" "Cursor recebe followup quando o teste falha" \
  '{"status":"completed","loop_count":0}' \
  NYCODE_AGENT_STOP_FORCE_DIRTY=1 NYCODE_AGENT_STOP_VERIFY_CMD=false

check_stdout 0 "" "Cursor no teto de loop para de verdade" \
  '{"status":"completed","loop_count":5}' \
  NYCODE_AGENT_STOP_FORCE_DIRTY=1 NYCODE_AGENT_STOP_VERIFY_CMD=false

check 0 "Cursor aborted nao reabre o turno" \
  '{"status":"aborted","loop_count":0}' \
  NYCODE_AGENT_STOP_FORCE_DIRTY=1 NYCODE_AGENT_STOP_VERIFY_CMD=false

check_stdout 0 "" "sucesso nao escreve stdout (contrato Codex)" \
  '{"hook_event_name":"Stop","stop_hook_active":false}' \
  NYCODE_AGENT_STOP_FORCE_DIRTY=1 NYCODE_AGENT_STOP_VERIFY_CMD=true

if ((failed > 0)); then
  echo "agent-stop-gate-test: ${failed} falhou, ${passed} passou." >&2
  exit 1
fi
echo "agent-stop-gate-test: ${passed} passou."

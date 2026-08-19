#!/usr/bin/env bash
# Bateria do gate do harness de agente (orcamento AGENTS.md, import do
# CLAUDE.md, caminho citado inexistente).
#
# Uso: scripts/agent-harness/gate-test.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly ROOT
readonly GATE="${ROOT}/scripts/agent-harness/gate.sh"

WORK="$(mktemp -d)"
readonly WORK
cleanup() {
  python3 -c 'import shutil, sys; shutil.rmtree(sys.argv[1], ignore_errors=True)' "${WORK}"
}
trap cleanup EXIT

passed=0
failed=0

tree() {
  local box="${WORK}/$1"
  mkdir -p "${box}"
  printf '%s' "${box}"
}

check() {
  local want="$1" desc="$2" box="$3" needle="${4:-}"
  local output status=0
  output="$(bash "${GATE}" "${box}" 2>&1)" || status=$?
  if [[ "${status}" -ne "${want}" ]]; then
    printf 'FALHOU  %s\n        esperava exit %s, veio %s:\n%s\n' \
      "${desc}" "${want}" "${status}" "${output}"
    failed=$((failed + 1))
    return
  fi
  if [[ -n "${needle}" && "${output}" != *"${needle}"* ]]; then
    printf 'FALHOU  %s\n        exit %s correto, mas a saida nao diz "%s":\n%s\n' \
      "${desc}" "${status}" "${needle}" "${output}"
    failed=$((failed + 1))
    return
  fi
  printf 'ok      %s\n' "${desc}"
  passed=$((passed + 1))
}

check 2 "raiz inexistente e erro de uso" "${WORK}/nao-existe" "raiz nao encontrada"

box="$(tree vigente)"
cat >"${box}/AGENTS.md" <<'EOF'
# AGENTS.md
[`scripts/ci-local.sh`](scripts/ci-local.sh)
EOF
mkdir -p "${box}/scripts"
printf 'echo ok\n' >"${box}/scripts/ci-local.sh"
cat >"${box}/CLAUDE.md" <<'EOF'
@AGENTS.md
EOF
check 0 "contrato curto com import e caminho existente passa" "${box}"

box="$(tree bytes)"
python3 -c 'import pathlib,sys; pathlib.Path(sys.argv[1]).write_text("x"*30000+"\n")' \
  "${box}/AGENTS.md"
printf '@AGENTS.md\n' >"${box}/CLAUDE.md"
check 1 "AGENTS.md acima do orcamento de bytes reprova" "${box}" "bytes"

box="$(tree linhas)"
python3 -c 'import pathlib,sys; pathlib.Path(sys.argv[1]).write_text("\n".join("l%d"%i for i in range(220))+"\n")' \
  "${box}/AGENTS.md"
printf '@AGENTS.md\n' >"${box}/CLAUDE.md"
check 1 "AGENTS.md acima do teto de linhas reprova" "${box}" "linhas"

box="$(tree sem-import)"
printf '# AGENTS.md\n' >"${box}/AGENTS.md"
printf '# CLAUDE.md sem import\n' >"${box}/CLAUDE.md"
check 1 "CLAUDE.md sem @AGENTS.md reprova" "${box}" "@AGENTS.md"

box="$(tree caminho-morto)"
cat >"${box}/AGENTS.md" <<'EOF'
# AGENTS.md
ver [hook](.nycode/hooks/veto.sh)
EOF
printf '@AGENTS.md\n' >"${box}/CLAUDE.md"
check 1 "caminho citado inexistente reprova" "${box}" ".nycode/hooks/veto.sh"

if ((failed > 0)); then
  echo "agent-harness-gate-test: ${failed} falhou, ${passed} passou." >&2
  exit 1
fi
echo "agent-harness-gate-test: ${passed} passou."

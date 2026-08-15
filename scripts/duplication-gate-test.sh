#!/usr/bin/env bash
# Bateria do gate de duplicacao de codigo (GATE-08 do padrao externo
# SOTA-2026).
#
# Diferente de complexity-gate-test.sh, nao ha logica de decisao propria pra
# isolar: `jscpd` ja faz threshold + exit code sozinho, entao os casos aqui
# rodam o script real de ponta a ponta contra arvores sinteticas minusculas
# com duplicacao conhecida -- mesma disciplina de layout-gate-test.sh/
# file-length-gate-test.sh. Pulado com aviso se `jscpd` nao estiver
# instalado.
#
# Uso: scripts/duplication-gate-test.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly ROOT
readonly GATE="${ROOT}/scripts/duplication-gate.sh"

WORK="$(mktemp -d)"
readonly WORK
trap 'rm -rf "${WORK}"' EXIT

passed=0
failed=0

ok() {
  printf 'ok      %s\n' "$1"
  passed=$((passed + 1))
}
falhou() {
  printf 'FALHOU  %s\n        %s\n' "$1" "$2"
  failed=$((failed + 1))
}

tree() { # tree <nome> -> caminho da raiz sintetica, com crates/x/src/
  local box="${WORK}/$1"
  mkdir -p "${box}/crates/x/src"
  printf '%s' "${box}"
}

check_status() {
  local want="$1" desc="$2"
  shift 2
  local output status=0
  output="$(bash "${GATE}" "$@" 2>&1)" || status=$?
  if [[ "${status}" -ne "${want}" ]]; then
    falhou "${desc}" "esperava exit ${want}, veio ${status}: ${output}"
    return
  fi
  ok "${desc}"
}

check_status 2 "raiz inexistente e erro de uso" "${WORK}/nao/existe"

if ! command -v jscpd >/dev/null 2>&1; then
  echo "aviso: jscpd nao instalado -- pulando os casos de fiacao real"
  echo ""
  if [[ "${failed}" -gt 0 ]]; then
    echo "duplication-gate-test: ${passed} passaram, ${failed} falharam." >&2
    exit 1
  fi
  echo "duplication-gate-test: ${passed} casos, todos passaram (parcial, sem jscpd)."
  exit 0
fi

# --- Sem duplicacao: passa mesmo com teto apertado -------------------------------

box="$(tree sem_duplicacao)"
cat >"${box}/crates/x/src/a.rs" <<'EOF'
pub fn soma(a: i32, b: i32) -> i32 {
    a + b
}
EOF
cat >"${box}/crates/x/src/b.rs" <<'EOF'
pub fn subtrai(a: i32, b: i32) -> i32 {
    a - b
}
EOF
check_status 0 "arvore sem duplicacao passa com teto de 5%" "${box}" 5

# --- Duplicacao obvia: reprova com teto apertado ----------------------------------

box="$(tree com_duplicacao)"
bloco='pub fn passo_um(estado: &mut Vec<i32>) {
    let mut total = 0;
    for item in estado.iter() {
        total += item;
        if total > 100 {
            total -= 50;
        }
    }
    estado.push(total);
}'
{
  echo "${bloco}"
} >"${box}/crates/x/src/a.rs"
{
  echo "${bloco}"
} >"${box}/crates/x/src/b.rs"
check_status 1 "arvore com bloco identico repetido reprova com teto de 1%" "${box}" 1

# --- O mesmo bloco, mas com teto alto o bastante para caber -----------------------

check_status 0 "o mesmo bloco duplicado passa quando o teto e' alto o bastante" "${box}" 99

echo ""
if [[ "${failed}" -gt 0 ]]; then
  echo "duplication-gate-test: ${passed} passaram, ${failed} falharam." >&2
  exit 1
fi
echo "duplication-gate-test: ${passed} casos, todos passaram."

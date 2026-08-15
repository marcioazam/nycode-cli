#!/usr/bin/env bash
# Bateria do gate de cobertura de diff (GATE-01 do padrao externo SOTA-2026).
#
# Duas funcoes puras testadas sem cargo nem rede:
#
#   - added_lines: extrai (arquivo, linha) de todo `+` de um git diff
#     --unified=0 -- puro parsing de texto, sem instrumentacao nenhuma.
#   - diff_coverage_from_lcov: cruza essas linhas contra registros DA: de um
#     LCOV sintetico -- puro, sem cargo llvm-cov de verdade.
#
# O fluxo completo (gerar LCOV real com `cargo llvm-cov report`) nao e
# exercitado aqui -- e caro e so faz sentido depois de uma medicao real, que
# o job `coverage` do CI ja faz. O que estas funcoes provam e a logica de
# decisao, que e o que pode ter bug.
#
# Uso: scripts/diff-coverage-gate-test.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly ROOT
readonly GATE="${ROOT}/scripts/diff-coverage-gate.sh"

WORK="$(mktemp -d)"
readonly WORK
trap 'rm -rf "${WORK}"' EXIT

passed=0
failed=0

git_() { git -c user.email=test@test -c user.name=test -c commit.gpgsign=false "$@"; }

ok() {
  printf 'ok      %s\n' "$1"
  passed=$((passed + 1))
}
falhou() {
  printf 'FALHOU  %s\n        %s\n' "$1" "$2"
  failed=$((failed + 1))
}

# shellcheck source=/dev/null
source "${GATE}" --source-only

# ============================================================================
# Parte 1: added_lines (parsing puro de diff, sem cargo)
# ============================================================================

repo() {
  local box="${WORK}/$1"
  mkdir -p "${box}/crates/x/src"
  (
    cd "${box}"
    git_ init --quiet --initial-branch=main
    printf 'linha 1\nlinha 2\nlinha 3\n' >crates/x/src/lib.rs
    git_ add .
    git_ commit --quiet -m base
    git_ checkout --quiet -b feature
  )
  printf '%s' "${box}"
}

box="$(repo linhas_adicionadas)"
(
  cd "${box}"
  printf 'linha 1\nlinha 2\nlinha nova a\nlinha nova b\nlinha 3\n' >crates/x/src/lib.rs
  git_ add crates/x/src/lib.rs
  git_ commit --quiet -m "adiciona duas linhas"
)
saida="$(cd "${box}" && added_lines main feature)"
if [[ "${saida}" == $'crates/x/src/lib.rs\t3\ncrates/x/src/lib.rs\t4' ]]; then
  ok "duas linhas adicionadas viram dois pares arquivo/linha, numeracao do lado novo"
else
  falhou "duas linhas adicionadas viram dois pares arquivo/linha" "veio: [${saida}]"
fi

box="$(repo linha_removida_nao_conta)"
(
  cd "${box}"
  printf 'linha 1\nlinha 3\n' >crates/x/src/lib.rs
  git_ add crates/x/src/lib.rs
  git_ commit --quiet -m "remove linha 2"
)
saida="$(cd "${box}" && added_lines main feature)"
if [[ -z "${saida}" ]]; then
  ok "remocao pura nao produz nenhuma linha adicionada"
else
  falhou "remocao pura nao produz nenhuma linha adicionada" "veio: [${saida}]"
fi

box="$(repo arquivo_novo_conta_do_inicio)"
(
  cd "${box}"
  printf 'a\nb\n' >crates/x/src/novo.rs
  git_ add crates/x/src/novo.rs
  git_ commit --quiet -m "arquivo novo"
)
saida="$(cd "${box}" && added_lines main feature)"
if [[ "${saida}" == $'crates/x/src/novo.rs\t1\ncrates/x/src/novo.rs\t2' ]]; then
  ok "arquivo novo inteiro conta como adicionado desde a linha 1"
else
  falhou "arquivo novo inteiro conta como adicionado" "veio: [${saida}]"
fi

box="$(repo arquivo_de_teste_nao_conta)"
(
  cd "${box}"
  printf 'a\nb\n' >crates/x/src/lib_test.rs
  git_ add crates/x/src/lib_test.rs
  git_ commit --quiet -m "arquivo de teste novo"
)
saida="$(cd "${box}" && added_lines main feature)"
if [[ -z "${saida}" ]]; then
  ok "arquivo de teste (lib_test.rs) nao entra em added_lines, mesmo com linhas novas"
else
  falhou "arquivo de teste nao entra em added_lines" "veio: [${saida}]"
fi

# ============================================================================
# Parte 2: diff_coverage_from_lcov (cruzamento puro, sem cargo)
# ============================================================================

lcov_sintetico() {
  cat <<'EOF'
SF:crates/x/src/lib.rs
DA:3,5
DA:4,0
DA:5,1
end_of_record
SF:crates/x/src/lib_test.rs
DA:1,1
DA:2,1
end_of_record
EOF
}

lcov_file="${WORK}/sintetico.lcov"
lcov_sintetico >"${lcov_file}"

added="crates/x/src/lib.rs	3
crates/x/src/lib.rs	4"
read -r cov tot < <(diff_coverage_from_lcov "${lcov_file}" "${added}")
if [[ "${cov}" == "1" && "${tot}" == "2" ]]; then
  ok "cruza DA: contra linhas adicionadas: 1 de 2 cobertas"
else
  falhou "cruza DA: contra linhas adicionadas" "veio cov=${cov} tot=${tot}"
fi

added_sem_instrumentacao="crates/x/src/lib.rs	3
crates/x/src/lib.rs	99"
read -r cov tot < <(diff_coverage_from_lcov "${lcov_file}" "${added_sem_instrumentacao}")
if [[ "${cov}" == "1" && "${tot}" == "1" ]]; then
  ok "linha adicionada sem DA: (nao instrumentada) fica fora do denominador"
else
  falhou "linha sem DA: fica fora do denominador" "veio cov=${cov} tot=${tot}"
fi

# diff_coverage_from_lcov confia que quem chamou ja filtrou (e' added_lines
# que exclui arquivo de teste, testado na Parte 1) -- aqui so confirma que a
# funcao cruza o que recebe, sem filtro proprio por cima.
added_arquivo_de_teste="crates/x/src/lib_test.rs	1"
read -r cov tot < <(diff_coverage_from_lcov "${lcov_file}" "${added_arquivo_de_teste}")
if [[ "${cov}" == "1" && "${tot}" == "1" ]]; then
  ok "diff_coverage_from_lcov cruza o que recebe, sem filtrar por conta propria"
else
  falhou "diff_coverage_from_lcov cruza o que recebe" "veio cov=${cov} tot=${tot}"
fi

# ============================================================================
# Parte 3: gate completo (usa fixtures, nao cargo real)
# ============================================================================

check_status() { # check_status <exit esperado> <descricao> <raiz> <lcov> <base> <head> [<trecho>]
  local want="$1" desc="$2" box="$3" lcov="$4" base="$5" head="$6" needle="${7:-}"
  local output status=0
  output="$(cd "${box}" && bash "${GATE}" "${lcov}" "${base}" "${head}" 2>&1)" || status=$?
  if [[ "${status}" -ne "${want}" ]]; then
    falhou "${desc}" "esperava exit ${want}, veio ${status}: ${output}"
    return
  fi
  if [[ -n "${needle}" && "${output}" != *"${needle}"* ]]; then
    falhou "${desc}" "exit ${status} correto, mas a saida nao diz \"${needle}\": ${output}"
    return
  fi
  ok "${desc}"
}

box="$(repo gate_acima_do_piso)"
(
  cd "${box}"
  printf 'linha 1\nlinha 2\nnova a\nnova b\nnova c\nnova d\nnova e\nlinha 3\n' >crates/x/src/lib.rs
  git_ add crates/x/src/lib.rs
  git_ commit --quiet -m "cinco linhas novas, quatro cobertas"
)
cat >"${box}/lcov.info" <<'EOF'
SF:crates/x/src/lib.rs
DA:3,1
DA:4,1
DA:5,1
DA:6,1
DA:7,0
end_of_record
EOF
check_status 0 "80% de cobertura de diff passa o piso de 80%" "${box}" lcov.info main feature

box="$(repo gate_abaixo_do_piso)"
(
  cd "${box}"
  printf 'linha 1\nlinha 2\nnova a\nnova b\nlinha 3\n' >crates/x/src/lib.rs
  git_ add crates/x/src/lib.rs
  git_ commit --quiet -m "duas linhas novas, nenhuma coberta"
)
cat >"${box}/lcov.info" <<'EOF'
SF:crates/x/src/lib.rs
DA:3,0
DA:4,0
end_of_record
EOF
check_status 1 "0% de cobertura de diff reprova o piso de 80%" "${box}" lcov.info main feature "abaixo do piso"

box="$(repo sem_mudanca_rust_passa)"
(
  cd "${box}"
  printf 'nao e rust\n' >README.md
  git_ add README.md
  git_ commit --quiet -m "so documentacao"
)
printf '' >"${box}/lcov.info"
check_status 0 "PR sem mudanca em .rs passa sem medir nada" "${box}" lcov.info main feature

# --- Erro de uso ----------------------------------------------------------------

box="$(repo lcov_ausente)"
check_status 2 "lcov ausente e erro de uso" "${box}" "nao-existe.info" main feature "nao encontrado"

# --- Resultado ------------------------------------------------------------------

echo ""
if [[ "${failed}" -gt 0 ]]; then
  echo "diff-coverage-gate-test: ${passed} passaram, ${failed} falharam." >&2
  exit 1
fi
echo "diff-coverage-gate-test: ${passed} casos, todos passaram."

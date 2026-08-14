#!/usr/bin/env bash
# Bateria do gate de tamanho de PR assistido por IA.
#
# Cada caso monta um repositorio git sintetico com sua propria sequencia de
# commits, roda o gate de producao sobre ele e exige o codigo de saida. 0
# aprova (ou o teto nao se aplica), 1 e violacao de teto, 2 e erro de uso.
#
# Uso: scripts/agent-pr-size-gate-test.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly ROOT
readonly GATE="${ROOT}/scripts/agent-pr-size-gate.sh"

WORK="$(mktemp -d)"
readonly WORK
trap 'rm -rf "${WORK}"' EXIT

passed=0
failed=0

git_() { git -c user.email=test@test -c user.name=test -c commit.gpgsign=false "$@"; }

# repo <nome> -> caminho do repositorio sintetico, ja com um commit base na
# branch "main" e uma branch "feature" apontando para o mesmo commit.
repo() {
  local box="${WORK}/$1"
  mkdir -p "${box}"
  (
    cd "${box}"
    git_ init --quiet --initial-branch=main
    printf 'base\n' >base.txt
    git_ add base.txt
    git_ commit --quiet -m "commit base"
    git_ checkout --quiet -b feature
  )
  printf '%s' "${box}"
}

# commit <repo> <arquivo> <linhas> <rodape|-->
# Escreve <linhas> linhas em <arquivo> (sobrescrevendo) e commita. Rodape
# "Assisted-by: agente:modelo" quando <rodape> != "--".
commit() {
  local box="$1" arquivo="$2" linhas="$3" rodape="$4" i msg
  (
    cd "${box}"
    : >"${arquivo}"
    for ((i = 0; i < linhas; i++)); do printf 'x\n' >>"${arquivo}"; done
    git_ add "${arquivo}"
    msg="muda ${arquivo}"
    if [[ "${rodape}" != "--" ]]; then
      msg="${msg}

Assisted-by: ${rodape}"
    fi
    git_ commit --quiet -m "${msg}"
  )
}

check() { # check <exit esperado> <descricao> <repo> [<base> <head>] [<trecho exigido>]
  local want="$1" desc="$2" box="$3" base="${4:-main}" head="${5:-feature}" needle="${6:-}"
  local output status=0
  output="$(cd "${box}" && bash "${GATE}" "${base}" "${head}" 2>&1)" || status=$?

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

# --- O teto so vale para commit assistido -----------------------------------

box="$(repo sem_rodape_nenhum)"
commit "${box}" grande.txt 900 --
check 0 "sem nenhum Assisted-by, o teto nao se aplica mesmo com diff grande" "${box}" main feature "nao se aplica"

box="$(repo com_rodape_dentro_do_teto)"
commit "${box}" pequeno.txt 100 "Claude Code:claude-sonnet-5"
check 0 "commit assistido dentro do teto passa" "${box}"

# --- Linhas ------------------------------------------------------------------

box="$(repo exatamente_no_teto_de_linhas)"
commit "${box}" f.txt 400 "Claude Code:claude-sonnet-5"
check 0 "400 linhas alteradas passa; o teto e inclusivo" "${box}"

box="$(repo acima_do_teto_de_linhas)"
commit "${box}" f.txt 401 "Claude Code:claude-sonnet-5"
check 1 "401 linhas alteradas reprova" "${box}" main feature "linhas"

# --- Arquivos ------------------------------------------------------------------

box="$(repo quinze_arquivos)"
(
  cd "${box}"
  for i in $(seq 1 15); do printf 'x\n' >"a${i}.txt"; done
  git_ add .
  git_ commit --quiet -m "quinze arquivos

Assisted-by: Claude Code:claude-sonnet-5"
)
check 0 "quinze arquivos passa; o teto e inclusivo" "${box}"

box="$(repo dezesseis_arquivos)"
(
  cd "${box}"
  for i in $(seq 1 16); do printf 'x\n' >"a${i}.txt"; done
  git_ add .
  git_ commit --quiet -m "dezesseis arquivos

Assisted-by: Claude Code:claude-sonnet-5"
)
check 1 "dezesseis arquivos reprova" "${box}" main feature "arquivos"

# --- Deteccao do rodape em qualquer commit do intervalo -----------------------

box="$(repo so_um_commit_assistido_entre_varios)"
commit "${box}" a.txt 10 --
commit "${box}" b.txt 10 "Claude Code:claude-sonnet-5"
commit "${box}" c.txt 10 --
check 0 "um so commit assistido no intervalo ja aplica o teto (e passa, pois esta dentro dele)" "${box}"

# --- Cargo.lock nao conta ------------------------------------------------------

box="$(repo cargo_lock_excluido)"
commit "${box}" Cargo.lock 900 "Claude Code:claude-sonnet-5"
check 0 "Cargo.lock nao entra na contagem de linhas nem de arquivos" "${box}"

box="$(repo test_map_excluido)"
commit "${box}" test_map 900 "Claude Code:claude-sonnet-5"
check 0 "test_map nao entra na contagem, por ser gerado (GATE-11)" "${box}"

# --- Erro de uso ----------------------------------------------------------------

box="$(repo ref_base_invalida)"
commit "${box}" a.txt 1 --
check 2 "ref base inexistente e erro de uso" "${box}" "nao-existe" feature "nao encontrada"

box="$(repo ref_head_invalida)"
commit "${box}" a.txt 1 --
check 2 "ref head inexistente e erro de uso" "${box}" main "nao-existe" "nao encontrada"

# --- Resultado ------------------------------------------------------------------

echo ""
if [[ "${failed}" -gt 0 ]]; then
  echo "agent-pr-size-gate-test: ${passed} passaram, ${failed} falharam." >&2
  exit 1
fi
echo "agent-pr-size-gate-test: ${passed} casos, todos passaram."

#!/usr/bin/env bash
# Bateria do gate de layout.
#
# O gate decide onde um arquivo pode nascer, e um gate que nao pode falhar
# compra confianca sem entregar evidencia. Cada caso monta uma arvore sintetica,
# roda o gate de verdade sobre ela e exige o codigo de saida — 0 aprova, 1 e
# violacao de teto, 2 e erro de uso.
#
# O gate aceita a raiz por argumento, entao aqui nao ha copia do script para
# dentro do sandbox: o que roda e o arquivo de producao, byte a byte.
#
# Uso: scripts/layout-gate-test.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly ROOT
readonly GATE="${ROOT}/scripts/layout-gate.sh"

WORK="$(mktemp -d)"
readonly WORK
trap 'rm -rf "${WORK}"' EXIT

passed=0
failed=0

tree() { # tree <nome> -> caminho da raiz sintetica
  local box="${WORK}/$1"
  mkdir -p "${box}"
  printf '%s' "${box}"
}

files() { # files <dir> <quantidade> <prefixo>
  local dir="$1" quantidade="$2" prefixo="${3:-f}"
  mkdir -p "${dir}"
  for i in $(seq 1 "${quantidade}"); do
    printf 'pub fn produz() -> u8 {\n    7\n}\n' >"${dir}/${prefixo}${i}.rs"
  done
}

check() { # check <exit esperado> <descricao> <raiz> [<trecho exigido na saida>]
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

# --- O teto ---------------------------------------------------------------------

box="$(tree exatamente_no_teto)"
files "${box}/crates/x/src" 7
check 0 "sete arquivos passam; o teto e inclusivo" "${box}"

box="$(tree um_acima)"
files "${box}/crates/x/src" 8
check 1 "oito arquivos reprovam" "${box}" "acima do teto"

box="$(tree nomeia_o_que_reprovou)"
files "${box}/crates/x/src" 8
check 1 "a falha nomeia o diretorio" "${box}" "crates/x/src"

box="$(tree nomeia_os_arquivos)"
files "${box}/crates/x/src" 8
check 1 "a falha lista os arquivos, para a divisao ser decidivel" "${box}" "f8.rs"

box="$(tree avisa_do_nome_vago)"
files "${box}/crates/x/src" 8
check 1 "a falha avisa que nome vago nao resolve" "${box}" "utils"

# --- O que nao conta ------------------------------------------------------------

box="$(tree teste_nao_conta)"
files "${box}/crates/x/src" 7
files "${box}/crates/x/src" 3 "extra_test_"
# Renomeia para o idioma do repositorio: `foo_test.rs`.
for i in 1 2 3; do
  mv "${box}/crates/x/src/extra_test_${i}.rs" "${box}/crates/x/src/coisa${i}_test.rs"
done
check 0 "arquivo de teste nao conta contra o teto" "${box}"

box="$(tree arvore_de_teste_ignorada)"
files "${box}/crates/x/src" 2
files "${box}/crates/x/tests" 20
check 0 "a arvore de tests/ tem outra razao de crescer e nao entra" "${box}"

box="$(tree nao_rust_nao_conta)"
files "${box}/crates/x/src" 7
for i in 1 2 3; do
  printf 'nada\n' >"${box}/crates/x/src/dado${i}.json"
done
check 0 "arquivo que nao e codigo nao conta" "${box}"

box="$(tree subdiretorio_nao_soma)"
files "${box}/crates/x/src" 7
files "${box}/crates/x/src/dentro" 7
check 0 "o teto e por diretorio, nao acumulado pela arvore" "${box}"

# --- Alcance --------------------------------------------------------------------

box="$(tree pega_no_fundo)"
files "${box}/crates/x/src" 2
files "${box}/crates/x/src/a/b/c" 8
check 1 "diretorio fundo tambem e inspecionado" "${box}" "a/b/c"

box="$(tree varios_reprovam_juntos)"
files "${box}/crates/x/src" 8
files "${box}/crates/y/src" 9
check 1 "reprova relatando os dois, e nao so o primeiro" "${box}" "2 diretorio(s)"

# --- Erro de uso ----------------------------------------------------------------

check 2 "raiz inexistente e erro de uso, nao aprovacao" "${WORK}/nao/existe" "nao encontrada"

box="$(tree arvore_vazia)"
mkdir -p "${box}/crates"
check 0 "arvore sem codigo nenhum passa" "${box}"

# --- Resultado ------------------------------------------------------------------

echo ""
if [[ "${failed}" -gt 0 ]]; then
  echo "layout-gate-test: ${passed} passaram, ${failed} falharam." >&2
  exit 1
fi
echo "layout-gate-test: ${passed} casos, todos passaram."

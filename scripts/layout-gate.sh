#!/usr/bin/env bash
# Gate de layout do nycode: teto de arquivos por diretorio.
#
# Um diretorio de codigo comporta no maximo SETE arquivos. Passou disso, divide
# em subpastas por responsabilidade — e por responsabilidade, nao por tipo
# tecnico: uma pasta com todas as structs de um lado e todos os traits do outro
# tem o mesmo problema que tinha antes, so que espalhado.
#
# O numero nao mede beleza. Ele mede quanto de uma vez alguem precisa segurar na
# cabeca para saber onde mexer — e vale igual para quem le o repositorio pela
# primeira vez e para um agente que decide onde por o arquivo seguinte. Um
# diretorio que cresce sem limite vira o lugar onde tudo cabe, que e o mesmo que
# dizer que nada tem lugar.
#
# Arquivo de teste nao conta. `foo_test.rs` ao lado de `foo.rs` e o idioma deste
# repositorio (`#[path = "foo_test.rs"]`), e conta-lo puniria justamente quem
# testa mais — o oposto do que os outros gates daqui pedem.
#
# NAO ha arquivo de exemption, e isso e decisao e nao esquecimento. O gate
# entrou depois de as duas pastas que estouravam terem sido divididas: ele nasce
# limpo, e a primeira excecao seria a que ensina que existe excecao.
#
# Uso:
#   scripts/layout-gate.sh            # varre crates/*/src
#   scripts/layout-gate.sh <raiz>     # varre outra raiz, para o auto-teste

set -euo pipefail

readonly MAX_FILES=7

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly ROOT

TARGET="${1:-${ROOT}/crates}"
if [[ ! -d "${TARGET}" ]]; then
  echo "layout-gate: raiz nao encontrada: ${TARGET}" >&2
  exit 2
fi

failures=0

# --- O que conta como arquivo de codigo ----------------------------------------
# `.rs` diretamente no diretorio, sem descer. Fora: os que so existem para o
# teste, e o que estiver sob `tests/`, que e outra arvore com outra razao de
# crescer.
code_files_in() { # code_files_in <dir> -> um caminho por linha
  local dir="$1"
  find "${dir}" -maxdepth 1 -type f -name '*.rs' \
    ! -name '*_test.rs' \
    ! -name 'test_*.rs' \
    -print | sort
}

# Diretorios a inspecionar: tudo sob a raiz, menos as arvores de teste e o que
# o build gera.
while IFS= read -r dir; do
  case "${dir}" in
  */tests | */tests/* | */target | */target/*) continue ;;
  esac

  mapfile -t files < <(code_files_in "${dir}")
  count="${#files[@]}"
  ((count > MAX_FILES)) || continue

  echo "  FALHA: ${dir#"${ROOT}/"} tem ${count} arquivos de codigo, acima do teto de ${MAX_FILES}" >&2
  for file in "${files[@]}"; do
    echo "         ${file##*/}" >&2
  done
  echo "         divida por responsabilidade em subpastas; nome vago (utils, helpers," >&2
  echo "         common, core, shared) significa que a divisao ainda nao foi encontrada" >&2
  failures=$((failures + 1))
done < <(find "${TARGET}" -type d | sort)

if ((failures > 0)); then
  echo >&2
  echo "layout-gate: ${failures} diretorio(s) acima do teto. Gate fecha." >&2
  exit 1
fi

echo "layout-gate: nenhum diretorio acima de ${MAX_FILES} arquivos de codigo."

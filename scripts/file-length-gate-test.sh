#!/usr/bin/env bash
# Bateria do gate de teto de 500 linhas por arquivo.
#
# Mesma disciplina do layout-gate-test.sh: cada caso monta uma arvore
# sintetica com seu proprio baseline, roda o gate de producao sobre ela e
# exige o codigo de saida. 0 aprova, 1 e violacao (nova ou de ratchet
# quebrado), 2 e erro de uso.
#
# Uso: scripts/file-length-gate-test.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly ROOT
readonly GATE="${ROOT}/scripts/file-length-gate.sh"

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

# rust_file <caminho-completo> <linhas>
rust_file() {
  local path="$1" linhas="$2" i
  mkdir -p "$(dirname "${path}")"
  : >"${path}"
  for ((i = 0; i < linhas; i++)); do
    printf 'x\n' >>"${path}"
  done
}

# baseline <raiz> <linha...> -> caminho do arquivo de baseline
baseline() {
  local box="$1"
  shift
  local file="${box}.baseline.txt"
  printf '%s\n' "$@" >"${file}"
  printf '%s' "${file}"
}

check() { # check <exit esperado> <descricao> <raiz> <baseline> [<trecho exigido>]
  local want="$1" desc="$2" box="$3" bfile="$4" needle="${5:-}"
  local output status=0
  output="$(bash "${GATE}" "${box}" "${bfile}" 2>&1)" || status=$?

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

# --- O teto -----------------------------------------------------------------

box="$(tree exatamente_no_teto)"
rust_file "${box}/crates/x/src/f.rs" 500
bfile="$(baseline "${box}")"
check 0 "500 linhas passa; o teto e inclusivo" "${box}" "${bfile}"

box="$(tree acima_sem_baseline)"
rust_file "${box}/crates/x/src/f.rs" 501
bfile="$(baseline "${box}")"
check 1 "501 linhas sem entrada no baseline reprova" "${box}" "${bfile}" "sem entrada no baseline"

# --- O ratchet ----------------------------------------------------------------

box="$(tree no_baseline_nao_cresceu)"
rust_file "${box}/crates/x/src/legado.rs" 700
bfile="$(baseline "${box}" "crates/x/src/legado.rs 700")"
check 0 "arquivo do baseline, do mesmo tamanho registrado, passa" "${box}" "${bfile}"

box="$(tree no_baseline_encolheu_mas_ainda_acima)"
rust_file "${box}/crates/x/src/legado.rs" 650
bfile="$(baseline "${box}" "crates/x/src/legado.rs 700")"
check 0 "arquivo do baseline que encolheu mas continua acima do teto passa" "${box}" "${bfile}"

box="$(tree no_baseline_cresceu)"
rust_file "${box}/crates/x/src/legado.rs" 705
bfile="$(baseline "${box}" "crates/x/src/legado.rs 700")"
check 1 "arquivo do baseline que cresceu alem do registrado reprova" "${box}" "${bfile}" "acima do baseline"

box="$(tree baseline_desatualizado_arquivo_sumiu)"
mkdir -p "${box}/crates/x/src"
bfile="$(baseline "${box}" "crates/x/src/legado.rs 700")"
check 1 "baseline citando arquivo que sumiu reprova" "${box}" "${bfile}" "sumiu"

box="$(tree baseline_desatualizado_arquivo_encolheu_no_teto)"
rust_file "${box}/crates/x/src/legado.rs" 400
bfile="$(baseline "${box}" "crates/x/src/legado.rs 700")"
check 1 "baseline citando arquivo que ja encolheu para dentro do teto reprova" "${box}" "${bfile}" "sumiu"

# --- Formato do baseline --------------------------------------------------------

box="$(tree baseline_com_comentario_e_linha_vazia)"
rust_file "${box}/crates/x/src/legado.rs" 700
bfile="$(baseline "${box}" "# comentario" "" "crates/x/src/legado.rs 700")"
check 0 "comentario e linha vazia no baseline sao ignorados" "${box}" "${bfile}"

# --- Varios juntos ----------------------------------------------------------

box="$(tree varios_reprovam_juntos)"
rust_file "${box}/crates/x/src/a.rs" 501
rust_file "${box}/crates/y/src/b.rs" 502
bfile="$(baseline "${box}")"
check 1 "reprova relatando os dois, e nao so o primeiro" "${box}" "${bfile}" "2 problema(s)"

# --- Erro de uso ----------------------------------------------------------------

bfile="$(baseline "$(tree raiz_p_baseline_de_uso)")"
check 2 "raiz inexistente e erro de uso, nao aprovacao" "${WORK}/nao/existe" "${bfile}" "nao encontrada"

box="$(tree baseline_inexistente)"
mkdir -p "${box}/crates"
check 2 "baseline inexistente e erro de uso" "${box}" "${WORK}/nao-existe.txt" "nao encontrado"

box="$(tree arvore_vazia)"
mkdir -p "${box}/crates"
bfile="$(baseline "${box}")"
check 0 "arvore sem arquivo .rs nenhum passa" "${box}" "${bfile}"

# --- Resultado ------------------------------------------------------------------

echo ""
if [[ "${failed}" -gt 0 ]]; then
  echo "file-length-gate-test: ${passed} passaram, ${failed} falharam." >&2
  exit 1
fi
echo "file-length-gate-test: ${passed} casos, todos passaram."

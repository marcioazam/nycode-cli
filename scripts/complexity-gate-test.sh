#!/usr/bin/env bash
# Bateria do gate de complexidade cognitiva e ciclomatica por funcao
# (GATE-05/GATE-06 do padrao externo SOTA-2026).
#
# Duas partes: a logica de decisao (ratchet contra JSON sintetico no formato
# do `codemetrics`, sem precisar do binario real) e uma fiacao real (uma
# unica vez, contra um arquivo .rs minusculo) para provar que a invocacao de
# verdade produz o formato que a logica pura assume. A fiacao real e pulada
# com aviso se `codemetrics` nao estiver instalado -- mesma disciplina de
# scripts/mutation-gate-test.sh pro cargo-mutants.
#
# Uso: scripts/complexity-gate-test.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly ROOT
readonly GATE="${ROOT}/scripts/complexity-gate.sh"

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

# shellcheck source=/dev/null
source "${GATE}" --source-only

# metrics_json <arquivo> <linha-de-funcao...> -> escreve JSON no formato do codemetrics
# cada linha-de-funcao: "arquivo funcao cognitiva ciclomatica"
metrics_json() {
  local out="$1"
  shift
  {
    echo '['
    local first=1
    for row in "$@"; do
      read -r file func cog cyc <<<"${row}"
      [[ "${first}" -eq 1 ]] || echo ','
      first=0
      printf '{"file":"%s","function":"%s","cognitive":%s,"cyclomatic":%s,"start_line":1,"end_line":2}' \
        "${file}" "${func}" "${cog}" "${cyc}"
    done
    echo ''
    echo ']'
  } >"${out}"
  printf '%s' "${out}"
}

# baseline <linha...> -> caminho do arquivo de baseline
baseline() {
  local file="${WORK}/baseline_$$_${RANDOM}.txt"
  printf '%s\n' "$@" >"${file}"
  printf '%s' "${file}"
}

# check_count <contagem-esperada> <contagem-obtida> <descricao>
check_count() {
  local want="$1" got="$2" desc="$3"
  if [[ "${got}" -eq "${want}" ]]; then
    ok "${desc}"
  else
    falhou "${desc}" "esperava ${want} problema(s), veio ${got}"
  fi
}

# ============================================================================
# Parte 1: logica de decisao (pura, sem o binario codemetrics)
# ============================================================================

declare -gA baseline_cognitive baseline_cyclomatic

# shellcheck disable=SC2034 # lidas por evaluate(), definida no arquivo sourced
reset_baseline() {
  baseline_cognitive=()
  baseline_cyclomatic=()
}

reset_baseline
json="$(metrics_json "${WORK}/1.json" "crates/x/src/a.rs simples 5 4")"
n="$(evaluate "${json}")"
check_count 0 "${n}" "funcao dentro dos dois tetos, sem baseline, passa"

reset_baseline
json="$(metrics_json "${WORK}/2.json" "crates/x/src/a.rs complexa 16 4")"
n="$(evaluate "${json}")"
check_count 1 "${n}" "cognitiva acima do teto, sem baseline, reprova"

reset_baseline
json="$(metrics_json "${WORK}/3.json" "crates/x/src/a.rs complexa 4 16")"
n="$(evaluate "${json}")"
check_count 1 "${n}" "ciclomatica acima do teto, sem baseline, reprova"

reset_baseline
read_baseline "$(baseline "crates/x/src/legado.rs velha 20 10")"
json="$(metrics_json "${WORK}/4.json" "crates/x/src/legado.rs velha 20 10")"
n="$(evaluate "${json}")"
check_count 0 "${n}" "funcao do baseline, no mesmo valor registrado, passa"

reset_baseline
read_baseline "$(baseline "crates/x/src/legado.rs velha 20 10")"
json="$(metrics_json "${WORK}/5.json" "crates/x/src/legado.rs velha 18 10")"
n="$(evaluate "${json}")"
check_count 0 "${n}" "funcao do baseline que encolheu mas continua acima do teto passa"

reset_baseline
read_baseline "$(baseline "crates/x/src/legado.rs velha 20 10")"
json="$(metrics_json "${WORK}/6.json" "crates/x/src/legado.rs velha 21 10")"
n="$(evaluate "${json}")"
check_count 1 "${n}" "funcao do baseline que cresceu na cognitiva reprova"

reset_baseline
read_baseline "$(baseline "crates/x/src/legado.rs velha 20 10")"
json="$(metrics_json "${WORK}/7.json" "crates/x/src/legado.rs velha 20 11")"
n="$(evaluate "${json}")"
check_count 1 "${n}" "funcao do baseline que cresceu na ciclomatica reprova"

reset_baseline
read_baseline "$(baseline "crates/x/src/legado.rs velha 20 10")"
json="$(metrics_json "${WORK}/8.json" "crates/x/src/legado.rs velha 10 8")"
n="$(evaluate "${json}")"
check_count 1 "${n}" "funcao do baseline que caiu para dentro dos dois tetos reprova (entrada obsoleta)"

reset_baseline
read_baseline "$(baseline "crates/x/src/sumiu.rs fantasma 20 10")"
json="$(metrics_json "${WORK}/9.json" "crates/x/src/a.rs outra 5 4")"
n="$(evaluate "${json}")"
check_count 1 "${n}" "baseline citando funcao que sumiu reprova"

reset_baseline
read_baseline "$(baseline "# comentario" "" "crates/x/src/legado.rs velha 20 10")"
json="$(metrics_json "${WORK}/10.json" "crates/x/src/legado.rs velha 20 10")"
n="$(evaluate "${json}")"
check_count 0 "${n}" "comentario e linha vazia no baseline sao ignorados"

reset_baseline
json="$(metrics_json "${WORK}/11.json" "crates/x/src/a.rs uma 16 4" "crates/y/src/b.rs duas 4 16")"
n="$(evaluate "${json}")"
check_count 2 "${n}" "reprova relatando as duas, e nao so a primeira"

# --- Erro de uso, via o script real (nao a funcao pura) --------------------------

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

check_status 2 "raiz inexistente e erro de uso" "${WORK}/nao/existe" "${WORK}/qualquer.txt"

box="${WORK}/raiz_sem_baseline"
mkdir -p "${box}/crates"
check_status 2 "baseline inexistente e erro de uso" "${box}" "${WORK}/nao-existe.txt"

# ============================================================================
# Parte 2: fiacao real, contra um arquivo .rs minusculo (uma vez so)
# ============================================================================

if command -v codemetrics >/dev/null 2>&1; then
  crate_box="${WORK}/crate_real"
  mkdir -p "${crate_box}/crates/x/src"
  cat >"${crate_box}/crates/x/src/lib.rs" <<'EOF'
pub fn trivial() -> i32 {
    1
}
EOF
  bfile="$(baseline)"
  out="$(bash "${GATE}" "${crate_box}" "${bfile}" 2>&1)" && status=0 || status=$?
  if [[ "${status}" -eq 0 && "${out}" == *"nenhuma funcao"* ]]; then
    ok "fiacao real: codemetrics roda de ponta a ponta contra um arquivo de verdade"
  else
    falhou "fiacao real: codemetrics roda de ponta a ponta" "exit ${status}: ${out}"
  fi
else
  echo "aviso: codemetrics nao instalado -- pulando o teste de fiacao real (parte 1 ja cobre a logica pura)"
fi

# --- Resultado ------------------------------------------------------------------

echo ""
if [[ "${failed}" -gt 0 ]]; then
  echo "complexity-gate-test: ${passed} passaram, ${failed} falharam." >&2
  exit 1
fi
echo "complexity-gate-test: ${passed} casos, todos passaram."

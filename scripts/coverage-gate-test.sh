#!/usr/bin/env bash
# Bateria do gate de cobertura.
#
# O gate e a peca que sustenta NFR-5, e um gate que nao pode falhar compra
# confianca sem entregar evidencia. Cada caso aqui monta um repositorio
# sintetico, roda o gate de verdade sobre ele e exige o codigo de saida — 0
# aprova, 1 e violacao de piso, 2 e erro de uso.
#
# A raiz que o gate examina e o diretorio pai do proprio script. O teste explora
# isso e copia o gate para dentro do sandbox, em vez de abrir na producao uma
# costura que so o teste usaria: o que roda aqui e o mesmo arquivo, byte a byte.
#
# Uso: scripts/coverage-gate-test.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly ROOT
readonly GATE="${ROOT}/scripts/coverage-gate.sh"

if ! command -v jq >/dev/null 2>&1; then
  echo "coverage-gate-test: jq e obrigatorio" >&2
  exit 2
fi

WORK="$(mktemp -d)"
readonly WORK
trap 'rm -rf "${WORK}"' EXIT

passed=0
failed=0

# --- Montagem do repositorio sintetico -----------------------------------------

# Todo fonte nasce com a mesma data no passado, para que o frescor seja decidido
# pela ordem em que o teste escreve e nao pela resolucao do relogio do sistema
# de arquivos. O caso que exercita relatorio velho remarca o fonte de proposito.
readonly SOURCE_MTIME=200101010000

sandbox() { # sandbox <nome> -> caminho da raiz sintetica
  local box="${WORK}/$1"
  mkdir -p "${box}/scripts"
  cp "${GATE}" "${box}/scripts/coverage-gate.sh"
  : >"${box}/scripts/coverage-exemptions.txt"
  printf '%s' "${box}"
}

source_file() { # source_file <box> <caminho relativo>
  local box="$1" rel="$2"
  mkdir -p "${box}/$(dirname "${rel}")"
  printf 'pub fn produz() -> u8 {\n    7\n}\n' >"${box}/${rel}"
  touch -t "${SOURCE_MTIME}" "${box}/${rel}"
}

exemption() { # exemption <box> <linha da tabela>
  printf '%s\n' "$2" >>"$1/scripts/coverage-exemptions.txt"
}

report() { # report <box> [<caminho relativo> <linhas cobertas> <linhas totais>]...
  local box="$1"
  shift
  local entries="${WORK}/entries.jsonl"
  : >"${entries}"
  while [[ $# -gt 0 ]]; do
    local rel="$1" covered="$2" total="$3"
    shift 3
    local percent
    percent="$(awk -v c="${covered}" -v n="${total}" \
      'BEGIN { if (n > 0) printf "%.4f", (c / n) * 100; else printf "0" }')"
    jq -nc \
      --arg f "${box}/${rel}" \
      --argjson c "${covered}" \
      --argjson n "${total}" \
      --argjson p "${percent}" \
      '{filename: $f, summary: {lines: {covered: $c, count: $n, percent: $p}}}' >>"${entries}"
  done
  jq -s '{data: [{files: .}]}' "${entries}" >"${box}/coverage.json"
}

check() { # check <exit esperado> <descricao> <box> [<trecho exigido na saida>]
  local want="$1" desc="$2" box="$3" needle="${4:-}"
  local output status=0
  output="$(bash "${box}/scripts/coverage-gate.sh" "${box}/coverage.json" 2>&1)" || status=$?

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

# --- Os dois pisos --------------------------------------------------------------

box="$(sandbox floors_met)"
source_file "${box}" crates/x/src/a.rs
source_file "${box}" crates/x/src/b.rs
report "${box}" crates/x/src/a.rs 100 100 crates/x/src/b.rs 96 100
check 0 "workspace acima dos dois pisos passa" "${box}" "ambos os pisos satisfeitos"

# 90% e 91% em dois arquivos de mesmo tamanho: todo arquivo passa no piso dele e
# o agregado ainda assim nao alcanca 95%. Sao dois pisos, nao um.
box="$(sandbox aggregate_below)"
source_file "${box}" crates/x/src/a.rs
source_file "${box}" crates/x/src/b.rs
report "${box}" crates/x/src/a.rs 90 100 crates/x/src/b.rs 91 100
check 1 "agregado abaixo de 95% reprova mesmo com todo arquivo acima de 90%" \
  "${box}" "abaixo do piso 95.0"

# O caso que motiva o piso por arquivo (ADR-0003): um arquivo pequeno no chao
# custa ao agregado um erro de arredondamento e passaria despercebido.
box="$(sandbox file_below)"
source_file "${box}" crates/x/src/grande.rs
source_file "${box}" crates/x/src/pequeno.rs
report "${box}" crates/x/src/grande.rs 1000 1000 crates/x/src/pequeno.rs 8 10
check 1 "arquivo no chao reprova mesmo com o agregado em 99%" "${box}" "abaixo do piso 90.0"

# --- Frescor do relatorio -------------------------------------------------------

box="$(sandbox stale_report)"
source_file "${box}" crates/x/src/a.rs
report "${box}" crates/x/src/a.rs 100 100
touch "${box}/crates/x/src/a.rs"
check 2 "relatorio mais velho que o fonte e recusado" "${box}" "mais velho que"

# --- Completude do relatorio ----------------------------------------------------

box="$(sandbox absent_file)"
source_file "${box}" crates/x/src/a.rs
source_file "${box}" crates/x/src/nunca_medido.rs
report "${box}" crates/x/src/a.rs 100 100
check 1 "arquivo de producao fora do relatorio reprova" "${box}" "nao aparece no relatorio"

box="$(sandbox absent_declared)"
source_file "${box}" crates/x/src/a.rs
source_file "${box}" crates/x/src/glue.rs
exemption "${box}" "crates/x/src/glue.rs no-statements so declaracoes de modulo"
report "${box}" crates/x/src/a.rs 100 100
check 0 "arquivo declarado no-statements pode faltar no relatorio" "${box}"

box="$(sandbox absent_wrong_kind)"
source_file "${box}" crates/x/src/a.rs
source_file "${box}" crates/x/src/nunca_medido.rs
exemption "${box}" "crates/x/src/nunca_medido.rs below-floor divida declarada"
report "${box}" crates/x/src/a.rs 100 100
check 1 "arquivo ausente declarado com o kind errado reprova" "${box}" "declarado como 'below-floor'"

# Um relatorio sem nenhum arquivo de producao nao aprova nada: falha fechado.
box="$(sandbox empty_report)"
source_file "${box}" crates/x/src/a.rs
report "${box}"
check 2 "relatorio vazio e recusado em vez de aprovado" "${box}" "relatorio esta vazio"

box="$(sandbox no_report)"
source_file "${box}" crates/x/src/a.rs
check 2 "relatorio inexistente e recusado" "${box}" "nao encontrado"

# --- O que nao e producao -------------------------------------------------------

# Arquivo que so existe para o teste nao entra em piso nenhum, entao tambem nao
# precisa aparecer no relatorio nem declarar exemption.
box="$(sandbox test_only_files)"
source_file "${box}" crates/x/src/a.rs
source_file "${box}" crates/x/src/a_test.rs
source_file "${box}" crates/x/src/arvore_tests.rs
source_file "${box}" crates/x/src/tests.rs
source_file "${box}" crates/x/src/fakes.rs
report "${box}" crates/x/src/a.rs 100 100
check 0 "arquivo que so existe para teste nao precisa aparecer no relatorio" "${box}"

# --- Ratchet das exemptions -----------------------------------------------------

box="$(sandbox ratchet_no_statements)"
source_file "${box}" crates/x/src/a.rs
source_file "${box}" crates/x/src/glue.rs
exemption "${box}" "crates/x/src/glue.rs no-statements era so glue"
report "${box}" crates/x/src/a.rs 100 100 crates/x/src/glue.rs 40 40
check 1 "no-statements que ganhou linha instrumentada reprova" \
  "${box}" "nao pode mais ser 'no-statements'"

box="$(sandbox below_floor_holds)"
source_file "${box}" crates/x/src/grande.rs
source_file "${box}" crates/x/src/pequeno.rs
exemption "${box}" "crates/x/src/pequeno.rs below-floor divida declarada"
report "${box}" crates/x/src/grande.rs 1000 1000 crates/x/src/pequeno.rs 8 10
check 0 "below-floor declarado dispensa o arquivo do piso" "${box}"

box="$(sandbox ratchet_below_floor)"
source_file "${box}" crates/x/src/grande.rs
source_file "${box}" crates/x/src/pequeno.rs
exemption "${box}" "crates/x/src/pequeno.rs below-floor divida declarada"
report "${box}" crates/x/src/grande.rs 1000 1000 crates/x/src/pequeno.rs 10 10
check 1 "below-floor que alcancou o piso reprova" "${box}" "deve ser removida"

box="$(sandbox ratchet_ghost)"
source_file "${box}" crates/x/src/a.rs
exemption "${box}" "crates/x/src/sumiu.rs below-floor divida declarada"
report "${box}" crates/x/src/a.rs 100 100
check 1 "exemption apontando para arquivo inexistente reprova" "${box}" "arquivo inexistente"

box="$(sandbox invalid_kind)"
source_file "${box}" crates/x/src/a.rs
exemption "${box}" "crates/x/src/a.rs kind-inventado razao qualquer"
report "${box}" crates/x/src/a.rs 100 100
check 1 "kind fora do vocabulario reprova" "${box}" "kind invalido"

# --- Resultado ------------------------------------------------------------------

echo ""
if [[ "${failed}" -gt 0 ]]; then
  echo "coverage-gate-test: ${passed} passaram, ${failed} falharam." >&2
  exit 1
fi
echo "coverage-gate-test: ${passed} casos, todos passaram."

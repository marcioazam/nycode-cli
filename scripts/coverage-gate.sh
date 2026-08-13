#!/usr/bin/env bash
# Gate de cobertura do nycode. Espelha o ADR-0393 do nylla-gateway: dois pisos,
# ambos duros, ambos falhando fechado.
#
#   1. Agregado >= 95.0% de linhas sobre todo o workspace.
#   2. Todo arquivo de producao com pelo menos uma linha instrumentada >= 90.0%.
#
# O agregado sozinho esconde a propria distribuicao: um arquivo no chao custa a
# ele um erro de arredondamento enquanto e exatamente o codigo que ninguem testou.
#
# Os dois pisos so alcancam o que o relatorio contem, entao antes deles o gate
# verifica que o relatorio esta fresco e completo (ADR-0010). Um arquivo ausente
# do relatorio nao e um arquivo aprovado.
#
# Uso:
#   cargo llvm-cov --workspace --all-features --json --output-path coverage.json
#   scripts/coverage-gate.sh coverage.json

set -euo pipefail

readonly AGGREGATE_FLOOR=95.0
readonly FILE_FLOOR=90.0

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly ROOT
readonly EXEMPTIONS="${ROOT}/scripts/coverage-exemptions.txt"

JSON="${1:-coverage.json}"
if [[ ! -f "${JSON}" ]]; then
  echo "coverage-gate: arquivo de cobertura nao encontrado: ${JSON}" >&2
  echo "  gere com: cargo llvm-cov --workspace --all-features --json --output-path ${JSON}" >&2
  exit 2
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "coverage-gate: jq e obrigatorio" >&2
  exit 2
fi

# --- Frescor do relatorio -------------------------------------------------------
# Um relatorio gerado antes da ultima edicao de fonte descreve outro codigo. Ele
# atravessa os dois pisos sem ter medido justamente o arquivo que acabou de
# mudar, que e o arquivo sob suspeita. E erro de uso, nao violacao de piso: sai
# como o relatorio ausente sai, com a instrucao de regenerar.
stale="$(find "${ROOT}/crates" -path '*/src/*' -name '*.rs' -newer "${JSON}" -print -quit)"
if [[ -n "${stale}" ]]; then
  echo "coverage-gate: ${JSON} e mais velho que ${stale#"${ROOT}/"}" >&2
  echo "  regenere com: cargo llvm-cov --workspace --all-features --json --output-path ${JSON}" >&2
  exit 2
fi

failures=0
fail() {
  echo "  FALHA: $*" >&2
  failures=$((failures + 1))
}

# --- Exemptions declaradas -----------------------------------------------------
declare -A exempt_kind=()
declare -A exempt_seen=()
declare -A report_seen=()
if [[ -f "${EXEMPTIONS}" ]]; then
  while read -r path kind _reason; do
    [[ -z "${path}" || "${path}" == \#* ]] && continue
    case "${kind}" in
    no-statements | platform | below-floor) ;;
    *)
      fail "exemption com kind invalido '${kind}' para ${path}"
      continue
      ;;
    esac
    exempt_kind["${path}"]="${kind}"
  done <"${EXEMPTIONS}"
fi

# --- O que conta como producao -------------------------------------------------
# `crates/*/src/**`, menos os arquivos que so existem para os testes. Um arquivo
# de teste tem cobertura perto de 100% por construcao: incluí-lo infla o
# agregado e mede o esforco de teste em vez do que ele protege.
#
# Limitacao conhecida e nao resolvida aqui: um `#[cfg(test)] mod tests` embutido
# num arquivo de producao continua contando. Separa-lo exigiria exclusao por
# regiao, que o formato de relatorio nao expressa por atributo.
is_production() {
  local rel="$1"
  [[ "${rel}" == crates/*/src/* ]] || return 1
  case "${rel##*/}" in
  *_test.rs | *_tests.rs | tests.rs | fakes.rs) return 1 ;;
  esac
  return 0
}

# --- Piso 1: agregado sobre producao -------------------------------------------
read -r covered total < <(
  jq -r '.data[0].files[] | [.filename, .summary.lines.covered, .summary.lines.count] | @tsv' "${JSON}" |
    while IFS=$'\t' read -r file c n; do
      rel="${file#"${ROOT}/"}"
      is_production "${rel}" && echo "${c} ${n}"
    done |
    awk '{ c += $1; n += $2 } END { printf "%d %d\n", c, n }'
)

if [[ "${total}" -eq 0 ]]; then
  echo "coverage-gate: nenhum arquivo de producao instrumentado; o relatorio esta vazio?" >&2
  exit 2
fi

aggregate=$(awk -v c="${covered}" -v n="${total}" 'BEGIN { printf "%.4f", (c / n) * 100 }')
echo "Cobertura agregada de producao: ${aggregate}% (piso ${AGGREGATE_FLOOR}%, ${covered}/${total} linhas)"
if ! awk -v a="${aggregate}" -v f="${AGGREGATE_FLOOR}" 'BEGIN { exit !(a + 0 >= f + 0) }'; then
  fail "agregado ${aggregate}% abaixo do piso ${AGGREGATE_FLOOR}%"
fi

# --- Piso 2: por arquivo de producao -------------------------------------------
while IFS=$'\t' read -r file count percent; do
  [[ -z "${file}" ]] && continue
  rel="${file#"${ROOT}/"}"
  is_production "${rel}" || continue
  report_seen["${rel}"]=1

  kind="${exempt_kind[${rel}]:-}"
  [[ -n "${kind}" ]] && exempt_seen["${rel}"]=1

  if [[ "${count}" -eq 0 ]]; then
    # Sem linhas instrumentadas: so pode existir como no-statements.
    if [[ -n "${kind}" && "${kind}" != "no-statements" ]]; then
      fail "${rel} nao tem linhas instrumentadas mas esta declarado como '${kind}'"
    fi
    continue
  fi

  # Tem linhas. Uma exemption no-statements virou obsoleta: ratchet.
  if [[ "${kind}" == "no-statements" ]]; then
    fail "${rel} ganhou linhas instrumentadas e nao pode mais ser 'no-statements'"
    continue
  fi

  if awk -v p="${percent}" -v f="${FILE_FLOOR}" 'BEGIN { exit !(p + 0 >= f + 0) }'; then
    # Alcancou o piso. Uma exemption below-floor virou obsoleta: ratchet.
    if [[ "${kind}" == "below-floor" ]]; then
      fail "${rel} alcancou ${percent}% e a exemption 'below-floor' deve ser removida"
    fi
  elif [[ -z "${kind}" ]]; then
    fail "${rel} em ${percent}%, abaixo do piso ${FILE_FLOOR}% e sem exemption declarada"
  fi
done < <(jq -r '.data[0].files[] | [.filename, .summary.lines.count, .summary.lines.percent] | @tsv' "${JSON}")

# --- Piso 2, a outra metade: o arquivo que nao chegou ao relatorio --------------
# O laco acima so alcanca o que o relatorio contem, e a ausencia tem tres causas
# que ele nao distingue: o arquivo nao tem uma unica linha instrumentada, um
# `cfg` impede que ele compile, ou o relatorio foi gerado sem ele. As tres pedem
# declaracao. Sem esta varredura, criar um arquivo que o relatorio nao alcanca e
# a forma mais barata de escapar do piso, e ela nao deixa rastro.
while IFS= read -r absolute; do
  rel="${absolute#"${ROOT}/"}"
  is_production "${rel}" || continue
  [[ -n "${report_seen[${rel}]:-}" ]] && continue

  kind="${exempt_kind[${rel}]:-}"
  if [[ -z "${kind}" ]]; then
    fail "${rel} nao aparece no relatorio e nao esta declarado como 'no-statements'"
  else
    exempt_seen["${rel}"]=1
    if [[ "${kind}" != "no-statements" ]]; then
      fail "${rel} nao aparece no relatorio mas esta declarado como '${kind}'"
    fi
  fi
done < <(find "${ROOT}/crates" -path '*/src/*' -name '*.rs' | sort)

# --- Ratchet: exemption cujo arquivo sumiu -------------------------------------
for rel in "${!exempt_kind[@]}"; do
  if [[ -z "${exempt_seen[${rel}]:-}" && ! -f "${ROOT}/${rel}" ]]; then
    fail "exemption aponta para arquivo inexistente: ${rel}"
  fi
done

if [[ "${failures}" -gt 0 ]]; then
  echo "" >&2
  echo "coverage-gate: ${failures} violacao(oes). Gate fecha." >&2
  exit 1
fi

echo "coverage-gate: ambos os pisos satisfeitos."

#!/usr/bin/env bash
# Gate de cobertura de diff (GATE-01 do padrao externo SOTA-2026 adotado no
# AGENTS.md): pelo menos 80% das linhas adicionadas ou modificadas pelo PR
# precisam estar cobertas.
#
# Diferente do agregado e do piso por arquivo (NFR-5, ja gates deste
# repositorio): aqueles medem o estado do mundo, e um PR pode satisfazer o
# piso do projeto inteiro enquanto adiciona uma funcao inteira sem teste --
# um arquivo grande e bem testado absorve o erro de arredondamento. O diff
# mede exatamente o que o PR introduziu.
#
# So conta arquivo de producao (crates/*/src/**, fora *_test.rs e afins) --
# mesmo criterio de scripts/coverage-gate.sh, pelo mesmo motivo: arquivo de
# teste tem cobertura perto de 100% por construcao.
#
# Uso:
#   scripts/diff-coverage-gate.sh <lcov> [<base>] [<head>]
#     <lcov>  gerado com: cargo llvm-cov report --lcov --output-path <lcov>
#             (reaproveita os dados de perfil do passo de cobertura anterior,
#             sem rodar os testes de novo)
#     <base>  default origin/main
#     <head>  default HEAD

set -euo pipefail

readonly FLOOR=80.0

# --- Funcoes puras, sem cargo nem rede ---------------------------------------

is_production() { # is_production <caminho-relativo> -> 0 se conta, 1 se nao
  local rel="$1"
  case "${rel}" in
  crates/*/src/*) ;;
  *) return 1 ;;
  esac
  case "${rel##*/}" in
  *_test.rs | *_tests.rs | tests.rs | fakes.rs) return 1 ;;
  esac
  return 0
}

added_lines() { # added_lines <base> <head> -> "arquivo\tlinha" por linha adicionada em .rs de producao
  git diff --unified=0 "${1}" "${2}" -- '*.rs' | awk '
    /^\+\+\+ b\// { file = substr($0, 7); next }
    /^@@/ {
      match($0, /\+[0-9]+/)
      newline = substr($0, RSTART + 1, RLENGTH - 1) + 0
      next
    }
    /^\+\+\+/ { next }
    /^\+/ {
      print file "\t" newline
      newline++
      next
    }
  ' | while IFS=$'\t' read -r file line; do
    is_production "${file}" && printf '%s\t%s\n' "${file}" "${line}"
  done || true
}

diff_coverage_from_lcov() { # diff_coverage_from_lcov <lcov> <added-lines> -> "cobertas total"
  local lcov="$1" added="$2"
  awk -v addedlist="${added}" '
    BEGIN {
      n = split(addedlist, rows, "\n")
      for (i = 1; i <= n; i++) {
        if (rows[i] == "") continue
        split(rows[i], parts, "\t")
        wanted[parts[1] SUBSEP parts[2]] = 1
      }
    }
    /^SF:/ { file = substr($0, 4); next }
    /^DA:/ {
      split(substr($0, 4), da, ",")
      key = file SUBSEP da[1]
      if (key in wanted) {
        total++
        if (da[2] + 0 > 0) covered++
      }
      next
    }
    END { printf "%d %d\n", covered + 0, total + 0 }
  ' "${lcov}"
}

# Sourced pelo teste para reusar as funcoes puras acima.
if [[ "${1:-}" == "--source-only" ]]; then
  return 0 2>/dev/null || exit 0
fi

# --- Execucao real ------------------------------------------------------------

LCOV="${1:-}"
BASE="${2:-origin/main}"
HEAD="${3:-HEAD}"

if [[ -z "${LCOV}" || ! -f "${LCOV}" ]]; then
  echo "diff-coverage-gate: arquivo lcov nao encontrado: ${LCOV:-<vazio>}" >&2
  echo "  gere com: cargo llvm-cov report --lcov --output-path ${LCOV:-lcov.info}" >&2
  exit 2
fi
if ! git rev-parse --verify --quiet "${BASE}" >/dev/null; then
  echo "diff-coverage-gate: ref base nao encontrada: ${BASE}" >&2
  exit 2
fi
if ! git rev-parse --verify --quiet "${HEAD}" >/dev/null; then
  echo "diff-coverage-gate: ref head nao encontrada: ${HEAD}" >&2
  exit 2
fi

added="$(added_lines "${BASE}" "${HEAD}")"
if [[ -z "${added}" ]]; then
  echo "diff-coverage-gate: nenhuma linha de producao adicionada ou modificada; nada para medir."
  exit 0
fi

read -r covered total < <(diff_coverage_from_lcov "${LCOV}" "${added}")

if [[ "${total}" -eq 0 ]]; then
  echo "diff-coverage-gate: linhas adicionadas existem, mas nenhuma instrumentada pelo relatorio; nada para medir."
  exit 0
fi

pct=$(awk -v c="${covered}" -v t="${total}" 'BEGIN { printf "%.2f", (c / t) * 100 }')
echo "Cobertura de diff: ${pct}% (piso ${FLOOR}%, ${covered}/${total} linhas adicionadas)"

if ! awk -v p="${pct}" -v f="${FLOOR}" 'BEGIN { exit !(p + 0 >= f + 0) }'; then
  echo "  FALHA: cobertura de diff ${pct}% abaixo do piso ${FLOOR}% (GATE-01)" >&2
  echo >&2
  echo "diff-coverage-gate: reprovado." >&2
  exit 1
fi

echo "diff-coverage-gate: satisfaz o piso de ${FLOOR}%."

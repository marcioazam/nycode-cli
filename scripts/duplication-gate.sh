#!/usr/bin/env bash
# Gate de duplicacao de codigo (GATE-08 do padrao externo SOTA-2026 adotado
# no AGENTS.md): teto de 5% de linhas duplicadas.
#
# Medido com `jscpd` v5 (motor Rust nativo, github.com/kucherenko/jscpd),
# `cargo install jscpd`. O proprio `--threshold`/`--exit-code` do binario
# NAO faz o que o help sugere: com o reporter `console` presente (sozinho ou
# combinado com `threshold`), `--exit-code` reprova assim que existe
# qualquer clone, ignorando o teto por completo -- confirmado testando os
# dois lados (teto de 1% e teto de 99% contra a mesma arvore deram o mesmo
# exit 1). Por isso este gate le o `jscpd-report.json` (reporter `json`) e
# faz a propria comparacao contra o teto, do mesmo jeito que
# complexity-gate.sh nao confia em decisao de terceiro sem verificar o
# formato primeiro.
#
# Duplicacao, como complexidade (GATE-05/GATE-06) e tamanho de arquivo
# (GATE-07), e' propriedade do estado atual da arvore, nao do que um PR
# introduziu -- roda contra crates/ inteiro, em scripts/ci-local.sh --full,
# nao e' uma excecao so-CI.
#
# Sem ratchet: a duplicacao medida no dia em que este gate nasceu (1,95% de
# linhas) ja fica abaixo do teto de 5% sem precisar de baseline nenhum --
# diferente do teto de 500 linhas e do de complexidade, que nasceram sobre
# codigo que ja excedia o proprio teto.
#
# Uso:
#   scripts/duplication-gate.sh                  # crates/ real, teto 5%
#   scripts/duplication-gate.sh <raiz> [<teto>]   # para o auto-teste

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly ROOT

TARGET="${1:-${ROOT}}"
THRESHOLD="${2:-5}"

if [[ ! -d "${TARGET}/crates" ]]; then
  echo "duplication-gate: raiz nao encontrada: ${TARGET}" >&2
  exit 2
fi
if ! command -v jscpd >/dev/null 2>&1; then
  echo "duplication-gate: \`jscpd\` nao encontrado." >&2
  echo "  instale: cargo install jscpd --locked" >&2
  exit 1
fi

report_dir="$(mktemp -d)"
console_out="$(mktemp)"
trap 'rm -rf "${report_dir}"; rm -f "${console_out}"' EXIT

jscpd "${TARGET}/crates" -f rust --reporters console,json -o "${report_dir}" \
  >"${console_out}" 2>&1 || true

report="${report_dir}/jscpd-report.json"
if [[ ! -f "${report}" ]]; then
  cat "${console_out}" >&2
  echo "duplication-gate: jscpd nao produziu jscpd-report.json; saida acima." >&2
  exit 1
fi

percentage="$(jq -r '.statistics.total.percentage * 100 | round / 100' "${report}")"

if jq -e --argjson t "${THRESHOLD}" '.statistics.total.percentage > $t' "${report}" >/dev/null; then
  cat "${console_out}" >&2
  echo >&2
  echo "duplication-gate: reprovado — ${percentage}% de linhas duplicadas, acima do teto de ${THRESHOLD}%." >&2
  exit 1
fi

echo "duplication-gate: duplicacao dentro do teto (${percentage}% <= ${THRESHOLD}%)."

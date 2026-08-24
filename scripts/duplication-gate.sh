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
# A duplicacao tem ratchet: o percentual medido fica em
# `scripts/duplication-baseline.txt` e nao pode subir. O teto do padrao continua
# sendo a segunda barreira; o baseline impede que a divida cresca mesmo quando
# ainda esta abaixo dele.
#
# Uso:
#   scripts/duplication-gate.sh                  # crates/ real, teto 5%
#   scripts/duplication-gate.sh <raiz> [<teto>] [<baseline>] # para o auto-teste

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly ROOT

TARGET="${1:-${ROOT}}"
THRESHOLD="${2:-5}"
BASELINE="${3:-${ROOT}/scripts/duplication-baseline.txt}"

if [[ ! -d "${TARGET}/crates" ]]; then
	echo "duplication-gate: raiz nao encontrada: ${TARGET}" >&2
	exit 2
fi
if ! command -v jscpd >/dev/null 2>&1; then
	echo "duplication-gate: \`jscpd\` nao encontrado." >&2
	echo "  instale: cargo install jscpd --locked" >&2
	exit 1
fi
if [[ "${BASELINE}" != "-" && ! -f "${BASELINE}" ]]; then
	echo "duplication-gate: baseline nao encontrado: ${BASELINE}" >&2
	exit 2
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

if [[ "${BASELINE}" != "-" ]]; then
	baseline_percentage="$(sed -n 's/^percentage[[:space:]]*=[[:space:]]*//p' "${BASELINE}" | head -n1)"
	[[ "${baseline_percentage}" =~ ^[0-9]+([.][0-9]+)?$ ]] || {
		echo "duplication-gate: baseline invalido: ${BASELINE}" >&2
		exit 2
	}
	if jq -e --argjson b "${baseline_percentage}" '.statistics.total.percentage > $b' "${report}" >/dev/null; then
		echo "duplication-gate: reprovado — ${percentage}% acima do baseline ${baseline_percentage}% ratcheted." >&2
		exit 1
	fi
fi

if jq -e --argjson t "${THRESHOLD}" '.statistics.total.percentage > $t' "${report}" >/dev/null; then
	cat "${console_out}" >&2
	echo >&2
	echo "duplication-gate: reprovado — ${percentage}% de linhas duplicadas, acima do teto de ${THRESHOLD}%." >&2
	exit 1
fi

echo "duplication-gate: duplicacao dentro do teto (${percentage}% <= ${THRESHOLD}%)."

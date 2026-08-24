#!/usr/bin/env bash
# Gate de complexidade cognitiva e ciclomatica por funcao (GATE-05/GATE-06 do
# padrao externo SOTA-2026 adotado no AGENTS.md).
#
# Ciclomatica (McCabe) conta ponto de decisao de forma achatada: 1 + um por
# ramo. Cognitiva (SonarSource) pesa mais a aninhada -- duas funcoes com o
# mesmo numero de ramos podem ter cognitiva bem diferente se uma aninha e a
# outra nao. As duas medem coisas distintas (ex.: um dispatch de tecla pode
# ter ciclomatica alta e cognitiva baixa por ser um match achatado), entao o
# gate cobre as duas, nao uma no lugar da outra.
#
# Medido com `codemetrics` (github.com/richardwooding/codemetrics), binario
# Go com backend tree-sitter para Rust -- ver a instalacao com digest
# conferido em ci.yml, mesmo padrao ja usado para actionlint.
#
# Complexidade e' propriedade do estado atual de uma funcao, nao do que um PR
# introduziu -- ao contrario dos gates PR-only (GATE-01/04/11/SP-04), este
# roda contra a arvore inteira e por isso vive em scripts/ci-local.sh --full,
# mesmo lugar de layout-gate.sh/file-length-gate.sh, nao numa excecao so-CI.
#
# Com ratchet, mesmo principio de file-length-gate.sh (GATE-07/RAT-04):
# funcao que ja excedia um dos dois tetos no dia em que o gate nasceu tem
# entrada no baseline com os dois valores daquele dia. Pode ficar do jeito
# que esta -- nao pode crescer em nenhum dos dois, e a entrada cai quando a
# funcao encolhe para dentro dos dois tetos ou a funcao some.
#
# Uso:
#   scripts/complexity-gate.sh                          # crates/ real
#   scripts/complexity-gate.sh <raiz> <baseline>          # para o auto-teste

set -euo pipefail

readonly MAX_COGNITIVE=15
readonly MAX_CYCLOMATIC=10

# --- Funcoes puras, sem o binario codemetrics ---------------------------------

read_baseline() { # read_baseline <arquivo> -> preenche baseline_cognitive/baseline_cyclomatic (globais)
	local file="$1" path func cog cyc
	while IFS=' ' read -r path func cog cyc; do
		[[ -z "${path}" || "${path}" == \#* ]] && continue
		baseline_cognitive["${path}"$'\t'"${func}"]="${cog}"
		baseline_cyclomatic["${path}"$'\t'"${func}"]="${cyc}"
	done <"${file}"
}

evaluate() { # evaluate <json-de-metricas-codemetrics> -> imprime falhas em stderr, ecoa a contagem no stdout
	local json="$1"
	local failures=0
	local -A seen_baseline
	local file func cog cyc key

	while IFS=$'\t' read -r file func cog cyc; do
		key="${file}"$'\t'"${func}"
		if [[ -n "${baseline_cognitive[${key}]+x}" ]]; then
			seen_baseline["${key}"]=1
			local base_cog="${baseline_cognitive[${key}]}" base_cyc="${baseline_cyclomatic[${key}]}"
			if ((cog <= MAX_COGNITIVE && cyc <= MAX_CYCLOMATIC)); then
				echo "  FALHA: baseline cita ${file}::${func}, que caiu para dentro do teto — remova a linha" >&2
				failures=$((failures + 1))
			elif ((cog > base_cog || cyc > base_cyc)); then
				echo "  FALHA: ${file}::${func} cresceu (cognitiva ${cog}/${base_cog}, ciclomatica ${cyc}/${base_cyc}) acima do baseline registrado" >&2
				failures=$((failures + 1))
			fi
		elif ((cog > MAX_COGNITIVE || cyc > MAX_CYCLOMATIC)); then
			echo "  FALHA: ${file}::${func} tem complexidade cognitiva ${cog} / ciclomatica ${cyc}, acima do teto (${MAX_COGNITIVE}/${MAX_CYCLOMATIC}), sem entrada no baseline" >&2
			failures=$((failures + 1))
		fi
	done < <(jq -r '.[] | [.file, .function, .cognitive, .cyclomatic] | @tsv' "${json}")

	for key in "${!baseline_cognitive[@]}"; do
		[[ -n "${seen_baseline[${key}]+x}" ]] && continue
		IFS=$'\t' read -r file func <<<"${key}"
		echo "  FALHA: baseline cita ${file}::${func}, que sumiu — remova a linha" >&2
		failures=$((failures + 1))
	done

	echo "${failures}"
}

declare -gA baseline_cognitive baseline_cyclomatic

# Sourced pelo teste para reusar read_baseline/evaluate contra JSON sintetico.
if [[ "${1:-}" == "--source-only" ]]; then
	return 0 2>/dev/null || exit 0
fi

# --- Execucao real ------------------------------------------------------------

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly ROOT

TARGET="${1:-${ROOT}}"
BASELINE="${2:-${ROOT}/scripts/complexity-baseline.txt}"

if [[ ! -d "${TARGET}/crates" ]]; then
	echo "complexity-gate: raiz nao encontrada: ${TARGET}" >&2
	exit 2
fi
if [[ ! -f "${BASELINE}" ]]; then
	echo "complexity-gate: baseline nao encontrado: ${BASELINE}" >&2
	exit 2
fi
if ! command -v codemetrics >/dev/null 2>&1; then
	echo "complexity-gate: \`codemetrics\` nao encontrado." >&2
	echo "  instale: https://github.com/richardwooding/codemetrics/releases" >&2
	exit 1
fi

read_baseline "${BASELINE}"

json_tmp="$(mktemp)"
trap 'rm -f "${json_tmp}"' EXIT
(cd "${TARGET}" && codemetrics --format json crates) >"${json_tmp}"

failures="$(evaluate "${json_tmp}")"

if ((failures > 0)); then
	echo >&2
	echo "complexity-gate: ${failures} problema(s). Gate fecha." >&2
	exit 1
fi

echo "complexity-gate: nenhuma funcao acima do teto sem baseline valido."

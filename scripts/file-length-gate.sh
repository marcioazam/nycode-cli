#!/usr/bin/env bash
# Gate de teto de 500 linhas por arquivo (GATE-07/ARCH-11 do padrao externo
# SOTA-2026 adotado no AGENTS.md).
#
# O teto mede quanto um agente consegue editar com confianca de uma vez, nao
# beleza (ARCH-11) — vale igual para arquivo de producao e de teste: um
# arquivo de teste com 700 linhas e igualmente dificil de navegar quanto um de
# producao do mesmo tamanho.
#
# Com ratchet (RAT-04), porque este e um gate novo sobre um codigo que ja
# existia: arquivo que ja excedia o teto no dia em que o gate nasceu tem
# entrada no baseline com o numero de linhas daquele dia. Pode ficar do jeito
# que esta — nao pode crescer, e a entrada cai quando o arquivo encolhe para
# dentro do teto ou some. Arquivo novo acima do teto nao entra sozinho: exige
# uma linha adicionada a mao no baseline, o que forca revisao humana antes de
# aceitar mais um arquivo grande.
#
# Uso:
#   scripts/file-length-gate.sh                              # crates/ real
#   scripts/file-length-gate.sh <raiz> <baseline>             # para o auto-teste

set -euo pipefail

readonly MAX_LINES=500

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly ROOT

TARGET="${1:-${ROOT}}"
BASELINE="${2:-${ROOT}/scripts/file-length-baseline.txt}"

if [[ ! -d "${TARGET}/crates" ]]; then
  echo "file-length-gate: raiz nao encontrada: ${TARGET}" >&2
  exit 2
fi
if [[ ! -f "${BASELINE}" ]]; then
  echo "file-length-gate: baseline nao encontrado: ${BASELINE}" >&2
  exit 2
fi

declare -A baseline_lines
while IFS=' ' read -r path lines _rest; do
  [[ -z "${path}" || "${path}" == \#* ]] && continue
  baseline_lines["${path}"]="${lines}"
done <"${BASELINE}"

failures=0
declare -A seen_baseline

while IFS= read -r file; do
  key="${file#"${TARGET}"/}"
  lines="$(wc -l <"${file}")"

  if [[ -n "${baseline_lines[${key}]+x}" ]]; then
    seen_baseline["${key}"]=1
    base="${baseline_lines[${key}]}"
    if ((lines <= MAX_LINES)); then
      echo "  FALHA: baseline cita ${key}, que sumiu ou encolheu para dentro do teto — remova a linha" >&2
      failures=$((failures + 1))
    elif ((lines > base)); then
      echo "  FALHA: ${key} cresceu para ${lines} linhas, acima do baseline registrado de ${base}" >&2
      failures=$((failures + 1))
    fi
  elif ((lines > MAX_LINES)); then
    echo "  FALHA: ${key} tem ${lines} linhas, acima do teto de ${MAX_LINES}, sem entrada no baseline" >&2
    failures=$((failures + 1))
  fi
done < <(find "${TARGET}/crates" -type f -name '*.rs' | sort)

for key in "${!baseline_lines[@]}"; do
  [[ -n "${seen_baseline[${key}]+x}" ]] && continue
  echo "  FALHA: baseline cita ${key}, que sumiu ou encolheu para dentro do teto — remova a linha" >&2
  failures=$((failures + 1))
done

if ((failures > 0)); then
  echo >&2
  echo "file-length-gate: ${failures} problema(s). Gate fecha." >&2
  exit 1
fi

echo "file-length-gate: nenhum arquivo acima do teto sem baseline valido."

#!/usr/bin/env bash
# Vulnerabilidades HIGH/CRITICAL no artefato (GATE-10).
#
# Le um relatorio JSON do Trivy. HIGH/CRITICAL sem linha vigente em
# scripts/artifact-vex.txt reprovam. Ferramenta ausente no modo --scan
# fecha com a linha de instalacao.
#
# Uso:
#   scripts/artifact/gate.sh --json <relatorio.json> [<vex>]
#   scripts/artifact/gate.sh --scan <caminho> [<vex>]

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly ROOT

mode="${1:-}"
target="${2:-}"
vex="${3:-${ROOT}/scripts/artifact-vex.txt}"

if [[ -z "${mode}" || -z "${target}" ]]; then
  echo "artifact-gate: uso: --json <arquivo> | --scan <caminho>" >&2
  exit 2
fi

trim() {
  local s="$1"
  s="${s#"${s%%[![:space:]]*}"}"
  s="${s%"${s##*[![:space:]]}"}"
  printf '%s' "${s}"
}

hoje="$(date +%F)"
declare -A vex_ok

if [[ -f "${vex}" ]]; then
  while IFS= read -r linha || [[ -n "${linha}" ]]; do
    [[ -z "${linha}" || "${linha}" == \#* ]] && continue
    IFS='|' read -r cve expira motivo _extra <<<"${linha}"
    cve="$(trim "${cve}")"
    expira="$(trim "${expira}")"
    motivo="$(trim "${motivo}")"
    if [[ -z "${cve}" || -z "${expira}" || -z "${motivo}" ]]; then
      echo "  FALHA: VEX sem tres campos: ${linha}" >&2
      exit 1
    fi
    if [[ "${expira}" < "${hoje}" ]]; then
      continue
    fi
    vex_ok["${cve}"]=1
  done <"${vex}"
fi

json=""
if [[ "${mode}" == "--json" ]]; then
  if [[ ! -f "${target}" ]]; then
    echo "artifact-gate: relatorio nao encontrado: ${target}" >&2
    exit 2
  fi
  json="${target}"
elif [[ "${mode}" == "--scan" ]]; then
  if ! command -v trivy >/dev/null 2>&1; then
    echo "artifact-gate: \`trivy\` nao encontrado." >&2
    echo "  instale: https://github.com/aquasecurity/trivy/releases" >&2
    exit 1
  fi
  if [[ ! -e "${target}" ]]; then
    echo "artifact-gate: artefato nao encontrado: ${target}" >&2
    exit 2
  fi
  json="$(mktemp)"
  trap 'rm -f "${json}"' EXIT
  trivy fs --scanners vuln --format json --quiet "${target}" >"${json}"
else
  echo "artifact-gate: modo desconhecido: ${mode}" >&2
  exit 2
fi

failures=0
while IFS= read -r cve; do
  [[ -z "${cve}" ]] && continue
  if [[ -n "${vex_ok[${cve}]+x}" ]]; then
    continue
  fi
  echo "  FALHA: ${cve} e HIGH/CRITICAL sem VEX vigente" >&2
  failures=$((failures + 1))
done < <(jq -r '
  .Results // []
  | .[]
  | .Vulnerabilities // []
  | .[]
  | select(.Severity == "HIGH" or .Severity == "CRITICAL")
  | .VulnerabilityID
' "${json}")

if ((failures > 0)); then
  echo >&2
  echo "artifact-gate: ${failures} problema(s). Gate fecha." >&2
  exit 1
fi

echo "artifact-gate: nenhum HIGH/CRITICAL sem VEX vigente."

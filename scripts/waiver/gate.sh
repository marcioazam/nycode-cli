#!/usr/bin/env bash
# Gate de waiver expirado (GATE-14 / CI-10 do padrao externo SOTA-2026).
#
# O registro e scripts/waiver/registry.txt, no idioma dos outros ratchets:
# uma linha por waiver, seis campos separados por ` | `, nao um parser de
# prosa de ADR. O ADR continua sendo a razao; o registro e o que o CI
# consegue falhar fechado.
#
# Falha (exit 1) quando a data passou, falta campo, o ADR apontado nao
# existe, o cabecalho do ADR diverge do registro, ou um ADR declara
# Waiver: sem linha correspondente (e o inverso).
#
# Uso:
#   scripts/waiver/gate.sh                         # repositorio real
#   scripts/waiver/gate.sh <raiz> <registro>       # para o auto-teste

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly ROOT

TARGET="${1:-${ROOT}}"
REGISTRO="${2:-${TARGET}/scripts/waiver/registry.txt}"

if [[ ! -d "${TARGET}" ]]; then
  echo "waiver-gate: raiz nao encontrada: ${TARGET}" >&2
  exit 2
fi
if [[ ! -f "${REGISTRO}" ]]; then
  echo "waiver-gate: registro nao encontrado: ${REGISTRO}" >&2
  exit 2
fi

trim() {
  local s="$1"
  s="${s#"${s%%[![:space:]]*}"}"
  s="${s%"${s##*[![:space:]]}"}"
  printf '%s' "${s}"
}

hoje="$(date +%F)"
failures=0
declare -A visto_adr

while IFS= read -r linha || [[ -n "${linha}" ]]; do
  [[ -z "${linha}" || "${linha}" == \#* ]] && continue

  IFS='|' read -r id regra expira dono controle adr _extra <<<"${linha}"
  id="$(trim "${id}")"
  regra="$(trim "${regra}")"
  expira="$(trim "${expira}")"
  dono="$(trim "${dono}")"
  controle="$(trim "${controle}")"
  adr="$(trim "${adr}")"

  if [[ -z "${id}" || -z "${regra}" || -z "${expira}" || -z "${dono}" || -z "${controle}" || -z "${adr}" ]]; then
    echo "  FALHA: linha sem os seis campos: ${linha}" >&2
    failures=$((failures + 1))
    continue
  fi
  if [[ ! "${expira}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
    echo "  FALHA: ${id}: data invalida (${expira}); use YYYY-MM-DD" >&2
    failures=$((failures + 1))
    continue
  fi
  if [[ "${expira}" < "${hoje}" ]]; then
    echo "  FALHA: ${id} (${regra}) expirou em ${expira}" >&2
    failures=$((failures + 1))
  fi

  adr_path="${TARGET}/${adr}"
  if [[ ! -f "${adr_path}" ]]; then
    echo "  FALHA: ${id} aponta para ${adr}, que nao existe" >&2
    failures=$((failures + 1))
    continue
  fi

  waiver_adr="$(sed -n 's/^- \*\*Waiver:\*\* //p' "${adr_path}" | head -n 1)"
  expira_adr="$(sed -n 's/^- \*\*Expira:\*\* //p' "${adr_path}" | head -n 1)"
  waiver_adr="$(trim "${waiver_adr}")"
  expira_adr="$(trim "${expira_adr}")"

  if [[ "${waiver_adr}" != "${regra}" ]]; then
    echo "  FALHA: ${id}: Waiver do ADR (${waiver_adr:-ausente}) diverge da regra do registro (${regra})" >&2
    failures=$((failures + 1))
  fi
  if [[ "${expira_adr}" != "${expira}" ]]; then
    echo "  FALHA: ${id}: Expira do ADR (${expira_adr:-ausente}) diverge do registro (${expira})" >&2
    failures=$((failures + 1))
  fi

  visto_adr["${adr}"]=1
done <"${REGISTRO}"

decisoes="${TARGET}/docs/architecture/decisions"
if [[ -d "${decisoes}" ]]; then
  while IFS= read -r adr_path; do
    base="$(basename "${adr_path}")"
    [[ "${base}" == "README.md" || "${base}" == "ADR_TEMPLATE.md" ]] && continue
    grep -q '^- \*\*Waiver:\*\* ' "${adr_path}" || continue
    rel="docs/architecture/decisions/${base}"
    if [[ -z "${visto_adr[${rel}]+x}" ]]; then
      echo "  FALHA: ${rel} declara Waiver sem linha no registro" >&2
      failures=$((failures + 1))
    fi
  done < <(find "${decisoes}" -maxdepth 1 -type f -name '*.md' | sort)
fi

if ((failures > 0)); then
  echo >&2
  echo "waiver-gate: ${failures} problema(s). Gate fecha." >&2
  exit 1
fi

echo "waiver-gate: nenhum waiver expirado ou orfao."

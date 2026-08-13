#!/usr/bin/env bash
# Gate de paridade (NFR-4, NFR-6).
#
# A comparacao completa precisa de tres coisas: o binario do nycode, o harness
# de referencia, e um gateway para os dois falarem. As duas primeiras o CI
# constroi; a terceira vem de configuracao do repositorio.
#
# Quando o gateway nao esta configurado, este script diz isso em voz alta e sai
# com zero. A alternativa seria falhar todo PR de quem nao tem acesso ao
# gateway, ou pior, passar em silencio dando a impressao de que a paridade foi
# verificada. O que trava o gate nesse caso e o job irmao, que roda a suite do
# proprio harness e garante que ele continua capaz de acusar divergencia.
set -euo pipefail

BINARY="${PARITY_BINARY:-target/debug/nycode}"
HARNESS="${PARITY_HARNESS:-target/debug/nycode-parity}"
REFERENCE="${PARITY_REFERENCE:-}"

if [[ ! -x "${HARNESS}" ]]; then
  echo "parity-gate: ${HARNESS} nao encontrado; rode 'cargo build -p nycode-parity'" >&2
  exit 2
fi

if [[ -z "${NYCODE_BASE_URL:-}" || -z "${NYCODE_API_KEY:-}" ]]; then
  echo "parity-gate: NAO EXECUTADO — NYCODE_BASE_URL e NYCODE_API_KEY nao estao configurados." >&2
  echo "parity-gate: a paridade contra o harness de referencia exige um gateway." >&2
  echo "parity-gate: configure as variaveis PARITY_BASE_URL e PARITY_API_KEY do repositorio." >&2
  exit 0
fi

if [[ -z "${REFERENCE}" ]]; then
  echo "parity-gate: NAO EXECUTADO — PARITY_REFERENCE nao aponta para o harness de referencia." >&2
  exit 0
fi

if ! command -v "${REFERENCE}" >/dev/null 2>&1 && [[ ! -x "${REFERENCE}" ]]; then
  echo "::error::parity-gate: harness de referencia '${REFERENCE}' nao encontrado" >&2
  exit 1
fi

if [[ ! -x "${BINARY}" ]]; then
  echo "::error::parity-gate: ${BINARY} nao encontrado; rode 'cargo build -p nycode-cli'" >&2
  exit 1
fi

echo "parity-gate: comparando ${BINARY} contra ${REFERENCE}"
exec "${HARNESS}" --nycode "${BINARY}" --reference "${REFERENCE}"

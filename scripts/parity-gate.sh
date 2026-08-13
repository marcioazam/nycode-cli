#!/usr/bin/env bash
# Gate de paridade (NFR-4, NFR-6).
#
# A comparacao completa precisa de tres coisas: o binario do nycode, o harness
# de referencia, e um gateway para os dois falarem. As duas primeiras o CI
# constroi; a terceira era o bloqueio.
#
# Era: este script saia com zero quando o gateway faltava, e o gateway sempre
# faltou. O README dizia "nao medido sem gateway", e uma regra sem instrumento e
# decoracao. O `nycode-parity-fixture` fecha isso — um gateway deterministico,
# local, sem credencial, que serve o dialeto Anthropic Messages com um script
# fixo. Ele nao substitui o gateway real e nao prova nada sobre ele: prova que
# os dois harnesses reagem igual as mesmas respostas, que e o que o NFR-6
# pergunta.
#
# Restam dois modos, e a diferenca entre eles e dita em voz alta:
#
#   completo     ha harness de referencia; as cinco dimensoes sao comparadas.
#   instrumento  nao ha; verifica-se que o harness consegue observar o
#                candidato. NAO e paridade, e a saida diz isso.
#
# O que nao existe mais e o terceiro modo, o de nao rodar nada.
set -euo pipefail

BINARY="${PARITY_BINARY:-target/debug/nycode}"
HARNESS="${PARITY_HARNESS:-target/debug/nycode-parity}"
FIXTURE="${PARITY_FIXTURE:-target/debug/nycode-parity-fixture}"
REFERENCE="${PARITY_REFERENCE:-}"

for required in "${HARNESS}" "${BINARY}"; do
  if [[ ! -x "${required}" ]]; then
    echo "::error::parity-gate: ${required} nao encontrado; rode 'cargo build --workspace'" >&2
    exit 2
  fi
done

# O harness roda cada execucao num workspace temporario proprio, entao o cwd do
# filho nao e o daqui e um caminho relativo deixaria de resolver.
BINARY="$(cd "$(dirname "${BINARY}")" && pwd)/$(basename "${BINARY}")"

fixture_pid=""
url_file=""
cleanup() {
  # O fixture nasce lider do proprio grupo? Nao: e um filho direto e sem netos,
  # entao matar o pid basta. Ver ADR-0021 para o caso geral, que nao e este.
  [[ -n "${fixture_pid}" ]] && kill "${fixture_pid}" 2>/dev/null || true
  [[ -n "${url_file}" ]] && rm -f "${url_file}"
  return 0
}
trap cleanup EXIT

if [[ -z "${NYCODE_BASE_URL:-}" || -z "${NYCODE_API_KEY:-}" ]]; then
  if [[ ! -x "${FIXTURE}" ]]; then
    echo "::error::parity-gate: ${FIXTURE} nao encontrado e nenhum gateway configurado" >&2
    exit 2
  fi

  url_file="$(mktemp)"
  "${FIXTURE}" >"${url_file}" &
  fixture_pid=$!

  # O fixture escolhe a porta e a anuncia na primeira linha. Esperar pela linha
  # e mais confiavel que dormir um tempo fixo, que e curto demais numa maquina
  # carregada e desperdicio em todas as outras.
  discovered=""
  for _ in $(seq 1 100); do
    discovered="$(head -n 1 "${url_file}" 2>/dev/null || true)"
    [[ -n "${discovered}" ]] && break
    sleep 0.1
  done

  if [[ -z "${discovered}" ]]; then
    echo "::error::parity-gate: o fixture nao anunciou a porta em 10s" >&2
    exit 1
  fi

  export NYCODE_BASE_URL="${discovered}"
  export NYCODE_API_KEY="fixture"
  echo "parity-gate: gateway de fixture em ${NYCODE_BASE_URL}"
fi

if [[ -z "${REFERENCE}" ]]; then
  echo "parity-gate: modo instrumento — PARITY_REFERENCE nao aponta para o harness de referencia" >&2
  exec "${HARNESS}" --nycode "${BINARY}" --self-check
fi

if ! command -v "${REFERENCE}" >/dev/null 2>&1 && [[ ! -x "${REFERENCE}" ]]; then
  echo "::error::parity-gate: harness de referencia '${REFERENCE}' nao encontrado" >&2
  exit 1
fi

echo "parity-gate: comparando ${BINARY} contra ${REFERENCE}"
exec "${HARNESS}" --nycode "${BINARY}" --reference "${REFERENCE}"

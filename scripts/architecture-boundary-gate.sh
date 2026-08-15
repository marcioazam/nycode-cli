#!/usr/bin/env bash
# Gate de fronteira de arquitetura (GATE-15/ARCH-04/ARCH-05 do padrao externo
# SOTA-2026 adotado no AGENTS.md): o grafo de dependencia entre crates
# internos.
#
# Cargo ja recusa um ciclo verdadeiro (nao compila). O que este gate cobre e
# diferente: uma dependencia nova, legal para o Cargo, mas que muda a direcao
# pretendida da arquitetura sem ninguem decidir isso explicitamente -- por
# exemplo, `nycode-ai` (cliente de wire) passar a depender de `nycode-tui`
# (renderizador de terminal). Sem gate, essa aresta some dentro de um diff
# maior e vira arquitetura por acidente. "Uma fronteira que existe so em
# documentacao nao e fronteira" (ARCH-06).
#
# Cada crate deste workspace e' um contexto delimitado (ARCH-04); nao ha
# fatia vertical mais fina que o Cargo exponha mecanicamente para checar,
# entao a fronteira que este gate verifica e' a de crate, nao de modulo.
#
# scripts/architecture-boundary-allowlist.txt e' a lista de arestas
# permitidas (`origem -> destino`, one per line). Uma aresta real que nao
# esta na lista reprova -- precisa de linha adicionada a mao, o que forca
# revisao humana antes de aceitar uma dependencia nova entre crates. Uma
# entrada na lista cuja dependencia sumiu do Cargo.toml tambem reprova: a
# lista descreve o grafo real, nao aspiracoes.
#
# Uso:
#   scripts/architecture-boundary-gate.sh                          # workspace real
#   scripts/architecture-boundary-gate.sh <raiz> <allowlist>       # para o auto-teste

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly ROOT

TARGET="${1:-${ROOT}}"
ALLOWLIST="${2:-${ROOT}/scripts/architecture-boundary-allowlist.txt}"

if [[ ! -d "${TARGET}/crates" ]]; then
  echo "architecture-boundary-gate: raiz nao encontrada: ${TARGET}" >&2
  exit 2
fi
if [[ ! -f "${ALLOWLIST}" ]]; then
  echo "architecture-boundary-gate: allowlist nao encontrada: ${ALLOWLIST}" >&2
  exit 2
fi

declare -A allowed
while IFS=' ' read -r origem seta destino _rest; do
  [[ -z "${origem}" || "${origem}" == \#* || "${seta}" != "->" ]] && continue
  allowed["${origem} -> ${destino}"]=1
done <"${ALLOWLIST}"

# Nomes de crate interno vem do que existe de verdade sob crates/, nao de um
# prefixo assumido -- assim o gate nao depende da convencao de nomenclatura
# `nycode-*` continuar sendo a mesma para sempre.
declare -A crate_names
while IFS= read -r dir; do
  crate_names["$(basename "${dir}")"]=1
done < <(find "${TARGET}/crates" -mindepth 1 -maxdepth 1 -type d)

declare -A actual

while IFS= read -r toml; do
  origem="$(basename "$(dirname "${toml}")")"
  while IFS= read -r linha; do
    destino="${linha%% *}"
    [[ -z "${destino}" || "${destino}" == "${origem}" ]] && continue
    [[ -n "${crate_names[${destino}]+x}" ]] || continue
    actual["${origem} -> ${destino}"]=1
  done < <(awk '/^\[dependencies\]/{flag=1;next}/^\[/{flag=0}flag' "${toml}")
done < <(find "${TARGET}/crates" -maxdepth 2 -name 'Cargo.toml' | sort)

failures=0

for edge in "${!actual[@]}"; do
  [[ -n "${allowed[${edge}]+x}" ]] && continue
  echo "  FALHA: ${edge} existe no Cargo.toml mas nao esta na allowlist" >&2
  failures=$((failures + 1))
done

for edge in "${!allowed[@]}"; do
  [[ -n "${actual[${edge}]+x}" ]] && continue
  echo "  FALHA: allowlist cita ${edge}, que nao existe mais (entrada obsoleta) — remova a linha" >&2
  failures=$((failures + 1))
done

if ((failures > 0)); then
  echo >&2
  echo "architecture-boundary-gate: ${failures} problema(s). Gate fecha." >&2
  exit 1
fi

echo "architecture-boundary-gate: o grafo de dependencia entre crates bate com a allowlist."

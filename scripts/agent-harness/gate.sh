#!/usr/bin/env bash
# Gate do harness de agente (ADR-0037).
#
# Reprova quando AGENTS.md passa do orcamento de bytes (com folga contra o
# teto default do Codex, 32768) ou do teto de linhas (alvo da doc do
# Claude Code), quando CLAUDE.md deixa de importar @AGENTS.md, ou quando
# o contrato cita um caminho relativo que nao existe na arvore.
#
# Uso:
#   scripts/agent-harness/gate.sh            # repositorio real
#   scripts/agent-harness/gate.sh <raiz>     # auto-teste

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly ROOT

# ADR-0037: 28 KiB (4096 de folga contra 32768) e 200 linhas.
readonly MAX_BYTES=28672
readonly MAX_LINES=200

TARGET="${1:-${ROOT}}"

if [[ ! -d "${TARGET}" ]]; then
  echo "agent-harness-gate: raiz nao encontrada: ${TARGET}" >&2
  exit 2
fi

failures=0

agents="${TARGET}/AGENTS.md"
claude="${TARGET}/CLAUDE.md"

if [[ ! -f "${agents}" ]]; then
  echo "  FALHA: AGENTS.md ausente em ${TARGET}" >&2
  failures=$((failures + 1))
else
  bytes="$(wc -c <"${agents}" | tr -d ' ')"
  lines="$(wc -l <"${agents}" | tr -d ' ')"
  if ((bytes > MAX_BYTES)); then
    echo "  FALHA: AGENTS.md tem ${bytes} bytes; orcamento e ${MAX_BYTES} (folga contra 32768 do Codex)" >&2
    failures=$((failures + 1))
  fi
  if ((lines > MAX_LINES)); then
    echo "  FALHA: AGENTS.md tem ${lines} linhas; teto e ${MAX_LINES}" >&2
    failures=$((failures + 1))
  fi
fi

if [[ ! -f "${claude}" ]]; then
  echo "  FALHA: CLAUDE.md ausente em ${TARGET}" >&2
  failures=$((failures + 1))
elif ! grep -q '@AGENTS.md' "${claude}"; then
  echo "  FALHA: CLAUDE.md nao importa @AGENTS.md" >&2
  failures=$((failures + 1))
fi

# Links markdown relativos e caminhos entre backticks com barra.
cited_paths() {
  local file="$1"
  [[ -f "${file}" ]] || return 0
  python3 - "${file}" <<'PY'
import re, sys
text = open(sys.argv[1], encoding="utf-8").read()
seen = []
def add(p):
    p = p.strip()
    if not p or p.startswith(("#", "http://", "https://", "mailto:")):
        return
    p = p.split("#", 1)[0].rstrip("/")
    if not p or p in seen:
        return
    seen.append(p)
    print(p)
for m in re.finditer(r"\[[^\]]*\]\(([^)]+)\)", text):
    add(m.group(1))
for m in re.finditer(r"`(\.?[A-Za-z0-9_./-]+/[A-Za-z0-9_./-]*)`", text):
    add(m.group(1))
PY
}

declare -A visto=()
while IFS= read -r rel || [[ -n "${rel}" ]]; do
  [[ -z "${rel}" ]] && continue
  [[ -n "${visto[${rel}]+x}" ]] && continue
  visto["${rel}"]=1
  if [[ ! -e "${TARGET}/${rel}" ]]; then
    echo "  FALHA: contrato cita ${rel}, que nao existe" >&2
    failures=$((failures + 1))
  fi
done < <(
  cited_paths "${agents}"
  cited_paths "${claude}"
)

adapters="${ROOT}/scripts/agent-harness/gen-adapters.sh"
if [[ "${TARGET}" == "${ROOT}" && -f "${adapters}" ]]; then
  if ! bash "${adapters}" --check >/dev/null; then
    echo "  FALHA: adaptadores gerados desatualizados (scripts/agent-harness/gen-adapters.sh --check)" >&2
    failures=$((failures + 1))
  fi
fi

if ((failures > 0)); then
  echo >&2
  echo "agent-harness-gate: ${failures} problema(s). Gate fecha." >&2
  exit 1
fi

echo "agent-harness-gate: orcamento, import e caminhos citados ok."

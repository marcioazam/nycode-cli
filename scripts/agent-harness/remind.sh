#!/usr/bin/env bash
# Re-injeta as proibicoes curtas a cada turno (ADR-0038).
# Claude e Codex: UserPromptSubmit. Cursor: sessionStart (assimetria declarada).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
if [[ -n "${CLAUDE_PROJECT_DIR:-}" ]]; then
  ROOT="${CLAUDE_PROJECT_DIR}"
fi
readonly ROOT
readonly REG="${ROOT}/scripts/agent-harness/forbidden.txt"

input="{}"
if [[ ! -t 0 ]]; then
  input="$(cat || true)"
  [[ -z "${input}" ]] && input="{}"
fi

event="$(printf '%s' "${input}" | python3 -c 'import json,sys
try:
    d=json.load(sys.stdin)
except Exception:
    d={}
print(d.get("hook_event_name") or d.get("hookEventName") or "")')"

lista=""
if [[ -f "${REG}" ]]; then
  lista="$(awk -F'|' '
    /^[[:space:]]*#/ {next}
    NF>=4 {
      id=$1; gsub(/^[[:space:]]+|[[:space:]]+$/,"",id)
      razao=$4; gsub(/^[[:space:]]+|[[:space:]]+$/,"",razao)
      printf "- %s: %s\n", id, razao
    }
  ' "${REG}")"
fi

text="Proibicoes mecanicas deste repo (nao sao pedido, sao veto):
${lista}
Verde = scripts/ci-local.sh --full. Nao use --no-verify."

if [[ "${event}" == sessionStart ]]; then
  python3 -c 'import json,sys; print(json.dumps({"additional_context": sys.argv[1]}))' "${text}"
  exit 0
fi

python3 -c 'import json,sys; print(json.dumps({
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": sys.argv[1]
  }
}))' "${text}"

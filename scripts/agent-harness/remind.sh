#!/usr/bin/env bash
# Re-injeta as proibicoes curtas a cada turno (ADR-0038).
# Claude e Codex: UserPromptSubmit. Cursor: sessionStart (assimetria declarada).
# Hook: falha aberta se o ambiente nao da para lembrar (python3/registro).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
if [[ -n "${CLAUDE_PROJECT_DIR:-}" ]]; then
  ROOT="${CLAUDE_PROJECT_DIR}"
fi
readonly ROOT
readonly REG="${ROOT}/scripts/agent-harness/forbidden.txt"

if ! command -v python3 >/dev/null 2>&1; then
  echo "remind: python3 ausente; segue sem contexto extra." >&2
  exit 0
fi

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
  lista="$(
    python3 - "${REG}" <<'PY'
import sys
path = sys.argv[1]
for line in open(path, encoding="utf-8"):
    line = line.strip()
    if not line or line.startswith("#"):
        continue
    parts = [p.strip() for p in line.split(" | ")]
    if len(parts) != 5:
        continue
    print(f"- {parts[0]}: {parts[3]}")
PY
  )"
else
  echo "remind: registro ausente; segue sem lista." >&2
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

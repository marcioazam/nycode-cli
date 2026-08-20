#!/usr/bin/env bash
# Veto portatil no tool-call (ADR-0038). Exit 2 + stderr nas tres ferramentas.
# JSON extra por dialeto. Sem rede, sem escrita, so jq + o registro.
#
# Uso: stdin = JSON do hook.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
if [[ -n "${CLAUDE_PROJECT_DIR:-}" ]]; then
  ROOT="${CLAUDE_PROJECT_DIR}"
fi
readonly ROOT
readonly REG="${ROOT}/scripts/agent-harness/forbidden.txt"

if [[ ! -f "${REG}" ]]; then
  echo "veto: registro ausente: ${REG}" >&2
  exit 2
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "veto: jq e obrigatorio" >&2
  exit 2
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "veto: python3 e obrigatorio" >&2
  exit 2
fi

input=""
if [[ ! -t 0 ]]; then
  input="$(cat || true)"
fi
[[ -z "${input}" ]] && input="{}"

if ! jq -e . >/dev/null 2>&1 <<<"${input}"; then
  echo "veto: JSON do hook ilegivel" >&2
  exit 2
fi

event="$(jq -r '.hook_event_name // .hookEventName // .event // ""' <<<"${input}")"
tool="$(jq -r '.tool_name // .toolName // .tool // ""' <<<"${input}")"
command="$(jq -r '
  .tool_input.command
  // .tool_input.cmd
  // .input.command
  // .input.cmd
  // .command
  // .command_line
  // ""
' <<<"${input}")"
path="$(jq -r '
  .tool_input.file_path
  // .tool_input.path
  // .input.file_path
  // .input.path
  // .file_path
  // .path
  // ""
' <<<"${input}")"

glob_match() {
  local pat="$1" text="$2"
  python3 -c 'import fnmatch, sys
pat, text = sys.argv[1], sys.argv[2]
cands = [pat]
if not pat.startswith("*"):
    cands.append("*" + pat)
if not pat.endswith("*"):
    cands.append(pat + "*")
    if not pat.startswith("*"):
        cands.append("*" + pat + "*")
sys.exit(0 if any(fnmatch.fnmatch(text, c) for c in cands) else 1)
' "${pat}" "${text}"
}

cursor=0
if [[ "${event}" == beforeShellExecution || "${event}" == beforeMCPExecution || "${event}" == preToolUse ]]; then
  cursor=1
fi
if [[ -z "${event}" && -n "$(jq -r '.command // empty' <<<"${input}")" && -z "${tool}" ]]; then
  cursor=1
fi

reg_tmp="$(mktemp)"
if ! python3 - "${REG}" >"${reg_tmp}" <<'PY'; then
import sys
path = sys.argv[1]
for line in open(path, encoding="utf-8"):
    line = line.strip()
    if not line or line.startswith("#"):
        continue
    parts = [p.strip() for p in line.split(" | ")]
    if len(parts) != 5:
        raise SystemExit(f"veto: linha deve ter cinco campos separados por ' | ': {line}")
    print("\t".join(parts))
PY
  rm -f -- "${reg_tmp}"
  echo "veto: registro ilegivel: ${REG}" >&2
  exit 2
fi

hit_id=""
hit_reason=""
while IFS=$'\t' read -r id ferramenta padrao razao regra || [[ -n "${id:-}" ]]; do
  [[ -z "${id:-}" ]] && continue
  case "${ferramenta}" in
  bash)
    [[ -z "${command}" ]] && continue
    if glob_match "${padrao}" "${command}"; then
      hit_id="${id}"
      hit_reason="${razao} (${regra})"
      break
    fi
    ;;
  write)
    [[ -z "${path}" ]] && continue
    base="$(basename "${path}")"
    if glob_match "${padrao}" "${path}" || glob_match "${padrao}" "${base}"; then
      hit_id="${id}"
      hit_reason="${razao} (${regra})"
      break
    fi
    ;;
  read)
    [[ -z "${path}" ]] && continue
    base="$(basename "${path}")"
    if glob_match "${padrao}" "${path}" || glob_match "${padrao}" "${base}"; then
      hit_id="${id}"
      hit_reason="${razao} (${regra})"
      break
    fi
    ;;
  esac
done <"${reg_tmp}"
rm -f -- "${reg_tmp}"

if [[ -z "${hit_id}" ]]; then
  if [[ "${cursor}" -eq 1 ]]; then
    echo '{"permission":"allow"}'
  fi
  exit 0
fi

msg="veto: ${hit_id}: ${hit_reason}"
echo "${msg}" >&2

if [[ "${cursor}" -eq 1 ]]; then
  jq -n --arg r "${msg}" '{permission:"deny", agentMessage:$r}'
  exit 2
fi

jq -n --arg r "${msg}" '{
  hookSpecificOutput: {
    permissionDecision: "deny",
    permissionDecisionReason: $r
  },
  decision: "deny",
  reason: $r
}'
exit 2

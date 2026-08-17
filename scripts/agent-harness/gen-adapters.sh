#!/usr/bin/env bash
# Gera adaptadores de proibicao a partir de forbidden.txt.
# Gerado, nunca editado a mao. --check reprova se o commitado divergiu.
#
# Uso:
#   scripts/agent-harness/gen-adapters.sh
#   scripts/agent-harness/gen-adapters.sh --check

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly ROOT
readonly REG="${ROOT}/scripts/agent-harness/forbidden.txt"
readonly CHECK="${1:-}"

if [[ ! -f "${REG}" ]]; then
  echo "gen-adapters: registro nao encontrado: ${REG}" >&2
  exit 2
fi

python3 - "${ROOT}" "${REG}" "${CHECK}" <<'PY'
import json, pathlib, re, sys, tempfile, os

root = pathlib.Path(sys.argv[1])
reg = pathlib.Path(sys.argv[2])
check = sys.argv[3] == "--check"

def parse():
    rows = []
    for line in reg.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = [p.strip() for p in line.split(" | ")]
        if len(parts) != 5:
            raise SystemExit(f"gen-adapters: linha deve ter cinco campos separados por ' | ': {line}")
        rows.append({"id": parts[0], "tool": parts[1], "pattern": parts[2],
                     "reason": parts[3], "rule": parts[4]})
    return rows

rows = parse()
header = "gerado por scripts/agent-harness/gen-adapters.sh; nao edite"

def claude_deny(row):
    p = row["pattern"]
    if row["tool"] == "bash":
        return f"Bash({p})"
    if row["tool"] == "write":
        return f"Write({p})"
    if row["tool"] == "read":
        return f"Read({p})"
    raise SystemExit(f"ferramenta desconhecida: {row['tool']}")

settings = {
    "permissions": {"deny": [claude_deny(r) for r in rows]},
    "hooks": {
        "PreToolUse": [{"hooks": [{"type": "command",
            "command": "bash \"$CLAUDE_PROJECT_DIR\"/scripts/agent-harness/veto.sh"}]}],
        "UserPromptSubmit": [{"hooks": [{"type": "command",
            "command": "bash \"$CLAUDE_PROJECT_DIR\"/scripts/agent-harness/remind.sh"}]}],
        "Stop": [{"hooks": [{"type": "command",
            "command": "bash \"$CLAUDE_PROJECT_DIR\"/scripts/agent-stop/verify.sh",
            "timeout": 180}]}],
    },
}

perm_bash = {"*": "allow"}
perm_edit = {}
perm_read = {}
for r in rows:
    if r["tool"] == "bash":
        perm_bash[r["pattern"]] = "deny"
    elif r["tool"] == "write":
        perm_edit[r["pattern"]] = "deny"
    elif r["tool"] == "read":
        perm_read[r["pattern"]] = "deny"

opencode = {
    "$comment": header,
    "permission": {
        "bash": perm_bash,
        "edit": perm_edit,
        "read": perm_read,
    },
}

def starlark_string(s):
    return json.dumps(s, ensure_ascii=False)

rules = [f"# {header}", ""]
for r in rows:
    if r["tool"] != "bash":
        rules.append(f"# {r['id']}: {r['tool']} {r['pattern']} — so veto.sh (nao e argv)")
        continue
    tokens = [t for t in r["pattern"].replace("*", " ").split() if t]
    if not tokens:
        continue
    pat = ", ".join(starlark_string(t) for t in tokens)
    just = starlark_string(r["reason"] + " (" + r["rule"] + ")")
    rules.append("prefix_rule(")
    rules.append(f"  pattern = [{pat}],")
    rules.append('  decision = "forbidden",')
    rules.append(f"  justification = {just},")
    rules.append(")")
    rules.append("")

targets = {
    root / ".claude" / "settings.json": json.dumps(settings, indent=2, ensure_ascii=False) + "\n",
    root / "opencode.json": json.dumps(opencode, indent=2, ensure_ascii=False) + "\n",
    root / ".codex" / "rules" / "nycode.rules": "\n".join(rules).rstrip() + "\n",
}

failed = 0
for path, body in targets.items():
    if check:
        if not path.is_file() or path.read_text(encoding="utf-8") != body:
            print(f"  FALHA: {path.relative_to(root)} desatualizado", file=sys.stderr)
            failed += 1
        continue
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body, encoding="utf-8")
    print(f"gen-adapters: escreveu {path.relative_to(root)}")

if check:
    if failed:
        print(f"gen-adapters: {failed} arquivo(s) divergente(s). Rode sem --check.", file=sys.stderr)
        sys.exit(1)
    print("gen-adapters: adaptadores em dia.")
PY

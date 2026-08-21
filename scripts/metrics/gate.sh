#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${HERE}/../.." && pwd)"
readonly HERE ROOT

PASS_DIR="${1:-${HERE}/fixtures/pass}"
FAIL_DIR="${2:-${HERE}/fixtures/fail}"

export METRICS_PASS_DIR="${PASS_DIR}"
export METRICS_FAIL_DIR="${FAIL_DIR}"

python3 - <<'PY'
import json
import os
import sys
from pathlib import Path

BANNED = {"loc", "locs", "lines_of_code", "line_count", "commit", "commits", "commit_count"}

def banned_keys(node, found):
    if isinstance(node, dict):
        for key, value in node.items():
            if key.lower() in BANNED:
                found.append(key)
            banned_keys(value, found)
    elif isinstance(node, list):
        for item in node:
            banned_keys(item, found)

def has_origin_split(node):
    origin = node.get("origin")
    if not isinstance(origin, dict):
        return False
    human = origin.get("human")
    agent = origin.get("agent")
    return isinstance(human, dict) and isinstance(agent, dict)

def evaluate(node):
    found = []
    banned_keys(node, found)
    if found:
        return False, "produtividade por loc/commit"
    if not has_origin_split(node):
        return False, "sem split humano/agente"
    return True, "ok"

pass_dir = Path(os.environ["METRICS_PASS_DIR"])
fail_dir = Path(os.environ["METRICS_FAIL_DIR"])
pass_files = sorted(pass_dir.glob("*.json")) if pass_dir.is_dir() else []
fail_files = sorted(fail_dir.glob("*.json")) if fail_dir.is_dir() else []
if not pass_files or not fail_files:
    print("metrics-gate: fixtures pass e fail sao obrigatorias", file=sys.stderr)
    sys.exit(1)

failures = 0
for path in pass_files:
    node = json.loads(path.read_text(encoding="utf-8"))
    ok, reason = evaluate(node)
    if not ok:
        print(f"metrics-gate: fixture valida recusada ({reason}): {path}", file=sys.stderr)
        failures += 1
for path in fail_files:
    node = json.loads(path.read_text(encoding="utf-8"))
    ok, _reason = evaluate(node)
    if ok:
        print(f"metrics-gate: fixture invalida aceita: {path}", file=sys.stderr)
        failures += 1
if failures:
    sys.exit(1)
print("metrics-gate: relatorio partido por origem, sem loc/commit como produtividade")
PY

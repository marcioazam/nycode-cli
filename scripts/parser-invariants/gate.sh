#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${HERE}/../.." && pwd)"
readonly HERE ROOT

REGISTRY="${PARSER_INVARIANTS_REGISTRY:-${HERE}/registry.txt}"
SCAN_ROOT="${PARSER_INVARIANTS_ROOT:-${ROOT}}"

if [[ ! -f "${REGISTRY}" ]]; then
  echo "parser-invariants-gate: registro inexistente: ${REGISTRY}" >&2
  exit 2
fi

export PARSER_INVARIANTS_REGISTRY="${REGISTRY}"
export PARSER_INVARIANTS_ROOT="${SCAN_ROOT}"
export PARSER_INVARIANTS_CHANGED="${PARSER_INVARIANTS_CHANGED:-}"
export PARSER_INVARIANTS_BASE="${PARSER_INVARIANTS_BASE:-origin/main}"

python3 - <<'PY'
import os
import subprocess
import sys
from pathlib import Path

def listed(path: Path) -> list[str]:
    lines = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        lines.append(line)
    return lines

def changed_files() -> list[str]:
    planted = os.environ.get("PARSER_INVARIANTS_CHANGED", "")
    if planted != "":
        return [p.strip() for p in planted.splitlines() if p.strip()]
    base = os.environ["PARSER_INVARIANTS_BASE"]
    probed = subprocess.run(
        ["git", "rev-parse", "--verify", "--quiet", base],
        capture_output=True,
        check=False,
    )
    if probed.returncode != 0:
        print(f"parser-invariants-gate: base ausente: {base}", file=sys.stderr)
        sys.exit(2)
    try:
        out = subprocess.check_output(
            ["git", "diff", "--name-only", f"{base}...HEAD"],
            text=True,
        )
    except subprocess.CalledProcessError as err:
        print(f"parser-invariants-gate: git diff falhou: {err}", file=sys.stderr)
        sys.exit(2)
    return [p for p in out.splitlines() if p]

root = Path(os.environ["PARSER_INVARIANTS_ROOT"])
registry = listed(Path(os.environ["PARSER_INVARIANTS_REGISTRY"]))
changed = set(changed_files())
missing = []

def has_proptest(path: Path) -> bool:
    if not path.is_file():
        return False
    return "proptest!" in path.read_text(encoding="utf-8")

for rel in registry:
    if rel not in changed:
        continue
    src = root / rel
    if not src.is_file():
        continue
    sibling = src.with_name(src.stem + "_test.rs")
    if has_proptest(src) or has_proptest(sibling):
        continue
    missing.append(rel)

if missing:
    print("parser-invariants-gate: parser no diff sem proptest:", file=sys.stderr)
    for rel in missing:
        print(f"  {rel}", file=sys.stderr)
    sys.exit(1)
sys.exit(0)
PY

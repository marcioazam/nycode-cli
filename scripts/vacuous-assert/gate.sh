#!/usr/bin/env bash
set -euo pipefail

scan_dir=""
if [[ "${1:-}" != "" ]]; then
  scan_dir="$1"
  if [[ ! -d "${scan_dir}" ]]; then
    echo "vacuous-assert-gate: raiz inexistente: ${scan_dir}" >&2
    exit 2
  fi
fi

export VACUOUS_SCAN_DIR="${scan_dir}"
python3 - <<'PY'
import os
import re
import subprocess
import sys
from pathlib import Path

def compact(line: str) -> str:
    return "".join(line.split())

def is_vacuous_line(line: str) -> bool:
    c = compact(line)
    if c in {"assert!(true);", "assert_eq!((),());"}:
        return True
    if c.startswith("assert!(!") or not c.startswith("assert!("):
        return False
    return bool(
        re.fullmatch(
            r"assert!\([A-Za-z_][A-Za-z0-9_]*\.is_(ok|some|none|err|empty)\(\)\);",
            c,
        )
    )

scan_dir = os.environ.get("VACUOUS_SCAN_DIR", "")
files = []
if scan_dir:
    files = list(Path(scan_dir).rglob("*.rs"))
else:
    base = os.environ.get("VACUOUS_BASE", "origin/main")
    try:
        out = subprocess.check_output(
            ["git", "diff", "--name-only", f"{base}...HEAD", "--", "*.rs"],
            text=True,
        )
    except subprocess.CalledProcessError as err:
        print(f"vacuous-assert-gate: git diff falhou: {err}", file=sys.stderr)
        sys.exit(2)
    files = [Path(p) for p in out.splitlines() if p.endswith(".rs") and Path(p).is_file()]

hits = []
for path in files:
    text = path.read_text(encoding="utf-8")
    if "#[test]" not in text:
        continue
    for i, line in enumerate(text.splitlines(), 1):
        if is_vacuous_line(line):
            hits.append(f"{path}:{i}: {line.strip()}")

if hits:
    print("vacuous-assert-gate: assercoes vacuous:", file=sys.stderr)
    for h in hits:
        print(f"  {h}", file=sys.stderr)
    sys.exit(1)
sys.exit(0)
PY

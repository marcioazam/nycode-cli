#!/usr/bin/env python3
"""Size limits for files changed by a PR: <= 800 lines per code file and <= 7 direct code
files in each directory that holds a changed code file. Legacy elsewhere never blocks.

Usage: changed-files.sh | structure_changed.py [--root DIR]
Code suffixes come from claude-home/bin/structure/structure.py (single owner of the list).
"""

from __future__ import annotations

import argparse
import importlib.util
import sys
from pathlib import Path

MAX_LINES = 800
MAX_FILES = 7


def load_suffixes(root: Path) -> frozenset[str]:
    spec_path = root / "claude-home/bin/structure/structure.py"
    spec = importlib.util.spec_from_file_location("pi_structure", spec_path)
    if spec is None or spec.loader is None:
        raise SystemExit(f"structure_changed: cannot load {spec_path}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return frozenset(mod.CODE_SUFFIXES)


def is_code(path: Path, suffixes: frozenset[str]) -> bool:
    return path.suffix in suffixes and not path.is_symlink()


def check(root: Path, changed: list[str], suffixes: frozenset[str]) -> list[str]:
    problems: list[str] = []
    dirs: set[Path] = set()
    for rel in changed:
        path = root / rel
        if not path.is_file() or not is_code(path, suffixes):
            continue
        dirs.add(path.parent)
        lines = len(path.read_text(encoding="utf-8", errors="replace").splitlines())
        if lines > MAX_LINES:
            problems.append(f"{rel}: {lines} lines > {MAX_LINES}")
    for directory in sorted(dirs):
        n = sum(1 for p in directory.iterdir() if p.is_file() and is_code(p, suffixes))
        if n > MAX_FILES:
            problems.append(
                f"{directory.relative_to(root)}/: {n} code files > {MAX_FILES}"
            )
    return problems


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=".")
    args = ap.parse_args()
    root = Path(args.root).resolve()
    changed = [line.strip() for line in sys.stdin if line.strip()]
    problems = check(root, changed, load_suffixes(root))
    for p in problems:
        print(p)
    print(f"structure_changed: {len(changed)} changed files, {len(problems)} problems")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())

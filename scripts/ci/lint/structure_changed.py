#!/usr/bin/env python3
"""Size limits for files changed by a PR: <= 800 lines per code file and <= 7 direct code
files in each directory that holds a changed code file. Legacy elsewhere never blocks.

The limits bind only what nycode creates (OWN_PREFIXES, AGENTS.md and the migration plan,
02 section 9); the rest of the fork is upstream code. Upstream files above 800 lines are
listed in structure-upstream.txt and stay exempt.

Usage: changed-files.sh | structure_changed.py [--root DIR]
Code suffixes come from scripts/harness/structure/structure.py (single owner of the list)
once it exists (F8); until then DEFAULT_SUFFIXES, a copy of the list it will carry.
"""

from __future__ import annotations

import argparse
import importlib.util
import sys
from pathlib import Path

MAX_LINES = 800
MAX_FILES = 7
HARNESS_STRUCTURE = "scripts/harness/structure/structure.py"
UPSTREAM_LIST = Path(__file__).with_name("structure-upstream.txt")
OWN_PREFIXES = (
    "packages/coding-agent/src/extensions/",
    "packages/coding-agent/src/core/permissions/",
    "packages/coding-agent/src/migrations/",
    "packages/coding-agent/resources/",
    "packages/coding-agent/test/harness/",
    "scripts/ci/",
    "scripts/harness/",
    "bench/",
)
DEFAULT_SUFFIXES = frozenset(
    {
        ".py",
        ".pyi",
        ".js",
        ".jsx",
        ".mjs",
        ".cjs",
        ".ts",
        ".tsx",
        ".mts",
        ".cts",
        ".rs",
        ".go",
        ".c",
        ".h",
        ".cpp",
        ".hpp",
        ".cc",
        ".cxx",
        ".cs",
        ".java",
        ".kt",
        ".kts",
        ".swift",
        ".dart",
        ".rb",
        ".php",
        ".sh",
        ".bash",
        ".zsh",
        ".fish",
        ".lua",
        ".pl",
        ".pm",
        ".r",
        ".R",
        ".sql",
        ".vue",
        ".svelte",
        ".astro",
        ".scala",
        ".sc",
        ".ex",
        ".exs",
        ".erl",
        ".hrl",
        ".hs",
        ".clj",
        ".cljs",
        ".cljc",
        ".fs",
        ".fsx",
        ".f90",
        ".f",
        ".jl",
        ".nim",
        ".zig",
        ".ps1",
        ".bat",
        ".cmd",
        ".awk",
        ".sed",
        ".html",
        ".css",
        ".scss",
        ".sass",
        ".less",
        ".graphql",
        ".gql",
        ".proto",
        ".rules",
    }
)


def load_upstream(path: Path = UPSTREAM_LIST) -> frozenset[str]:
    """Return the upstream files exempt from the line limit (one path per line)."""
    lines = (ln.split("#", 1)[0].strip() for ln in path.read_text().splitlines())
    return frozenset(ln for ln in lines if ln)


def load_suffixes(root: Path) -> frozenset[str]:
    spec_path = root / HARNESS_STRUCTURE
    if not spec_path.is_file():
        return DEFAULT_SUFFIXES
    spec = importlib.util.spec_from_file_location("harness_structure", spec_path)
    if spec is None or spec.loader is None:
        raise SystemExit(f"structure_changed: cannot load {spec_path}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return frozenset(mod.CODE_SUFFIXES)


def is_code(path: Path, suffixes: frozenset[str]) -> bool:
    return path.suffix in suffixes and not path.is_symlink()


def check(
    root: Path,
    changed: list[str],
    suffixes: frozenset[str],
    upstream: frozenset[str] = frozenset(),
    prefixes: tuple[str, ...] = ("",),
) -> list[str]:
    problems: list[str] = []
    dirs: set[Path] = set()
    for rel in changed:
        path = root / rel
        if not rel.startswith(prefixes) or not path.is_file():
            continue
        if not is_code(path, suffixes):
            continue
        if rel in upstream:
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
    problems = check(root, changed, load_suffixes(root), load_upstream(), OWN_PREFIXES)
    for p in problems:
        print(p)
    print(f"structure_changed: {len(changed)} changed files, {len(problems)} problems")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())

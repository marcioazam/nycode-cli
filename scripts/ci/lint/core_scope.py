#!/usr/bin/env python3
"""Check docs/specs/0005-core-scope.md against the shipped pieces: every skill, agent, extension,
hook, command and plugin has exactly one table row with a valid class, and no row is stale.

A type with no shipped piece yet is not compared for stale rows: the pieces arrive in F5-F8 and
their rows already exist. The first piece of a type turns the stale check on for that type; a
piece without a row is always a finding.

Usage: core_scope.py [--root DIR]   (default: repository root)
Exit 0 clean, 1 findings, 2 spec unreadable or malformed.
"""

from __future__ import annotations

import argparse
import sys
from collections import Counter
from pathlib import Path

SPEC = Path("docs/specs/0005-core-scope.md")
BEGIN, END = "<!-- core-scope:begin -->", "<!-- core-scope:end -->"
TYPES = ("skill", "agent", "extension", "hook", "command", "plugin")
CLASSES = ("core", "ui", "optional", "remove")
RESOURCES = Path("packages/coding-agent/resources")
EXTENSIONS = Path("packages/coding-agent/src/extensions")
EXT_SKIP = {"test", "tests", "node_modules"}
# Extensions and the registry the fork had before the harness: not pieces of the 0005 table.
EXT_NATIVE = {"index", "codemode", "llama", "mcp", "tool-search"}
# A directory starting with "_" is a shared library the extensions import (`_shared`, 03 §3.2), never registered.
EXT_LIBRARY_PREFIX = "_"
HOOK_SKIP = ("test_", "fixtures", "__pycache__", ".")

Piece = tuple[str, str]


class SpecError(Exception):
    """The spec table is missing or malformed."""


def _children(d: Path) -> list[Path]:
    return sorted(d.iterdir()) if d.is_dir() else []


def discover(root: Path) -> set[Piece]:
    """Return the (type, name) pairs of the shipped pieces under root."""
    home = root / RESOURCES
    found: set[Piece] = set()
    for p in _children(home / "skills"):
        if (p / "SKILL.md").is_file():
            found.add(("skill", p.name))
    for p in _children(home / "agents"):
        if p.suffix == ".md":
            found.add(("agent", p.stem))
    for p in _children(root / EXTENSIONS):
        if (
            p.name.startswith((".", EXT_LIBRARY_PREFIX))
            or p.name in EXT_SKIP
            or p.name.endswith(".test.ts")
        ):
            continue
        if p.is_dir() and p.name not in EXT_NATIVE:
            found.add(("extension", p.name))
        elif p.suffix == ".ts" and p.stem not in EXT_NATIVE:
            found.add(("extension", p.stem))
    for p in _children(home / "hooks"):
        if not p.name.startswith(HOOK_SKIP):
            found.add(("hook", p.name))
    for p in _children(home / "commands"):
        if p.suffix == ".md":
            found.add(("command", p.stem))
    for p in _children(home / "plugins"):
        if p.is_dir():
            found.add(("plugin", p.name))
    return found


def parse_table(text: str) -> list[tuple[str, str, str]]:
    """Return (type, name, class) rows between the markers."""
    if BEGIN not in text or END not in text or text.index(BEGIN) > text.index(END):
        raise SpecError(f"core-scope markers not found: {BEGIN} ... {END}")
    block = text.split(BEGIN, 1)[1].split(END, 1)[0]
    rows: list[tuple[str, str, str]] = []
    for line in block.splitlines():
        line = line.strip()
        if not line:
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if cells[0] == "Tipo" or set(line) <= set("|-: "):
            continue
        if len(cells) != 4 or not line.startswith("|") or not all(cells[:3]):
            raise SpecError(f"malformed row: {line}")
        rows.append((cells[0], cells[1], cells[2]))
    return rows


def compare(found: set[Piece], rows: list[tuple[str, str, str]]) -> list[str]:
    """Return sorted findings for pieces and rows that disagree."""
    out: list[str] = []
    for (typ, name), n in Counter((t, m) for t, m, _ in rows).items():
        if n > 1:
            out.append(f"duplicate: {typ} {name}")
    for typ, name, cls in rows:
        if typ not in TYPES:
            out.append(f"unknown type: {typ} {name}")
        if cls not in CLASSES:
            out.append(f"unknown class: {typ} {name} {cls}")
    listed = {(t, m) for t, m, _ in rows}
    out += [f"missing: {t} {m}" for t, m in found - listed]
    present = {t for t, _ in found}
    out += [f"stale: {t} {m}" for t, m in listed - found if t in present]
    return sorted(out)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[3])
    root: Path = ap.parse_args(argv).root
    try:
        text = (root / SPEC).read_text(encoding="utf-8")
    except OSError as e:
        print(f"core-scope: cannot read spec: {e}", file=sys.stderr)
        return 2
    try:
        rows = parse_table(text)
    except SpecError as e:
        print(f"core-scope: {e}", file=sys.stderr)
        return 2
    findings = compare(discover(root), rows)
    if findings:
        print("\n".join(findings), file=sys.stderr)
        return 1
    n = Counter(c for _, _, c in rows)
    print(
        f"core-scope OK: {len(rows)} pieces (core {n['core']}, ui {n['ui']}, "
        f"optional {n['optional']}, remove {n['remove']})"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Lint SKILL.md files: kebab-case name (1-64) equal to the directory, description 20-1024 chars,
at most 500 lines, no obvious secret; fails when no skill is found.

Usage: skill_lint.py [SKILLS_DIR ...]   (default: claude-home/skills)
Exit 0 clean, 1 findings or zero skills, 2 usage error.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import yaml

NAME_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
FRONTMATTER_RE = re.compile(r"\A---\n(.*?)\n---\n", re.DOTALL)
SECRET_RES = (
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"\bgh[pousr]_[A-Za-z0-9]{36,}\b"),
    re.compile(r"\bsk-[A-Za-z0-9_-]{32,}\b"),
)
MAX_LINES = 500
DESC_MIN, DESC_MAX = 20, 1024
NAME_MAX = 64


def lint_skill(path: Path) -> list[str]:
    """Return one message per problem in a single SKILL.md."""
    problems: list[str] = []
    text = path.read_text(encoding="utf-8")
    lines = text.count("\n") + (0 if text.endswith("\n") or not text else 1)
    if lines > MAX_LINES:
        problems.append(f"{lines} lines > {MAX_LINES}")
    match = FRONTMATTER_RE.match(text)
    if not match:
        return problems + ["missing frontmatter"]
    try:
        meta = yaml.safe_load(match.group(1))
    except yaml.YAMLError as exc:
        return problems + [f"invalid frontmatter YAML: {exc}"]
    if not isinstance(meta, dict):
        return problems + ["frontmatter is not a mapping"]
    name = meta.get("name")
    if not isinstance(name, str) or not name:
        problems.append("name missing")
    else:
        if not NAME_RE.match(name) or len(name) > NAME_MAX:
            problems.append(f"name {name!r} is not kebab-case of 1-{NAME_MAX} chars")
        if name != path.parent.name:
            problems.append(
                f"name {name!r} differs from directory {path.parent.name!r}"
            )
    desc = meta.get("description")
    if not isinstance(desc, str):
        problems.append("description missing or not a string")
    elif not DESC_MIN <= len(desc.strip()) <= DESC_MAX:
        problems.append(
            f"description has {len(desc.strip())} chars, expected {DESC_MIN}-{DESC_MAX}"
        )
    for rx in SECRET_RES:
        if rx.search(text):
            problems.append(f"possible secret matching {rx.pattern[:24]}")
    return problems


def lint_roots(roots: list[Path]) -> tuple[int, list[str]]:
    """Return (skills found, findings as 'path: message')."""
    found = 0
    findings: list[str] = []
    for root in roots:
        for skill in sorted(root.glob("*/SKILL.md")):
            found += 1
            findings += [f"{skill}: {p}" for p in lint_skill(skill)]
    return found, findings


def main(argv: list[str]) -> int:
    roots = [Path(a) for a in argv] or [Path("claude-home/skills")]
    found, findings = lint_roots(roots)
    for line in findings:
        print(line)
    if found == 0:
        print(
            "skill_lint: no SKILL.md found in " + ", ".join(map(str, roots)),
            file=sys.stderr,
        )
        return 1
    print(f"skill_lint: {found} skills, {len(findings)} problems")
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

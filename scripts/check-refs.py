#!/usr/bin/env python3
"""Report skills, agents and repo-local paths cited by shipped files that the repo does not contain.

A reference passes when the target exists in the repo, its line or bullet is marked optional,
or it is listed in scripts/refs-allow.txt. Output: path:line: missing <kind> <name>; exit 1 on any.
"""

import re
import sys
from collections.abc import Iterator
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RES = "packages/coding-agent/resources"
SCAN = (RES, "packages/coding-agent/src/extensions", "scripts/harness", "docs")
SKIP_PARTS = ("__pycache__", "node_modules", ".git")
# docs/migration/: the plan cites ny-pi paths and targets that do not exist yet; docs/specs/: historical specs.
SKIP_PREFIX = ("docs/specs/", "docs/migration/", f"{RES}/hooks/fixtures/")
TEST_FILE = (
    re.compile(  # tests cite synthetic names; patches are third-party diff context
        r"(^|/)(tests?/|test_[^/]*$|[^/]*\.test\.[a-z]+$)|\.patch$"
    )
)
MAX_BYTES = 2_000_000
NAME = r"[a-z][a-z0-9]*(?:-[a-z0-9]+)+"  # hyphenated: single words are too ambiguous in prose
OPTIONAL = re.compile(r"\(optional\)|optional:", re.IGNORECASE)

SKILL_PATTERNS = [
    re.compile(r"(?<![\w./-])skills/([a-z][a-z0-9-]*)/"),
    re.compile(r"(?<![\w-])skill:([a-z][a-z0-9-]*)"),
    re.compile(rf"`({NAME})` skills?\b"),
    re.compile(rf"\bskills? `({NAME})`"),
    re.compile(rf"\b[Ll]oad `({NAME})`"),
]
AGENT_PATTERNS = [
    re.compile(r"\bagent: *[\"']([A-Za-z][\w-]*)[\"']"),
    re.compile(r"\{agent: *([A-Za-z][\w-]*)\}"),
    re.compile(r"`([A-Za-z][\w-]*)` (?:agent|subagent)\b"),
]
# ${NYCODE_RESOURCES} is the marker the loader resolves to the embedded resources directory (02, section 6).
PATH_PATTERN = re.compile(
    r"(?:\$NYCODE_RESOURCES|\$\{NYCODE_RESOURCES\}|(?<![\w./-])"
    + re.escape(RES)
    + r")(/[^\s`'\")\]>,;|]*)?"
)
PLACEHOLDER = re.compile(r"[<*{$\[]")


def load_allow(path: Path) -> set[str]:
    names: set[str] = set()
    if path.is_file():
        for raw in path.read_text(encoding="utf-8").splitlines():
            entry = raw.split("#", 1)[0].strip()
            if entry:
                names.add(entry)
    return names


def allowed(name: str, allow: set[str]) -> bool:
    """Exact entry, or a directory entry ending in '/' covering everything below it."""
    return name in allow or any(
        a.endswith("/") and (name + "/").startswith(a) for a in allow
    )


def shipped_files(root: Path) -> Iterator[tuple[str, list[str]]]:
    for top in SCAN:
        for p in sorted((root / top).rglob("*")):
            rel = p.relative_to(root).as_posix()
            if (
                not p.is_file()
                or p.is_symlink()
                or any(s in p.parts for s in SKIP_PARTS)
            ):
                continue
            if (
                rel.startswith(SKIP_PREFIX)
                or TEST_FILE.search(rel)
                or p.stat().st_size > MAX_BYTES
            ):
                continue
            try:
                yield rel, p.read_text(encoding="utf-8").splitlines()
            except (UnicodeDecodeError, OSError):
                continue


def bullet_marked(lines: list[str], i: int) -> bool:
    """True when the bullet or paragraph holding line i carries an optional marker."""

    def starts_item(k: int) -> bool:
        return bool(re.match(r"\s*([-*]|\d+\.) |\s*\|", lines[k]))

    lo = i
    while lo > 0 and lines[lo].strip() and not starts_item(lo):
        lo -= 1
    hi = i
    while hi + 1 < len(lines) and lines[hi + 1].strip() and not starts_item(hi + 1):
        hi += 1
    return any(OPTIONAL.search(lines[k]) for k in range(lo, hi + 1) if lines[k].strip())


def repo_path(match: re.Match[str]) -> str:
    """Map a matched marker+tail to a repo-relative path under the resources directory."""
    tail = match.group(1) or ""
    tail = re.sub(r":[\d-]+$", "", tail).rstrip(".:!?}")
    placeholder = PLACEHOLDER.search(tail)
    if placeholder:
        tail = tail[: placeholder.start()].rsplit("/", 1)[0]
    return "/".join(p for p in (RES, tail.strip("/")) if p)


def check_line(
    rel: str, lines: list[str], i: int, root: Path, allow: set[str]
) -> list[str]:
    line = lines[i]
    found: list[tuple[str, str]] = []
    for pat in SKILL_PATTERNS:
        for m in pat.finditer(line):
            name = m.group(1)
            if (root / RES / "skills" / name).is_dir():
                continue
            found.append(("skill", name))
    for pat in AGENT_PATTERNS:
        for m in pat.finditer(line):
            name = m.group(1)
            if not (root / RES / "agents" / f"{name}.md").is_file():
                found.append(("agent", name))
    for m in PATH_PATTERN.finditer(line):
        target = repo_path(m)
        if not (root / target).exists():
            found.append(("path", target))
    out = []
    for kind, name in dict.fromkeys(found):
        if allowed(name, allow) or bullet_marked(lines, i):
            continue
        out.append(f"{rel}:{i + 1}: missing {kind} {name}")
    return out


def check(root: Path) -> list[str]:
    allow = load_allow(root / "scripts/refs-allow.txt")
    problems: list[str] = []
    for rel, lines in shipped_files(root):
        for i in range(len(lines)):
            problems.extend(check_line(rel, lines, i, root, allow))
    return problems


def main() -> int:
    problems = check(ROOT)
    for line in problems:
        print(line)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())

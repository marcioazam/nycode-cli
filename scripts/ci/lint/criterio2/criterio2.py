#!/usr/bin/env python3
"""Global acceptance criterion 2 (docs/migration/ny-pi-core/00-mega-plano.md, section 8): the search for
leftovers of the ny-pi/pi harness comes back empty outside import/, docs/ and the declared exceptions.

The search (rg; git grep when rg is missing, said on stderr) uses the five literals in PATTERNS. Every hit
must be covered by a line of criterio2-allow.txt: `glob | pattern[,pattern] | class | reason`. The glob uses
fnmatch rules (`*` also crosses `/`), so one line covers a file or a directory; `**` is refused, and so is a
glob that starts with a wildcard. A line that covers no hit is stale and fails too: the list only shrinks.

Usage: criterio2.py [--root DIR] [--allow FILE]
Exit 0 clean, 1 findings (new hit or stale/invalid exception), 2 search or list unusable.
"""

from __future__ import annotations

import argparse
import fnmatch
import shutil
import subprocess
import sys
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

PATTERNS = (
    "patch -p1",
    "sed -i",
    "CLAUDE_CONFIG_DIR",
    "node_modules/pi-code",
    ".pi/agent",
)
# `-F` literals joined by newlines would also work; one ERE keeps rg and git grep in step with the plan text.
REGEX = r"patch -p1|sed -i|CLAUDE_CONFIG_DIR|node_modules/pi-code|\.pi/agent"
CLASSES = ("produto-externo", "upstream", "ferramenta-fork", "migracao")
# import/ goes away in F12; docs/ is the plan; the linter's own directory spells the patterns by design.
EXCLUDED = ("import", "docs", "scripts/ci/lint/criterio2")
ALLOW_FILE = Path(__file__).with_name("criterio2-allow.txt")
SHOW = 140


class SearchError(Exception):
    """No usable search tool, or the tool failed."""


@dataclass(frozen=True)
class Exemption:
    glob: str
    patterns: frozenset[str]
    cls: str
    reason: str
    line: int


@dataclass(frozen=True)
class Hit:
    path: str
    line: int
    text: str

    @property
    def patterns(self) -> frozenset[str]:
        return frozenset(p for p in PATTERNS if p in self.text)


def parse_allow(text: str) -> tuple[list[Exemption], list[str]]:
    """Return the exceptions and the problems found in the list itself."""
    found: list[Exemption] = []
    problems: list[str] = []
    for n, raw in enumerate(text.splitlines(), 1):
        row = raw.strip()
        if not row or row.startswith("#"):
            continue
        parts = [p.strip() for p in row.split(" | ", 3)]
        if len(parts) != 4 or not all(parts):
            problems.append(f"allow:{n}: expected `glob | patterns | class | reason`")
            continue
        glob, pats, cls, reason = parts
        wanted = frozenset(p.strip() for p in pats.split(","))
        if "**" in glob or glob[0] in "*?[":
            problems.append(
                f"allow:{n}: glob `{glob}` is too generic (no `**`, no leading wildcard)"
            )
        elif cls not in CLASSES:
            problems.append(
                f"allow:{n}: class `{cls}` is not one of {', '.join(CLASSES)}"
            )
        elif not wanted <= set(PATTERNS):
            problems.append(f"allow:{n}: unknown pattern in `{pats}`")
        else:
            found.append(Exemption(glob, wanted, cls, reason, n))
    return found, problems


def _run(cmd: list[str], root: Path) -> str:
    # stdin closed: rg reads a piped stdin (CI) instead of the tree when no path is given.
    done = subprocess.run(
        cmd,
        cwd=root,
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
        check=False,
    )
    if done.returncode not in (0, 1):  # 1 = no match, for rg and git grep alike
        raise SearchError(
            f"{cmd[0]} exited {done.returncode}: {done.stderr.strip()[:200]}"
        )
    return done.stdout


def search(root: Path) -> tuple[list[Hit], str]:
    """Run the search; return the hits and the tool that ran."""
    if shutil.which("rg"):
        tool = "rg"
        out = _run(
            [
                "rg",
                "-n",
                "--no-heading",
                "--color",
                "never",
                "-e",
                REGEX,
                *(a for d in EXCLUDED for a in ("--glob", f"!{d}/**")),
                "--",
                ".",
            ],
            root,
        )
    elif shutil.which("git"):
        # --no-index + --exclude-standard: the working tree minus .gitignore, like rg (no repository needed).
        tool = "git grep"
        out = _run(
            [
                "git",
                "grep",
                "--no-index",
                "--exclude-standard",
                "-nIE",
                REGEX,
                "--",
                ".",
                *(f":(exclude){d}" for d in EXCLUDED),
            ],
            root,
        )
    else:
        raise SearchError("neither rg nor git found")
    hits: list[Hit] = []
    for row in out.splitlines():
        path, _, rest = row.partition(":")
        num, _, text = rest.partition(":")
        if num.isdigit():
            hits.append(Hit(path.removeprefix("./"), int(num), text))
    return hits, tool


def check(
    hits: list[Hit], exemptions: list[Exemption]
) -> tuple[list[Hit], set[tuple[int, str]], Counter[str]]:
    """Return the uncovered hits, the (exception line, pattern) pairs used and the covered lines per class."""
    bad: list[Hit] = []
    used: set[tuple[int, str]] = set()
    per_class: Counter[str] = Counter()
    for hit in hits:
        classes: set[str] = set()
        left = set(hit.patterns)
        for ex in exemptions:
            if fnmatch.fnmatchcase(hit.path, ex.glob):
                for p in ex.patterns & hit.patterns:
                    used.add((ex.line, p))
                    left.discard(p)
                    classes.add(ex.cls)
        if left:
            bad.append(hit)
        else:
            per_class.update(classes)
    return bad, used, per_class


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[4])
    ap.add_argument("--allow", type=Path, default=ALLOW_FILE)
    args = ap.parse_args(argv)
    try:
        exemptions, problems = parse_allow(args.allow.read_text())
        hits, tool = search(args.root)
    except (OSError, SearchError) as e:
        print(f"criterio2: {e}", file=sys.stderr)
        return 2
    print(
        f"criterio2: search via {tool}, {len(hits)} lines, {len(exemptions)} exceptions",
        file=sys.stderr,
    )
    bad, used, per_class = check(hits, exemptions)
    for ex in exemptions:
        problems += [
            f"allow:{ex.line}: stale, `{ex.glob}` covers no `{p}` hit"
            for p in sorted(ex.patterns)
            if (ex.line, p) not in used
        ]
    for hit in bad:
        print(
            f"{hit.path}:{hit.line}: [{','.join(sorted(hit.patterns))}] {hit.text.strip()[:SHOW]}"
        )
    for p in problems:
        print(p)
    if bad or problems:
        print(
            f"criterio2 FAIL: {len(bad)} uncovered lines, {len(problems)} list problems"
        )
        return 1
    by_class = Counter(ex.cls for ex in exemptions)
    print(f"criterio2 OK: {len(hits)} lines covered by {len(exemptions)} exceptions")
    for cls in CLASSES:
        print(f"  {cls}: {by_class[cls]} exceptions, {per_class[cls]} lines")
    return 0


if __name__ == "__main__":
    sys.exit(main())

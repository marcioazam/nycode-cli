"""Does a PR change the nycode product's FUNCTIONAL behavior? Decides whether bench-pr spends a benchmark round.

Fail closed: any path not proven non-functional is functional. The lists are the owner's proposal of
docs/migration/ny-pi-core/09 §3.2 (D-21); the rule record is docs/bench/RUNBOOK.md.

non-functional = docs, repo tooling (CI, hooks, release checks), the benchmark's own infra, tests, licence and dotfiles,
`apps/**` (outside the gates, D-23) and pure-UI paths (themes, statusline, visual extensions).
functional on purpose = `packages/*/src/**` (minus the UI extensions), everything under
`packages/*/resources/{agents,skills,commands,rules,instructions,hooks}/` (prompts, even markdown), package.json and
the lockfile (dependencies). A package.json diff that only adds or removes `files` entries is non-functional when
every touched entry is (the `files` field replaces the old publish.list).
"""

import fnmatch
import json
import posixpath
import subprocess
from pathlib import Path, PurePosixPath
from typing import Any

PROMPT_DIRS = ("agents", "skills", "commands", "rules", "instructions", "hooks")
PROMPTS = tuple(f"packages/*/resources/{d}/*" for d in PROMPT_DIRS)
# Pure UI: what the user sees, never what the agent is told or can do.
UI = (
    "packages/*/resources/themes/*",
    "packages/*/resources/statusline/*",
    *(
        f"packages/*/src/extensions/{d}/*"
        for d in ("ui", "ui-visual", "footer", "sticky-prompt")
    ),
)
DOCS = ("docs/*", "packages/*/docs/*")
REPO = (
    ".github/*",
    ".husky/*",
    ".githooks/*",
    "scripts/ci/*",
    "scripts/check-*",
    "bench/*",
    ".pre-commit-config.yaml",
    ".gitignore",
    ".gitattributes",
    ".editorconfig",
    ".leak-allow",
    ".gitleaks.toml",
    ".gitleaksignore",
    "LICENSE",
    "NOTICE",
)
APPS = ("apps/*",)  # D-23: outside the gates
TESTS = ("packages/*/test/*",)
TEST_NAMES = ("*.test.ts", "*.test.mjs", "test_*.py", "*_test.py", "test_*.sh")


def _any(p: str, globs: tuple[str, ...]) -> bool:
    return any(fnmatch.fnmatchcase(p, g) for g in globs)


def classify_path(p: str) -> tuple[bool, str]:
    """(is_functional, reason). `*` in the globs crosses `/`, so `docs/*` is the whole tree."""
    pp = PurePosixPath(p)
    if _any(p, PROMPTS):
        return True, "prompt shipped with the agent"
    if _any(p, UI):
        return False, "ui"
    if _any(p, TESTS) or _any(pp.name, TEST_NAMES) or "tests" in pp.parts[:-1]:
        return False, "test"
    if _any(p, DOCS):
        return False, "docs"
    if _any(p, REPO):
        return False, "repo tooling"
    if _any(p, APPS):
        return False, "apps outside the gates"
    if p.endswith(".md"):
        return False, "docs"
    if pp.name in ("package.json", "package-lock.json"):
        return True, "dependencies and package contents"
    return True, "not proven non-functional"


def _entry_inert(path: str) -> bool:
    """A `files` entry (repo-relative) is inert when the file, or anything under it, is non-functional."""
    return not classify_path(path)[0] or not classify_path(path + "/_")[0]


def classify(
    files: list[str], files_changes: dict[str, list[str]]
) -> tuple[bool, list[tuple[str, bool, str]]]:
    """files_changes: package.json path -> repo-relative `files` entries the PR added or removed, present only when
    nothing else in that package.json changed. Such a change is non-functional only when every entry is."""
    rows: list[tuple[str, bool, str]] = []
    for f in files:
        if f in files_changes:
            inert = bool(files_changes[f]) and all(
                _entry_inert(e) for e in files_changes[f]
            )
            why = (
                "files field: only non-functional entries"
                if inert
                else "files field ships functional paths"
            )
            rows.append((f, not inert, why))
        else:
            fn, why = classify_path(f)
            rows.append((f, fn, why))
    return (any(r[1] for r in rows) or not rows), rows


def _git(*a: str) -> str:
    return subprocess.run(
        ["git", *a], check=True, capture_output=True, text=True
    ).stdout


def _files_entries(pkg: dict[str, Any]) -> set[str] | None:
    files = pkg.get("files", [])
    if not isinstance(files, list) or not all(isinstance(e, str) for e in files):
        return None
    return set(files)


def _without_files(pkg: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in pkg.items() if k != "files"}


def _files_change(cwd: list[str], base: str, head: str, path: str) -> list[str] | None:
    """Repo-relative `files` entries added or removed in `path`, or None when anything else changed or the file
    cannot be read on both sides (added, deleted, not JSON): the caller then counts it as functional."""
    try:
        old = json.loads(_git(*cwd, "show", f"{base}:{path}"))
        new = json.loads(_git(*cwd, "show", f"{head}:{path}"))
    except (subprocess.CalledProcessError, json.JSONDecodeError):
        return None
    if not isinstance(old, dict) or not isinstance(new, dict):
        return None
    a, b = _files_entries(old), _files_entries(new)
    if _without_files(old) != _without_files(new) or a is None or b is None:
        return None
    pkg_dir = posixpath.dirname(path)
    return sorted(posixpath.normpath(posixpath.join(pkg_dir, e)) for e in a ^ b)


def evaluate(
    base: str, head: str, repo: Path | None = None
) -> tuple[bool, list[tuple[str, bool, str]]]:
    """Diff merge-base(base, head)..head. Any git failure raises: the caller must treat that as functional."""
    cwd = ["-C", str(repo)] if repo else []
    files = _git(*cwd, "diff", "--name-only", f"{base}...{head}").splitlines()
    mb = _git(*cwd, "merge-base", base, head).strip()
    changes: dict[str, list[str]] = {}
    for f in files:
        if PurePosixPath(f).name == "package.json":
            c = _files_change(cwd, mb, head, f)
            if c is not None:
                changes[f] = c
    return classify(files, changes)


def render(functional: bool, rows: list[tuple[str, bool, str]]) -> str:
    head = "functional" if functional else "non-functional"
    return "\n".join(
        [head, *(f"{'F' if fn else '-'} {p}: {why}" for p, fn, why in rows)]
    )

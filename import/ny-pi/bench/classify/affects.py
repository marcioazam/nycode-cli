"""Does a PR change the harness's FUNCTIONAL behavior? Decides whether bench-pr spends a benchmark round.

Fail closed: any path not proven non-functional is functional. Rules (record: docs/bench/RUNBOOK.md):
non-functional = docs, repo tooling (CI, git hooks, release checks), the benchmark's own infra, eval infra, tests, licence
files, markdown that is not installed, and pure-UI paths (themes, HUD, statusline, visual extensions, render-only patches).
Instruction files installed under claude-home/ are prompts: always functional, except record docs under claude-home/docs/
that no instruction file cites; pi-code patches are UI only when every patched file is a UI file.
"""

import fnmatch
import subprocess
from pathlib import Path, PurePosixPath

# Pure UI: what the user sees, never what the agent is told or can do.
UI = (
    "themes/*",
    "extensions/ui/*",  # editor, a11y, terminal title, /diff, /btw overlays
    "extensions/ui-visual/*",  # header, icons, tool renderers, working indicator
    "extensions/footer-no-stats.ts",
    "extensions/sound-notify/*",  # interactive only
    "extensions/dev-commands/*",
    "extensions/up-dequeue/*",
    "extensions/puxar.ts",
    "claude-home/bin/puxar/*",
    "extensions/sticky-prompt/*",
    "claude-home/bin/hud/*",
    "claude-home/plugins/claude-hud/*",
    "claude-home/commands/claude-hud-*.md",  # only configure the HUD
    "claude-home/patches/pi-code/statusline-multiline.patch",
    "claude-home/patches/pi-code/subagent-render.patch",  # call/result drawing only
    "claude-home/patches/pi-code/zzz-panel-column0.patch",  # panel column layout
)
NON_FUNCTIONAL = (
    "docs/*",
    ".github/*",
    ".githooks/*",
    "scripts/ci/*",
    "scripts/check-*",
    "scripts/refs-allow.txt",
    "scripts/fixtures/*",
    "bench/*",  # not installed in the harness (publish.list has no bench/ line)
    "claude-home/bin/evals/*",  # eval infra; bundle.sh is carved out below
    ".pre-commit-config.yaml",
    ".gitignore",
    ".gitattributes",
    ".editorconfig",
    ".leak-allow",
    ".gitleaks.toml",
    "LICENSE",
    "NOTICE",
)
FUNCTIONAL_EXCEPTIONS = (
    "claude-home/bin/evals/harbor/bundle.sh",
)  # builds the harness under test
PATCH_GLOB = "claude-home/patches/pi-code/*.patch"
# A pi-code patch is UI when every file it patches (path inside the pi-code tree) matches one of these.
PI_CODE_UI = ("subagent/fleet-ui/*", "status-line.ts", "notify.ts", "*.md")
DOCS_DIR = "claude-home/docs/"
TEST_NAMES = ("*.test.ts", "*.test.mjs", "test_*.py", "*_test.py", "test_*.sh")


def installed_paths(publish_list: str) -> set[str]:
    """Destination column of publish.list lines."""
    out: set[str] = set()
    for ln in publish_list.splitlines():
        if ln.strip() and not ln.startswith("#") and "\t" in ln:
            out.add(ln.split("\t")[1].strip())
    return out


def patch_target_files(text: str) -> list[str]:
    """Files named by the `+++ b/<file>` headers of a patch (/dev/null ignored)."""
    out: list[str] = []
    for ln in text.splitlines():
        if ln.startswith("+++ b/"):
            out.append(ln[6:].split("\t")[0].strip())
    return out


def referenced_docs(grep_out: str) -> set[str]:
    """Normalize `docs/...` matches (from git grep -o) to claude-home/docs/... paths."""
    return {
        "claude-home/" + ln.strip().rstrip(".")
        for ln in grep_out.splitlines()
        if ln.strip()
    }


def classify_path(
    p: str,
    installed: set[str],
    referenced: set[str] | None = None,
    patch_targets: dict[str, list[str]] | None = None,
) -> tuple[bool, str]:
    """(is_functional, reason). referenced: claude-home/docs paths cited by installed instruction files;
    patch_targets: patch path -> files it patches (head content)."""
    pp = PurePosixPath(p)
    if p in FUNCTIONAL_EXCEPTIONS:
        return True, "builds the harness under test"
    if any(fnmatch.fnmatchcase(p, g) for g in UI):
        return False, "ui"
    if any(fnmatch.fnmatchcase(pp.name, g) for g in TEST_NAMES) or "tests" in pp.parts:
        return False, "test"
    if any(fnmatch.fnmatchcase(p, g) for g in NON_FUNCTIONAL):
        return False, "docs/tooling"
    if fnmatch.fnmatchcase(p, PATCH_GLOB):
        t = (patch_targets or {}).get(p)
        if t and all(any(fnmatch.fnmatchcase(f, g) for g in PI_CODE_UI) for f in t):
            return False, "ui"
        return True, "pi-code patch changes behavior"
    if p.startswith(DOCS_DIR):
        if any(p == r or p.startswith(r.rstrip("/") + "/") for r in referenced or ()):
            return True, "doc referenced by an instruction file"
        return False, "record doc"
    if p.endswith(".md"):
        if p in installed or p.startswith("claude-home/"):
            return True, "instruction file installed in the harness"
        return False, "markdown"
    return True, "not proven non-functional"


def classify(
    files: list[str],
    publish_changes: list[str],
    installed: set[str],
    referenced: set[str] | None = None,
    patch_targets: dict[str, list[str]] | None = None,
) -> tuple[bool, list[tuple[str, bool, str]]]:
    """publish_changes: destinations of the publish.list lines the PR added or removed.
    A publish.list change is non-functional only when every touched destination is itself non-functional."""
    rows: list[tuple[str, bool, str]] = []
    for f in files:
        if f == "publish.list":
            inert = bool(publish_changes) and not any(
                classify_path(d, installed, referenced, patch_targets)[0]
                for d in publish_changes
            )
            rows.append(
                (
                    f,
                    not inert,
                    "only non-functional paths"
                    if inert
                    else "installs or removes harness files",
                )
            )
        else:
            fn, why = classify_path(f, installed, referenced, patch_targets)
            rows.append((f, fn, why))
    return (any(r[1] for r in rows) or not rows), rows


def _git(*a: str) -> str:
    return subprocess.run(
        ["git", *a], check=True, capture_output=True, text=True
    ).stdout


def evaluate(
    base: str, head: str, repo: Path | None = None
) -> tuple[bool, list[tuple[str, bool, str]]]:
    """Diff merge-base(base, head)..head. Any git failure raises: the caller must treat that as functional."""
    cwd = ["-C", str(repo)] if repo else []
    files = _git(*cwd, "diff", "--name-only", f"{base}...{head}").splitlines()
    pub: list[str] = []
    if "publish.list" in files:
        d = _git(*cwd, "diff", "-U0", f"{base}...{head}", "--", "publish.list")
        pub = sorted(
            installed_paths(
                "\n".join(
                    ln[1:]
                    for ln in d.splitlines()
                    if ln[:1] in "+-" and ln[:3] not in ("+++", "---")
                )
            )
        )
    installed = installed_paths(_git(*cwd, "show", f"{head}:publish.list"))
    referenced: set[str] = set()
    if any(f.startswith(DOCS_DIR) for f in files):
        r = subprocess.run(
            [
                "git",
                *cwd,
                "grep",
                "-h",
                "-o",
                "-E",
                "docs/[A-Za-z0-9_./-]+",
                head,
                "--",
                "claude-home/*.md",
                ":!claude-home/docs",
            ],
            check=False,
            capture_output=True,
            text=True,
        )
        if r.returncode not in (0, 1):  # 1 = nothing found
            raise subprocess.CalledProcessError(
                r.returncode, r.args, r.stdout, r.stderr
            )
        referenced = referenced_docs(r.stdout)
    targets: dict[str, list[str]] = {}
    for f in files:
        if fnmatch.fnmatchcase(f, PATCH_GLOB):
            try:
                targets[f] = patch_target_files(_git(*cwd, "show", f"{head}:{f}"))
            except subprocess.CalledProcessError:
                pass  # removed in head: functional
    return classify(files, pub, installed, referenced, targets)


def render(functional: bool, rows: list[tuple[str, bool, str]]) -> str:
    head = "functional" if functional else "non-functional"
    return "\n".join(
        [head, *(f"{'F' if fn else '-'} {p}: {why}" for p, fn, why in rows)]
    )

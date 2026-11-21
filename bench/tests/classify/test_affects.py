"""bench-pr gate for the nycode monorepo: only PRs that change functional behavior spend a benchmark round (fail
closed). Non-functional list: docs/migration/ny-pi-core/09 §3.2 (D-21)."""

import json
import subprocess
from pathlib import Path

import pytest

from bench import run as rb
from bench.classify import affects


def verdict(*files: str, files_changes: dict[str, list[str]] | None = None) -> bool:
    return affects.classify(list(files), files_changes or {})[0]


@pytest.mark.parametrize(
    "files",
    [
        ("docs/a.md", "docs/specs/x.txt", "README.md", "AGENTS.md", "CHANGELOG.md"),
        ("packages/coding-agent/docs/usage.md", "packages/tui/README.md"),
        (".github/workflows/ci.yml", ".husky/pre-commit", "scripts/ci/run-static.sh"),
        ("scripts/check-leaks.sh", "scripts/check-pinned-deps.mjs"),
        ("bench/run.py", "bench/tests/test_x.py", "bench/arms/nycode"),
        ("LICENSE", "NOTICE", ".gitignore", ".gitattributes", ".editorconfig"),
        (".gitleaks.toml", ".leak-allow", ".gitleaksignore", ".pre-commit-config.yaml"),
        (
            "packages/ai/test/stream.test.ts",
            "packages/coding-agent/test/suite/x.ts",
            "scripts/check-runtime-deps.test.mjs",
            "bench/tests/test_y.py",
            "tools/test_z.py",
        ),
        ("apps/p2-mac/Sources/P2Mac/Brain.swift", "apps/p2-mac/Package.swift"),  # D-23
        (
            "packages/coding-agent/resources/themes/dark.json",
            "packages/coding-agent/resources/statusline/a.json",
            "packages/coding-agent/src/extensions/ui/diff.ts",
            "packages/coding-agent/src/extensions/ui-visual/tools.ts",
            "packages/coding-agent/src/extensions/footer/a.ts",
            "packages/coding-agent/src/extensions/sticky-prompt/a.ts",
        ),
    ],
)
def test_non_functional(files: tuple[str, ...]) -> None:
    assert verdict(*files) is False


@pytest.mark.parametrize(
    "files",
    [
        ("docs/a.md", "packages/coding-agent/src/core/x.ts"),
        ("packages/tui/src/a.ts",),
        ("packages/coding-agent/src/extensions/mcp/a.ts",),  # not a UI extension
        # ny-pi listed these as UI; the nycode list is deliberately narrower (09 §3.2, D-21), so they fail closed
        ("packages/coding-agent/src/extensions/sound-notify/a.ts",),
        ("packages/coding-agent/src/extensions/dev-commands/a.ts",),
        ("packages/coding-agent/src/extensions/up-dequeue/a.ts",),
        ("packages/coding-agent/src/extensions/import-claude-session/a.ts",),
        (
            "packages/coding-agent/src/extensions/ui-extra/a.ts",
        ),  # prefix is not the dir
        ("packages/coding-agent/resources/agents/a.md",),
        ("packages/coding-agent/resources/skills/x/SKILL.md",),
        ("packages/coding-agent/resources/commands/c.md",),
        ("packages/coding-agent/resources/rules/r.md",),
        ("packages/coding-agent/resources/instructions/i.md",),
        ("packages/coding-agent/resources/hooks/guard.py",),
        (
            "packages/coding-agent/resources/skills/x/test_a.py",
        ),  # prompts win over test names
        ("package.json",),
        ("packages/ai/package.json",),
        ("package-lock.json",),
        ("scripts/build-coding-agent-bundle.mjs",),
        ("something/unknown.bin",),
        (),  # empty diff: nothing proven
    ],
)
def test_functional(files: tuple[str, ...]) -> None:
    assert verdict(*files) is True


def test_package_json_files_field_replaces_publish_list() -> None:
    pj = "packages/coding-agent/package.json"
    assert verdict(pj, files_changes={pj: ["packages/coding-agent/docs"]}) is False
    assert (
        verdict(
            pj,
            files_changes={
                pj: ["packages/coding-agent/CHANGELOG.md", "packages/coding-agent/docs"]
            },
        )
        is False
    )
    assert verdict(pj, files_changes={pj: ["packages/coding-agent/dist"]}) is True
    assert (
        verdict(
            pj,
            files_changes={
                pj: ["packages/coding-agent/docs", "packages/coding-agent/dist"]
            },
        )
        is True
    )
    assert verdict(pj) is True  # other keys changed (or unreadable): functional
    assert verdict(pj, files_changes={pj: []}) is True


def git(repo: Path, *a: str) -> str:
    return subprocess.run(
        ["git", "-C", str(repo), "-c", "user.email=t@t", "-c", "user.name=t", *a],
        check=True,
        capture_output=True,
        text=True,
    ).stdout


def commit(repo: Path, msg: str) -> None:
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", msg)


def write_pkg(repo: Path, files: list[str], deps: dict[str, str] | None = None) -> None:
    d = repo / "packages/x"
    d.mkdir(parents=True, exist_ok=True)
    (d / "package.json").write_text(
        json.dumps({"name": "x", "files": files, "dependencies": deps or {}})
    )


def test_evaluate_reads_files_field_from_git(tmp_path: Path) -> None:
    git(tmp_path, "init", "-q", "-b", "main")
    write_pkg(tmp_path, ["dist"])
    commit(tmp_path, "base")
    git(tmp_path, "checkout", "-qb", "pr")
    write_pkg(tmp_path, ["dist", "docs", "CHANGELOG.md"])
    commit(tmp_path, "docs in files")
    assert affects.evaluate("main", "pr", tmp_path)[0] is False
    write_pkg(tmp_path, ["dist", "docs", "CHANGELOG.md", "schemas"])
    commit(tmp_path, "schemas shipped")
    assert affects.evaluate("main", "pr", tmp_path)[0] is True
    git(tmp_path, "checkout", "-q", "main")
    git(tmp_path, "checkout", "-qb", "dep")
    write_pkg(tmp_path, ["dist"], {"left-pad": "1.0.0"})
    commit(tmp_path, "dependency")
    assert affects.evaluate("main", "dep", tmp_path)[0] is True


def test_evaluate_added_package_json_is_functional(tmp_path: Path) -> None:
    git(tmp_path, "init", "-q", "-b", "main")
    (tmp_path / "README.md").write_text("x")
    commit(tmp_path, "base")
    git(tmp_path, "checkout", "-qb", "pr")
    write_pkg(tmp_path, ["docs"])
    commit(tmp_path, "new package")
    assert affects.evaluate("main", "pr", tmp_path)[0] is True


def test_render_lists_decision() -> None:
    f, rows = affects.classify(["docs/a.md"], {})
    assert affects.render(f, rows).splitlines() == [
        "non-functional",
        "- docs/a.md: docs",
    ]


def test_cli_against_real_git(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    git(tmp_path, "init", "-q", "-b", "main")
    (tmp_path / "README.md").write_text("a")
    commit(tmp_path, "base")
    git(tmp_path, "checkout", "-qb", "pr")
    (tmp_path / "docs").mkdir()
    (tmp_path / "docs/a.md").write_text("x")
    commit(tmp_path, "doc")
    args = ["affects", "--repo", str(tmp_path), "--base", "main", "--head", "pr"]
    assert rb.main(args) == 0
    assert capsys.readouterr().out.splitlines()[0] == "non-functional"
    (tmp_path / "x.ts").write_text("x")
    commit(tmp_path, "code")
    assert rb.main(args) == 0
    assert capsys.readouterr().out.splitlines()[0] == "functional"
    # bad ref: fail closed
    bad = ["affects", "--repo", str(tmp_path), "--base", "nope", "--head", "pr"]
    assert rb.main(bad) == 0
    assert capsys.readouterr().out.splitlines()[0] == "functional"

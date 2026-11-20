"""bench-pr gate: only PRs that change the harness's functional behavior spend a benchmark round (fail closed)."""

import subprocess
from pathlib import Path

import pytest

from bench import run as rb
from bench.classify import affects

PUB = (
    "$HOME/.pi/agent/claude-home/CLAUDE.md\tclaude-home/CLAUDE.md\n"
    "$HOME/.pi/agent/x\textensions/x.ts\n"
    "# comment\n"
)


def verdict(*files: str, pub: list[str] | None = None) -> bool:
    return affects.classify(list(files), pub or [], affects.installed_paths(PUB))[0]


@pytest.mark.parametrize(
    "files",
    [
        ("docs/a.md", "README.md", "CHANGELOG.md", "docs/specs/x.txt"),
        ("themes/mono.json",),
        ("bench/run.py", "bench/tests/test_x.py"),
        (
            ".github/workflows/ci.yml",
            "scripts/ci/run-static.sh",
            ".gitignore",
            "LICENSE",
        ),
        (
            "extensions/ui/diff.ts",
            "extensions/ui-visual/tools.ts",
            "claude-home/bin/hud/claude-hud-usage.mjs",
        ),
        (
            "extensions/x.test.ts",
            "bin/test_pi_env.sh",
            "scripts/test_check_refs.py",
            "claude-home/bin/tests/a.sh",
        ),
        ("claude-home/patches/pi-code/statusline-multiline.patch",),
        ("claude-home/bin/evals/harbor/pi_vanilla_api_agent.py",),
    ],
)
def test_non_functional(files: tuple[str, ...]) -> None:
    assert verdict(*files) is False


@pytest.mark.parametrize(
    "files",
    [
        ("docs/a.md", "extensions/x.ts"),
        ("claude-home/CLAUDE.md",),
        ("claude-home/skills/new/SKILL.md",),  # not yet in publish.list, still a prompt
        ("claude-home/hooks/guard.py",),
        ("bin/pi",),
        ("install.sh",),
        ("third-party.json",),
        ("claude-home/patches/pi-code/goal.patch",),
        ("claude-home/bin/evals/harbor/bundle.sh",),
        ("something/unknown.bin",),
        (),  # empty diff: nothing proven
    ],
)
def test_functional(files: tuple[str, ...]) -> None:
    assert verdict(*files) is True


REF = {"claude-home/docs/agent-contract.md", "claude-home/docs/third-party/x/"}
PATCH = "claude-home/patches/pi-code/"


def cp(p: str, **kw: object) -> tuple[bool, str]:
    return affects.classify_path(p, set(), **kw)  # type: ignore[arg-type]


def test_record_docs() -> None:
    assert cp("claude-home/docs/goal.md", referenced=REF) == (False, "record doc")
    assert cp("claude-home/docs/goal.md") == (False, "record doc")
    assert cp("claude-home/docs/agent-contract.md", referenced=REF) == (
        True,
        "doc referenced by an instruction file",
    )
    assert cp("claude-home/docs/third-party/x/a.md", referenced=REF)[0] is True
    assert cp("claude-home/docs/third-party/y/a.md", referenced=REF)[0] is False
    assert cp("claude-home/CLAUDE.md", referenced=REF)[0] is True


@pytest.mark.parametrize(
    "p",
    [
        "extensions/sound-notify/index.ts",
        "extensions/dev-commands/a.ts",
        "extensions/up-dequeue/a.ts",
        "extensions/puxar.ts",
        "claude-home/bin/puxar/run.sh",
        ".pre-commit-config.yaml",
    ],
)
def test_more_ui(p: str) -> None:
    assert cp(p)[0] is False


def test_patch_targets() -> None:
    ui = {
        PATCH + "zz-panel-main-root.patch": ["subagent/fleet-ui/index.ts", "notify.ts"]
    }
    fn = {
        PATCH + "zz-subagent-respawn.patch": [
            "subagent/run.ts",
            "subagent/fleet-ui/a.ts",
        ]
    }
    assert cp(PATCH + "zz-panel-main-root.patch", patch_targets=ui) == (False, "ui")
    assert cp(PATCH + "zz-subagent-respawn.patch", patch_targets=fn)[0] is True
    assert cp(PATCH + "x.patch", patch_targets={PATCH + "x.patch": []})[0] is True
    assert cp(PATCH + "gone.patch", patch_targets={})[0] is True
    assert cp(PATCH + "goal.patch")[0] is True


def test_parse_helpers() -> None:
    text = "--- a/x\n+++ b/subagent/run.ts\t1969\n+++ /dev/null\n+++ b/notify.ts\n"
    assert affects.patch_target_files(text) == ["subagent/run.ts", "notify.ts"]
    out = "docs/agent-contract.md\ndocs/agents-x.md.\ndocs/third-party/x/\n"
    assert affects.referenced_docs(out) == {
        "claude-home/docs/agent-contract.md",
        "claude-home/docs/agents-x.md",
        "claude-home/docs/third-party/x/",
    }


def test_evaluate_real_git(tmp_path: Path) -> None:
    git(tmp_path, "init", "-q", "-b", "main")
    (tmp_path / "publish.list").write_text(PUB)
    (tmp_path / "claude-home/docs").mkdir(parents=True)
    (tmp_path / "claude-home/agents").mkdir()
    (tmp_path / "claude-home/agents/A.md").write_text("see docs/agent-contract.md")
    git(tmp_path, "add", "-A")
    git(tmp_path, "commit", "-qm", "base")
    git(tmp_path, "checkout", "-qb", "pr")
    (tmp_path / "claude-home/docs/goal.md").write_text("x")
    pd = tmp_path / "claude-home/patches/pi-code"
    pd.mkdir(parents=True)
    (pd / "zz-panel-main-root.patch").write_text("+++ b/subagent/fleet-ui/p.ts\t1969\n")
    git(tmp_path, "add", "-A")
    git(tmp_path, "commit", "-qm", "ok")
    assert affects.evaluate("main", "pr", tmp_path)[0] is False
    (tmp_path / "claude-home/docs/agent-contract.md").write_text("x")
    git(tmp_path, "add", "-A")
    git(tmp_path, "commit", "-qm", "cited")
    assert affects.evaluate("main", "pr", tmp_path)[0] is True


def test_publish_list_only_tests_is_non_functional() -> None:
    assert verdict("publish.list", pub=["extensions/x/index.test.ts"]) is False
    assert verdict("publish.list", pub=["extensions/y.ts"]) is True
    assert verdict("publish.list") is True


def test_render_lists_decision() -> None:
    f, rows = affects.classify(["docs/a.md"], [], set())
    assert affects.render(f, rows).splitlines() == [
        "non-functional",
        "- docs/a.md: docs/tooling",
    ]


def git(repo: Path, *a: str) -> str:
    return subprocess.run(
        ["git", "-C", str(repo), "-c", "user.email=t@t", "-c", "user.name=t", *a],
        check=True,
        capture_output=True,
        text=True,
    ).stdout


def test_cli_against_real_git(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    git(tmp_path, "init", "-q", "-b", "main")
    (tmp_path / "publish.list").write_text(PUB)
    git(tmp_path, "add", "-A")
    git(tmp_path, "commit", "-qm", "base")
    git(tmp_path, "checkout", "-qb", "pr")
    (tmp_path / "docs").mkdir()
    (tmp_path / "docs/a.md").write_text("x")
    git(tmp_path, "add", "-A")
    git(tmp_path, "commit", "-qm", "doc")
    args = ["affects", "--repo", str(tmp_path), "--base", "main", "--head", "pr"]
    assert rb.main(args) == 0
    assert capsys.readouterr().out.splitlines()[0] == "non-functional"
    (tmp_path / "x.ts").write_text("x")
    git(tmp_path, "add", "-A")
    git(tmp_path, "commit", "-qm", "code")
    assert rb.main(args) == 0
    assert capsys.readouterr().out.splitlines()[0] == "functional"
    # bad ref: fail closed
    assert (
        rb.main(["affects", "--repo", str(tmp_path), "--base", "nope", "--head", "pr"])
        == 0
    )
    assert capsys.readouterr().out.splitlines()[0] == "functional"


def test_publish_list_non_functional_destinations_are_non_functional() -> None:
    # eval infra (bench harness adapters) and UI files installed by publish.list do not change the agent
    assert (
        verdict(
            "publish.list", pub=["claude-home/bin/evals/harbor/pi_vanilla_api_agent.py"]
        )
        is False
    )
    assert (
        verdict("publish.list", pub=["themes/x.json", "extensions/x/index.test.ts"])
        is False
    )
    assert (
        verdict("publish.list", pub=["claude-home/bin/evals/harbor/bundle.sh"]) is True
    )
    assert verdict("publish.list", pub=["claude-home/skills/x/SKILL.md"]) is True

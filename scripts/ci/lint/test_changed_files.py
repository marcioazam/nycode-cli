"""changed-files.sh: upstream sync files left exactly as the rename image are not listed; fork changes are."""

import os
import subprocess
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "changed-files.sh"


def git(repo: Path, *args: str) -> str:
    env = {**os.environ, "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1"}
    out = subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@t", *args],
        cwd=repo,
        env=env,
        check=True,
        capture_output=True,
        text=True,
    )
    return out.stdout.strip()


def changed(repo: Path, base: str) -> list[str]:
    out = subprocess.run(
        ["bash", str(SCRIPT)],
        cwd=repo,
        env={**os.environ, "BASE_SHA": base},
        check=True,
        capture_output=True,
        text=True,
    )
    return out.stdout.split()


def commit(repo: Path, files: dict[str, str], message: str) -> str:
    for name, text in files.items():
        (repo / name).write_text(text)
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", message)
    return git(repo, "rev-parse", "HEAD")


def test_sync_skips_files_equal_to_the_image(tmp_path: Path) -> None:
    git(tmp_path, "init", "-q", "-b", "main")
    base = commit(tmp_path, {"up.md": "old\n", "fork.md": "old\n"}, "base")
    commit(
        tmp_path,
        {"up.md": "new\n", "fork.md": "new\n"},
        "image\n\nUpstream-Commit: " + "a" * 40,
    )
    commit(tmp_path, {"fork.md": "resolved by the fork\n"}, "resolve")
    assert changed(tmp_path, base) == ["fork.md"]


def test_without_an_image_every_change_is_listed(tmp_path: Path) -> None:
    git(tmp_path, "init", "-q", "-b", "main")
    base = commit(tmp_path, {"up.md": "old\n", "fork.md": "old\n"}, "base")
    commit(tmp_path, {"up.md": "new\n", "fork.md": "new\n"}, "ordinary change")
    assert changed(tmp_path, base) == ["fork.md", "up.md"]

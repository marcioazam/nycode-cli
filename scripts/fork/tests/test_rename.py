"""rename.py on a throwaway git repository: content, paths, skipped files, repository URL rule and --dry."""

import re
import subprocess
import sys
from pathlib import Path

import pytest

RENAME = Path(__file__).resolve().parents[1] / "rename.py"
GIT = ["git", "-c", "user.name=t", "-c", "user.email=t@t"]
TEXT = (
    "pi uses PI_HOME with @earendil-works/pi-ai from https://github.com/earendil-works/pi\n"
    "kept: pi.dev and https://github.com/earendil-works/pi/issues/12 and @earendil-works/gondolin\n"
)


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "pi-tool.ts").write_text("export const pi = 1;\n")
    (tmp_path / "pi.md").write_text(TEXT)
    (tmp_path / "CHANGELOG.md").write_text("pi 1.0\n")
    (tmp_path / "data.jsonl").write_text("pi\n")
    (tmp_path / "blob.bin").write_bytes(b"pi\x00pi")
    (tmp_path / "latin.txt").write_bytes(b"pi \xff")
    subprocess.run(["git", "init", "-q", str(tmp_path)], check=True)
    subprocess.run([*GIT, "-C", str(tmp_path), "add", "-A"], check=True)
    return tmp_path


def run(repo: Path, *extra: str) -> str:
    out = subprocess.run(
        [sys.executable, str(RENAME), str(repo), *extra],
        check=True,
        capture_output=True,
        text=True,
    )
    return out.stdout


def test_renames_content_paths_and_keeps_exceptions(repo: Path) -> None:
    out = run(repo)
    assert out.splitlines()[0] == "arquivos de conteudo alterados: 2"
    assert (repo / "src" / "nycode-tool.ts").read_text() == "export const nycode = 1;\n"
    assert not (repo / "src" / "pi-tool.ts").exists()
    assert (repo / "nycode.md").read_text() == (
        "nycode uses NYCODE_HOME with @nycode/ai from https://github.com/marcioazam/nycode\n"
        "kept: pi.dev and https://github.com/earendil-works/pi/issues/12 and @earendil-works/gondolin\n"
    )
    for name, content in [
        ("CHANGELOG.md", b"pi 1.0\n"),
        ("data.jsonl", b"pi\n"),
        ("blob.bin", b"pi\x00pi"),
        ("latin.txt", b"pi \xff"),
    ]:
        assert (repo / name).read_bytes() == content


def test_repository_url_is_marcioazam_nycode_not_nycode_cli(repo: Path) -> None:
    run(repo)
    text = (repo / "nycode.md").read_text()
    assert "marcioazam/nycode\n" in text
    assert "nycode-cli" not in text


def test_dry_run_changes_nothing_and_counts_to_stdout(repo: Path) -> None:
    out = run(repo, "--dry")
    assert (repo / "src" / "pi-tool.ts").exists()
    assert (repo / "pi.md").read_text() == TEXT
    assert "mv pi.md -> nycode.md" in out
    assert re.search(r"^ +\d+  \S", out, re.MULTILINE)  # the counted fragments

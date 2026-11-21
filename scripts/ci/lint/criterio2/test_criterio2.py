"""Tests of criterio2.py: allow-list parsing, coverage, stale detection, both search tools and exit codes."""

import shutil
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))
import criterio2

HAS_RG = shutil.which("rg") is not None
HAS_GIT = shutil.which("git") is not None


def put(root: Path, rel: str, text: str) -> None:
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text)


def run(
    root: Path, allow: str, capsys: pytest.CaptureFixture[str]
) -> tuple[int, str, str]:
    list_file = root.with_name(root.name + "-allow.txt")  # outside the searched tree
    list_file.write_text(allow)
    code = criterio2.main(["--root", str(root), "--allow", str(list_file)])
    out = capsys.readouterr()
    return code, out.out, out.err


def test_parse_allow_accepts_a_valid_line_and_skips_comments() -> None:
    found, problems = criterio2.parse_allow(
        "# c\n\nbench/* | .pi/agent,sed -i | produto-externo | why | with bar\n"
    )
    assert problems == []
    assert found[0].glob == "bench/*"
    assert found[0].patterns == {".pi/agent", "sed -i"}
    assert found[0].reason == "why | with bar"
    assert found[0].line == 3


@pytest.mark.parametrize(
    ("row", "needle"),
    [
        ("only | three | fields", "expected"),
        ("a/b | sed -i | produto-externo | ", "expected"),
        ("**/x | sed -i | upstream | r", "too generic"),
        ("a/**/x | sed -i | upstream | r", "too generic"),
        ("*.md | sed -i | upstream | r", "too generic"),
        ("a/b | sed -i | defeito | r", "class"),
        ("a/b | rm -rf | upstream | r", "unknown pattern"),
    ],
)
def test_parse_allow_reports_bad_lines(row: str, needle: str) -> None:
    found, problems = criterio2.parse_allow(row + "\n")
    assert found == []
    assert len(problems) == 1 and needle in problems[0]


def test_check_covers_by_pattern_and_class() -> None:
    found, _ = criterio2.parse_allow(
        "a/* | sed -i | ferramenta-fork | r\nb.md | .pi/agent | upstream | r\n"
    )
    hits = [
        criterio2.Hit("a/x.sh", 1, "sed -i foo"),
        criterio2.Hit(
            "a/y.sh", 2, "sed -i ~/.pi/agent"
        ),  # second pattern not covered by a/*
        criterio2.Hit("b.md", 3, "see ~/.pi/agent"),
        criterio2.Hit("c.md", 4, "CLAUDE_CONFIG_DIR=x"),
    ]
    bad, used, per_class = criterio2.check(hits, found)
    assert [(h.path, h.line) for h in bad] == [("a/y.sh", 2), ("c.md", 4)]
    assert used == {(1, "sed -i"), (2, ".pi/agent")}
    assert per_class == {"ferramenta-fork": 1, "upstream": 1}


def test_search_skips_excluded_directories(tmp_path: Path) -> None:
    put(tmp_path, "src/a.ts", "x ~/.pi/agent\n")
    put(tmp_path, "import/ny-pi/b.sh", "sed -i x\n")
    put(tmp_path, "docs/c.md", "patch -p1\n")
    put(tmp_path, "scripts/ci/lint/criterio2/d.py", "CLAUDE_CONFIG_DIR\n")
    put(tmp_path, "clean.txt", "nothing\n")
    hits, tool = criterio2.search(tmp_path)
    assert [(h.path, h.line) for h in hits] == [("src/a.ts", 1)]
    assert tool == ("rg" if HAS_RG else "git grep")


@pytest.mark.skipif(not HAS_RG, reason="rg missing")
def test_search_ignores_a_piped_stdin(tmp_path: Path) -> None:
    # In CI stdin is a pipe, not a TTY: rg without a path would search stdin and find nothing.
    put(tmp_path, "src/a.ts", "x ~/.pi/agent\n")
    script = Path(criterio2.__file__)
    code = (
        f"import sys; sys.path.insert(0, {str(script.parent)!r}); import criterio2; "
        f"print(len(criterio2.search(__import__('pathlib').Path({str(tmp_path)!r}))[0]))"
    )
    done = subprocess.run(
        [sys.executable, "-c", code],
        input="",
        capture_output=True,
        text=True,
        check=True,
    )
    assert done.stdout.strip() == "1"


@pytest.mark.skipif(not HAS_GIT, reason="git missing")
def test_search_falls_back_to_git_grep(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    put(tmp_path, "src/a.ts", "node_modules/pi-code\n")
    put(tmp_path, "docs/c.md", "patch -p1\n")
    put(tmp_path, ".gitignore", "ignored.txt\n")
    put(tmp_path, "ignored.txt", "sed -i\n")
    real = shutil.which
    monkeypatch.setattr(
        shutil, "which", lambda name: None if name == "rg" else real(name)
    )
    hits, tool = criterio2.search(tmp_path)
    assert tool == "git grep"
    assert [(h.path, h.line, sorted(h.patterns)) for h in hits] == [
        ("src/a.ts", 1, ["node_modules/pi-code"])
    ]


def test_search_without_any_tool_is_an_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(shutil, "which", lambda name: None)
    with pytest.raises(criterio2.SearchError):
        criterio2.search(tmp_path)


def test_main_ok_reports_counts_per_class(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    put(tmp_path, "a/x.sh", "sed -i y\n")
    code, out, err = run(tmp_path, "a/* | sed -i | ferramenta-fork | r\n", capsys)
    assert code == 0
    assert "criterio2 OK: 1 lines covered by 1 exceptions" in out
    assert "ferramenta-fork: 1 exceptions, 1 lines" in out
    assert "search via" in err


def test_main_fails_on_a_new_line(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    put(tmp_path, "a/x.sh", "sed -i y\n")
    put(tmp_path, "src/new.ts", "const d = '~/.pi/agent';\n")
    code, out, _ = run(tmp_path, "a/* | sed -i | ferramenta-fork | r\n", capsys)
    assert code == 1
    assert "src/new.ts:1: [.pi/agent] const d" in out
    assert "criterio2 FAIL: 1 uncovered lines, 0 list problems" in out


def test_main_fails_on_a_stale_exception(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    put(tmp_path, "a/x.sh", "sed -i y\n")
    code, out, _ = run(
        tmp_path,
        "a/* | sed -i,.pi/agent | ferramenta-fork | r\ngone/* | sed -i | upstream | r\n",
        capsys,
    )
    assert code == 1
    assert "allow:1: stale, `a/*` covers no `.pi/agent` hit" in out
    assert "allow:2: stale, `gone/*` covers no `sed -i` hit" in out


def test_main_fails_on_an_invalid_list(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    put(tmp_path, "a/x.sh", "ok\n")
    code, out, _ = run(tmp_path, "**/x | sed -i | upstream | r\n", capsys)
    assert code == 1
    assert "too generic" in out


def test_main_exit_2_when_the_list_is_unreadable(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    code = criterio2.main(
        ["--root", str(tmp_path), "--allow", str(tmp_path / "missing.txt")]
    )
    assert code == 2
    assert "criterio2:" in capsys.readouterr().err


def test_main_exit_2_when_the_search_fails(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(shutil, "which", lambda name: None)
    code, _, err = run(tmp_path, "", capsys)
    assert code == 2
    assert "neither rg nor git" in err


def test_run_reports_a_tool_failure(tmp_path: Path) -> None:
    with pytest.raises(criterio2.SearchError):
        criterio2._run(["git", "grep", "--no-such-flag"], tmp_path)

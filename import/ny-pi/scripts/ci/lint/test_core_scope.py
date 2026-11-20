"""Tests of core_scope.py: discovery rules, table comparison and exit codes."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))
import core_scope

BEGIN, END = "<!-- core-scope:begin -->", "<!-- core-scope:end -->"
HEADER = "| Tipo | Nome | Classe | Motivo |\n|---|---|---|---|\n"


def touch(p: Path) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text("x\n")


def tree(tmp_path: Path) -> Path:
    touch(tmp_path / "claude-home/skills/s1/SKILL.md")
    touch(tmp_path / "claude-home/agents/a1.md")
    touch(tmp_path / "extensions/e1.ts")
    touch(tmp_path / "claude-home/hooks/guard.py")
    touch(tmp_path / "claude-home/commands/c1.md")
    (tmp_path / "claude-home/plugins/p1").mkdir(parents=True)
    return tmp_path


def spec(root: Path, rows: list[str], markers: bool = True) -> None:
    body = HEADER + "".join(r + "\n" for r in rows)
    text = f"{BEGIN}\n{body}{END}\n" if markers else body
    touch(root / "docs/specs/0005-core-scope.md")
    (root / "docs/specs/0005-core-scope.md").write_text(text)


ROWS = [
    "| skill | s1 | core | m |",
    "| agent | a1 | ui | m |",
    "| extension | e1 | optional | m |",
    "| hook | guard.py | remove | m |",
    "| command | c1 | core | m |",
    "| plugin | p1 | core | m |",
]


def run(root: Path, capsys: pytest.CaptureFixture[str]) -> tuple[int, str, str]:
    code = core_scope.main(["--root", str(root)])
    cap = capsys.readouterr()
    return code, cap.out, cap.err


def test_clean(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    root = tree(tmp_path)
    spec(root, ROWS)
    code, out, _ = run(root, capsys)
    assert code == 0
    assert out.strip() == "core-scope OK: 6 pieces (core 3, ui 1, optional 1, remove 1)"


def test_missing(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    root = tree(tmp_path)
    spec(root, ROWS[1:])
    code, _, err = run(root, capsys)
    assert code == 1
    assert err.strip() == "missing: skill s1"


def test_stale(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    root = tree(tmp_path)
    spec(root, [*ROWS, "| skill | gone | core | m |"])
    code, _, err = run(root, capsys)
    assert code == 1
    assert err.strip() == "stale: skill gone"


def test_bad_class_and_type(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    root = tree(tmp_path)
    spec(
        root, [ROWS[0].replace("core", "weird"), *ROWS[1:], "| gizmo | z | core | m |"]
    )
    code, _, err = run(root, capsys)
    assert code == 1
    assert "unknown class: skill s1 weird" in err
    assert "unknown type: gizmo z" in err


def test_duplicate(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    root = tree(tmp_path)
    spec(root, [*ROWS, ROWS[0]])
    code, _, err = run(root, capsys)
    assert code == 1
    assert err.strip() == "duplicate: skill s1"


def test_no_markers(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    root = tree(tmp_path)
    spec(root, ROWS, markers=False)
    code, _, err = run(root, capsys)
    assert code == 2
    assert "markers" in err


def test_missing_spec(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    code, _, err = run(tree(tmp_path), capsys)
    assert code == 2
    assert "cannot read" in err


def test_malformed_row(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    root = tree(tmp_path)
    spec(root, [*ROWS, "| skill | only-two |"])
    code, _, err = run(root, capsys)
    assert code == 2
    assert "malformed" in err


def test_ignore_rules(tmp_path: Path) -> None:
    root = tree(tmp_path)
    for p in (
        "claude-home/hooks/test_x.py",
        "claude-home/hooks/fixtures/f.json",
        "claude-home/hooks/__pycache__/x.pyc",
        "claude-home/hooks/.hidden",
        "extensions/a.test.ts",
        "extensions/test/t.ts",
        "extensions/tests/t.ts",
        "extensions/node_modules/m/i.ts",
        "extensions/.cache/c.ts",
        "extensions/readme.md",
    ):
        touch(root / p)
    (root / "claude-home/skills/nodoc").mkdir()
    (root / "extensions/dir1").mkdir()
    found = core_scope.discover(root)
    assert found == {
        ("skill", "s1"),
        ("agent", "a1"),
        ("extension", "e1"),
        ("extension", "dir1"),
        ("hook", "guard.py"),
        ("command", "c1"),
        ("plugin", "p1"),
    }


def test_discover_empty(tmp_path: Path) -> None:
    assert core_scope.discover(tmp_path) == set()


def test_real_repo(capsys: pytest.CaptureFixture[str]) -> None:
    code = core_scope.main([])
    cap = capsys.readouterr()
    assert code == 0, cap.err

"""Casos sintéticos para check_oracles: oráculo quebrado, no-op que passa, case.json inválido."""

from __future__ import annotations

import json
from pathlib import Path

import check_oracles as co
import pytest

TEST_CMD = "python3 -m pytest -q -p no:cacheprovider hidden"
TEST_BODY = "from m import f\n\n\ndef test_f():\n    assert f() == 2\n"
STUB = "def f():\n    return 1\n"
GOOD = "def f():\n    return 2\n"


def meta(case_id: str, **over: object) -> dict[str, object]:
    base: dict[str, object] = {
        "id": case_id,
        "suite": "multi",
        "kind": "outcome",
        "prompt": "faça",
        "timeout_s": 60,
        "budget_usd": 1.0,
        "split": "dev",
        "security": False,
        "test_cmd": TEST_CMD,
    }
    base.update(over)
    return base


def make_case(
    root: Path,
    case_id: str,
    *,
    repo: str = STUB,
    oracle: str = GOOD,
    hidden: str = TEST_BODY,
    over: dict[str, object] | None = None,
) -> Path:
    d = root / "multi" / case_id
    for sub, name, text in (
        ("repo", "m.py", repo),
        ("oracle", "m.py", oracle),
        ("hidden", "test_m.py", hidden),
    ):
        (d / sub).mkdir(parents=True, exist_ok=True)
        (d / sub / name).write_text(text)
    (d / "case.json").write_text(json.dumps(meta(case_id, **(over or {}))))
    return d


def test_valid_case_has_no_problems(tmp_path: Path) -> None:
    d = make_case(tmp_path, "ok")
    assert co.check_case(d, "multi") == []


def test_broken_oracle_is_reported(tmp_path: Path) -> None:
    d = make_case(tmp_path, "bad-oracle", oracle=STUB)
    problems = co.check_case(d, "multi")
    assert len(problems) == 1 and "oráculo falhou" in problems[0]


def test_noop_that_passes_is_reported(tmp_path: Path) -> None:
    d = make_case(tmp_path, "noop", repo=GOOD)
    problems = co.check_case(d, "multi")
    assert len(problems) == 1 and "no-op" in problems[0]


@pytest.mark.parametrize(
    "over,fragment",
    [
        ({"timeout_s": 901}, "timeout_s"),
        ({"budget_usd": 2}, "budget_usd"),
        ({"kind": "other"}, "kind"),
        ({"split": "test"}, "split"),
        ({"security": True}, "security"),
        ({"suite": "plan"}, "suite"),
        ({"id": "outro"}, "id difere"),
        ({"prompt": "  "}, "prompt vazio"),
        ({"ask_terms": ["x"]}, "ask_terms"),
        ({"timeout_s": True}, "timeout_s"),
    ],
)
def test_invalid_fields(tmp_path: Path, over: dict[str, object], fragment: str) -> None:
    d = make_case(tmp_path, "inv", over=over)
    problems = co.check_case(d, "multi")
    assert any(fragment in p for p in problems), problems


def test_unreadable_case_json(tmp_path: Path) -> None:
    d = make_case(tmp_path, "broken")
    (d / "case.json").write_text("{not json")
    assert "ilegível" in co.check_case(d, "multi")[0]


def test_missing_oracle_dir(tmp_path: Path) -> None:
    d = make_case(tmp_path, "noor")
    (d / "oracle" / "m.py").unlink()
    assert any("oracle/" in p for p in co.check_case(d, "multi"))


def test_ask_requires_terms_and_skips_tests(tmp_path: Path) -> None:
    d = tmp_path / "multi" / "a1"
    (d / "repo").mkdir(parents=True)
    (d / "repo" / "x.py").write_text("x = 1\n")
    (d / "case.json").write_text(json.dumps(meta("a1", kind="ask")))
    assert any("ask_terms" in p for p in co.check_case(d, "multi"))
    (d / "case.json").write_text(json.dumps(meta("a1", kind="ask", ask_terms=["qual"])))
    assert co.check_case(d, "multi") == []


def test_plan_prompt_prefix(tmp_path: Path) -> None:
    d = make_case(tmp_path, "pl", over={"suite": "plan"})
    problems = co.check_case(d, "plan")
    assert any("Planeje antes" in p for p in problems)


def test_expected_heldout_is_deterministic_30_percent() -> None:
    ids = [f"c{i:02d}" for i in range(10)]
    a = co.expected_heldout(ids)
    assert a == co.expected_heldout(list(reversed(ids)))
    assert len(a) == 3 and a <= set(ids)


def test_suite_split_mismatch_and_counts(tmp_path: Path) -> None:
    for i in range(4):
        make_case(tmp_path, f"c{i}")
    suite = tmp_path / "multi"
    problems = co.check_suite_split(suite, "multi", require_counts=True)
    assert any("mínimo" in p for p in problems)
    assert any("heldout" in p for p in problems)
    want = co.expected_heldout([f"c{i}" for i in range(4)])
    for i in range(4):
        f = suite / f"c{i}" / "case.json"
        data = json.loads(f.read_text())
        data["split"] = "heldout" if f"c{i}" in want else "dev"
        f.write_text(json.dumps(data))
    assert co.check_suite_split(suite, "multi", require_counts=False) == []


def test_main_exit_codes(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    make_case(tmp_path, "c0", oracle=STUB)
    assert co.main(["--root", str(tmp_path), "--suite", "multi", "--case", "c0"]) == 1
    assert "PROBLEMA" in capsys.readouterr().err
    assert co.main(["--root", str(tmp_path), "--suite", "multi", "--case", "zz"]) == 1
    good = tmp_path / "good"
    make_case(good, "g0")
    assert co.main(["--root", str(good), "--suite", "multi", "--case", "g0"]) == 0

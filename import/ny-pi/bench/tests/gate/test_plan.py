"""Tier pr of the sequential gate: k1 everywhere, security tasks k3 from look 1 (bench/run.py, runners.py). No model."""

from pathlib import Path
from typing import Any

from bench import run as rb
from bench import runners as rn
from bench.tests.helpers import BENCH, MP


def cfg() -> dict[str, Any]:
    return rb.load_toml(BENCH / "suites.toml")


def test_tier_pr_is_k1_with_security_k3() -> None:
    steps = {s["suite"]: s for s in rb.build_plan("pr", cfg())}
    assert {n: s["k"] for n, s in steps.items()} == {"s1": 1, "s4": 1, "s5": 1, "s2": 1}
    assert steps["s1"]["k_security"] == 3


def test_extension_k_overrides_security_k() -> None:
    assert all(s.get("k_security") is None for s in rb.build_plan("pr", cfg(), k=2))


def test_estimate_counts_security_reps(monkeypatch: MP) -> None:
    monkeypatch.setattr(
        rn,
        "s1_security_cases",
        lambda tasks: {t for t in tasks if t.startswith("sec-")},
    )
    s1 = rb.build_plan("pr", cfg(), ["s1"])[0]
    assert s1["est_total"] == round((8 * 3 + 8 * 1) * s1["est"], 2)


def test_s1_security_cases_reads_the_security_suite(
    tmp_path: Path, monkeypatch: MP
) -> None:
    (tmp_path / "cases").mkdir()
    (tmp_path / "cases" / "security.jsonl").write_text(
        '{"id": "x", "suite": "security"}\n'
    )
    (tmp_path / "cases" / "quality.jsonl").write_text(
        '{"id": "y", "suite": "quality"}\n'
    )
    monkeypatch.setattr(rn, "EVALS_RUN", tmp_path / "run.py")
    assert rn.s1_security_cases(["x", "y"]) == {"x"}


def test_execute_runs_s1_in_one_call_per_k(tmp_path: Path, monkeypatch: MP) -> None:
    calls: list[tuple[int, list[str]]] = []

    def fake(
        kind: Any, bin_: Any, cases: list[str], k: int, *a: Any, **kw: Any
    ) -> tuple[list[Any], None]:
        calls.append((k, cases))
        return [], None

    monkeypatch.setattr(rn, "run_s1", fake)
    monkeypatch.setattr(rn, "s1_security_cases", lambda tasks: {"sec-a"})
    monkeypatch.setattr(rn, "s1_case_reps", lambda cases, k: {c: k for c in cases})
    monkeypatch.setattr(rb, "arm_info", lambda *_: ("pi", tmp_path))
    monkeypatch.setattr(rb, "arm_meta", lambda *_: {})
    step: rb.Step = {
        "suite": "s1",
        "kind": "internal",
        "k": 1,
        "k_security": 3,
        "tasks": ["a", "sec-a"],
    }
    rb.execute("ny-pi", "pr", "m", 5.0, [step], {}, tmp_path / "o")
    assert sorted(calls) == [(1, ["a"]), (3, ["sec-a"])]

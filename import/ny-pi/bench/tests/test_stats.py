import json
import subprocess
import sys
from collections.abc import Collection, Mapping
from pathlib import Path
from typing import Any

import pytest

from bench import stats

META = {"model": "m", "arm_version": "1", "overlay_sha": "abc"}


def mk(
    passes: Mapping[str, int],
    cost: float | None = 1.0,
    wall: float | None = 10.0,
    security: Collection[str] = (),
    reps: int = 3,
) -> list[stats.Run]:
    """passes: {task: n_passed_of_reps}."""
    out: list[stats.Run] = []
    for t, k in passes.items():
        for r in range(reps):
            out.append(
                {
                    "task_id": t,
                    "rep": r,
                    "passed": r < k,
                    "cost_usd": cost,
                    "wall_s": wall,
                    "security": t in security,
                }
            )
    return out


T = {f"t{i}": 3 for i in range(20)}


def test_pass_clear() -> None:
    v = stats.verdict(mk(T), mk(T), META, META)
    assert v["verdict"] == "PASS" and v["rules"]["accuracy"] == "PASS"
    assert v["n"] == 20 and v["score"] == 100.0


def test_fail_accuracy() -> None:
    cand = {k: (0 if i < 10 else 3) for i, k in enumerate(T)}
    v = stats.verdict(mk(T), mk(cand), META, META)
    assert v["rules"]["accuracy"] == "FAIL" and v["verdict"] == "FAIL"
    assert v["ci"][1] < -0.05


def test_inconclusive_extend_then_fail() -> None:
    cand = dict(list(T.items())[:4])  # small N, one regress
    base = dict(cand)
    cand["t0"] = 0
    b, c = mk(base), mk(cand)
    v = stats.verdict(b, c, META, META)
    assert v["verdict"] == "INCONCLUSIVE"
    assert stats.tasks_to_extend(b, c) == ["t0"]
    assert stats.verdict(b, c, META, META, extended=True)["verdict"] == "FAIL"


def test_fail_cost() -> None:
    v = stats.verdict(mk(T), mk(T, cost=1.2), META, META)
    assert v["rules"]["cost"] == "FAIL" and v["verdict"] == "FAIL"
    assert v["cost_ratio"] == pytest.approx(1.2)


def test_fail_wall() -> None:
    v = stats.verdict(mk(T), mk(T, wall=13), META, META)
    assert v["rules"]["wall"] == "FAIL" and v["verdict"] == "FAIL"


def test_fail_security() -> None:
    base = mk(T, security={"t1"})
    cand_p = dict(T, t1=2)
    v = stats.verdict(base, mk(cand_p, security={"t1"}), META, META)
    assert v["security_regressions"] == ["t1"]
    assert v["verdict"] == "FAIL" and v["score"] == 0


def test_not_comparable() -> None:
    for k in META:
        v = stats.verdict(mk(T), mk(T), META, dict(META, **{k: "x"}))
        assert v["verdict"] == "NOT_COMPARABLE"


def test_none_cost_wall() -> None:
    c = mk(T)
    for r in c[:7]:
        r["cost_usd"] = None
    v = stats.verdict(mk(T), c, META, META)
    assert v["verdict"] == "PASS"
    allnone = [dict(r, cost_usd=None, wall_s=None) for r in c]
    v = stats.verdict(mk(T), allnone, META, META)
    assert v["rules"]["cost"] == v["rules"]["wall"] == "INCONCLUSIVE"
    assert v["cost_ratio"] is None


def test_unpaired_tasks_ignored_and_empty() -> None:
    v = stats.verdict(mk({"a": 3}), mk({"b": 3}), META, META)
    assert v["n"] == 0 and v["rules"]["accuracy"] == "INCONCLUSIVE"


def test_ci_deterministic_and_degenerate() -> None:
    d = [0.0, -1 / 3, 0.0, 1 / 3, 0.0, 0.0]
    assert stats.paired_ci(d) == stats.paired_ci(d)
    assert stats.paired_ci([0.1] * 5) == (0.1, 0.1)


def test_power_monotonic() -> None:
    assert stats.power(10, 3, 0.3, 0.1) < stats.power(40, 3, 0.3, 0.1) < 1
    assert stats.power(20, 1, 0.3, 0.1) < stats.power(20, 5, 0.3, 0.1)
    assert stats.required_tasks(0.05, 3, 0.3) > stats.required_tasks(0.10, 3, 0.3)
    assert stats.required_tasks(0.05, 6, 0.3) <= stats.required_tasks(0.05, 3, 0.3)
    n = stats.required_tasks(0.1, 3, 0.3)
    assert stats.halfwidth(n, 3, 0.3) <= 0.1 < stats.halfwidth(n - 1, 3, 0.3)


def test_cli(tmp_path: Path) -> None:
    def w(name: str, obj: Any, jsonl: bool = False) -> str:
        p = tmp_path / name
        p.write_text(
            "\n".join(json.dumps(x) for x in obj) if jsonl else json.dumps(obj)
        )
        return str(p)

    b, c = w("b.jsonl", mk(T), True), w("c.jsonl", mk(T, cost=2), True)
    m = w("m.json", META)
    script = str(Path(stats.__file__))
    r = subprocess.run(
        [
            sys.executable,
            script,
            "verdict",
            b,
            c,
            "--meta-base",
            m,
            "--meta-cand",
            m,
            "--extended",
        ],
        capture_output=True,
        check=False,
        text=True,
    )
    assert r.returncode == 1 and json.loads(r.stdout)["verdict"] == "FAIL"
    r = subprocess.run(
        [sys.executable, script, "verdict", b, b, "--meta-base", m, "--meta-cand", m],
        capture_output=True,
        check=False,
        text=True,
    )
    assert r.returncode == 0
    m2 = w("m2.json", dict(META, model="z"))
    r = subprocess.run(
        [sys.executable, script, "verdict", b, b, "--meta-base", m, "--meta-cand", m2],
        capture_output=True,
        check=False,
        text=True,
    )
    assert r.returncode == 4

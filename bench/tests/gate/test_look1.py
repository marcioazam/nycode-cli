"""Look 1 of the sequential gate (bench/stats.py look1): early PASS, early FAIL or continue. Offline, no spend."""

from typing import Any

from bench import runners as rn
from bench import stats

META = {"model": "m", "arm_version": "v", "overlay_sha": "o"}
P = {"alpha1": 0.01, "cost1": 1.0, "turns1": 1.0}


def runs(
    n: int,
    k: int,
    fail: frozenset[int] | set[int] = frozenset(),
    cost: float = 1.0,
    **kw: Any,
) -> list[dict[str, Any]]:
    return [
        rn.make_run(
            "s4", f"t{i}", r, i not in fail, cost_usd=cost, wall_s=1.0, turns=10, **kw
        )
        for i in range(n)
        for r in range(k)
    ]


def sec(k: int, fails: int, name: str = "sec-x") -> list[dict[str, Any]]:
    return [
        rn.make_run("s1", name, r, r >= fails, cost_usd=1.0, security=True)
        for r in range(k)
    ]


def decide(base: list[dict[str, Any]], cand: list[dict[str, Any]]) -> str:
    return stats.look1(base, cand, META, META, **P)[0]


def test_early_pass_when_unchanged() -> None:
    assert decide(runs(30, 12) + sec(12, 0), runs(30, 1) + sec(3, 0)) == "PASS"


def test_early_fail_when_clearly_worse() -> None:
    assert decide(runs(30, 12), runs(30, 1, fail=set(range(15)))) == "FAIL"


def test_continue_when_cost_ratio_above_c1() -> None:
    assert decide(runs(30, 12), runs(30, 1, cost=1.05)) == "CONTINUE"


def test_continue_when_accuracy_interval_straddles_the_margin() -> None:
    assert decide(runs(30, 12), runs(30, 1, fail=set(range(4)))) == "CONTINUE"


def test_security_regression_confirmed_fails_early() -> None:
    assert decide(runs(30, 12) + sec(12, 0), runs(30, 1) + sec(3, 2)) == "FAIL"


def test_one_security_failure_is_not_decided_at_look1() -> None:
    assert decide(runs(30, 12) + sec(12, 0), runs(30, 1) + sec(3, 1)) == "CONTINUE"


def test_not_comparable_is_final() -> None:
    d = stats.look1(runs(5, 12), runs(5, 1), META, {**META, "model": "x"}, **P)[0]
    assert d == "NOT_COMPARABLE"

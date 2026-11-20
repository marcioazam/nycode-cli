"""Security-rule calibration in bench/tools/gate_sim.py: exact tail, curtailed count rule, paired summary."""

import json
import math
from pathlib import Path

from bench import stats
from bench.tools import gate_sim as gs

PRM = (stats.ALPHA1, stats.COST1, stats.TURNS1)


def test_fisher_tail_against_a_clean_base() -> None:
    assert math.isclose(gs.fisher_tail(2, 12, 12), 66 / 276)  # C(12,2) / C(24,2)
    assert gs.fisher_tail(0, 12, 12) == 1.0


def test_count_rule_stops_at_the_threshold_or_when_it_is_out_of_reach() -> None:
    rule = ("count", 3, 12, 3)
    assert gs.sec_outcome(rule, [True] * 12, 12) == (
        False,
        3,
    )  # no failure in k0: nothing to confirm
    assert gs.sec_outcome(rule, [False, True, True] + [True] * 9, 12) == (
        False,
        11,
    )  # 1 fail: out of reach at rep 11
    assert gs.sec_outcome(rule, [False, False, False] + [True] * 9, 12) == (
        True,
        3,
    )  # threshold met in k0


def test_fisher_rule_extends_to_n_then_tests() -> None:
    rule = ("fisher", 3, 12, 0.05)
    assert gs.sec_outcome(rule, [False] + [True] * 11, 12) == (False, 12)
    assert gs.sec_outcome(rule, [False] * 4 + [True] * 8, 12) == (
        True,
        12,
    )  # p = C(12,4)/C(24,4) = 0.047


def synth(tmp: Path) -> Path:
    rows = [
        {"suite": "s1", "task_id": f"sec{i}", "rep": r, "passed": True, "cost_usd": 0.01, "wall_s": 1.0,
         "security": True, "turns": 5, "error": None}
        for i in range(3) for r in range(12)
    ] + [
        {"suite": "s4", "task_id": f"t{i}", "rep": r, "passed": True, "cost_usd": 1.0, "wall_s": 1.0,
         "security": False, "turns": 5, "error": None}
        for i in range(20) for r in range(12)
    ]  # fmt: skip
    f = tmp / "runs.jsonl"
    f.write_text("".join(json.dumps(r) + "\n" for r in rows))
    return f


def test_simulate_with_security_rules_is_deterministic_and_leaves_the_rest_alone(
    tmp_path: Path,
) -> None:
    m = gs.load_model(synth(tmp_path))
    rules = [("count", 3, 12, 3), ("fisher", 3, 12, 0.1)]
    a = gs.simulate(m, 6, 200, [PRM[0]], [PRM], PRM, 1, ("a", "e30"), secrules=rules)
    assert a == gs.simulate(
        m, 6, 200, [PRM[0]], [PRM], PRM, 1, ("a", "e30"), secrules=rules
    )
    plain = gs.simulate(m, 6, 200, [PRM[0]], [PRM], PRM, 1, ("a", "e30"))
    assert [r["cur"] for r in a["e30"]] == [r["cur"] for r in plain["e30"]]
    s = gs.sec_summary(a, rules[0])["e30"]
    assert 0 <= s["new"] <= 1 and s["ref_ci"][0] <= s["ref"] <= s["ref_ci"][1]
    assert isinstance(s["usd_extra"], float)


def test_clean_base_keeps_the_observed_all_pass_security_base(tmp_path: Path) -> None:
    import random

    m = gs.load_model(synth(tmp_path))
    for i in range(30):
        d = gs.draw(m, "a", random.Random(i), clean_sec=True)
        assert all(r["passed"] for r in d.base if r["suite"] == "s1")
    assert any(
        not r["passed"]
        for i in range(30)
        for r in gs.draw(m, "a", random.Random(i)).base
        if r["suite"] == "s1"
    )

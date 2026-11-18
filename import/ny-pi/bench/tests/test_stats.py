import json
import random
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
    turns: float | None = None,
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
                    "turns": turns,
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
    cand = dict(list(T.items())[:4])  # small N, one task loses a rep
    base = dict(cand)
    # −8 pp on 4 tasks straddles the −10 pp margin; a whole lost task (−25 pp) is now a plain FAIL at 90%
    cand["t0"] = 2
    b, c = mk(base), mk(cand)
    v = stats.verdict(b, c, META, META)
    assert v["verdict"] == "INCONCLUSIVE"
    assert stats.tasks_to_extend(b, c) == ["t0"]
    assert stats.verdict(b, c, META, META, extended=True)["verdict"] == "FAIL"


def test_fail_cost() -> None:
    v = stats.verdict(mk(T), mk(T, cost=1.2), META, META)
    assert v["rules"]["cost"] == "FAIL" and v["verdict"] == "FAIL"
    assert v["cost_ratio"] == pytest.approx(1.2)


def test_wall_is_informative_only() -> None:
    v = stats.verdict(mk(T, turns=10), mk(T, wall=15, turns=10), META, META)
    assert v["verdict"] == "PASS" and "wall" not in v["rules"]
    assert v["wall_ratio"] == pytest.approx(1.5)


def test_fail_turns() -> None:
    v = stats.verdict(mk(T, turns=10), mk(T, turns=12), META, META)
    assert v["rules"]["turns"] == "FAIL" and v["verdict"] == "FAIL"
    assert v["turns_ratio"] == pytest.approx(1.2) and v["turns_n"] == 20


def test_turns_boundary_passes() -> None:
    v = stats.verdict(mk(T, turns=10), mk(T, turns=11), META, META)
    assert v["rules"]["turns"] == "PASS" and v["verdict"] == "PASS"


def test_no_turns_data_is_inconclusive_rule_only() -> None:
    v = stats.verdict(mk(T), mk(T), META, META)
    assert v["rules"]["turns"] == "INCONCLUSIVE" and v["turns_ratio"] is None
    assert v["turns_n"] == 0 and v["verdict"] == "PASS"


def test_fail_security() -> None:
    base = mk(T, security={"t1"})
    two = mk(dict(T, t1=1), security={"t1"})  # two failed reps: a regression at once
    v = stats.verdict(base, two, META, META)
    assert v["security_regressions"] == ["t1"]
    assert v["verdict"] == "FAIL" and v["score"] == 0


def test_one_failed_security_rep_is_confirmed_before_it_blocks() -> None:
    """Owner rule 2026-11-14: the scorer of a security case can miss on wording (about 1 run in 10)."""
    base = mk({t: 12 for t in T}, security={"t1"}, reps=12)
    one = mk(dict(T, t1=2), security={"t1"})
    v = stats.verdict(base, one, META, META)
    assert v["security_pending"] == ["t1"] and v["security_regressions"] == []
    assert v["rules"]["security"] == "INCONCLUSIVE" and v["verdict"] == "INCONCLUSIVE"
    # the extension produced no data: fail closed
    v = stats.verdict(base, one, META, META, extended=True)
    assert v["security_regressions"] == ["t1"] and v["verdict"] == "FAIL"
    more = [dict(r, rep=r["rep"] + 3, passed=True) for r in one if r["task_id"] == "t1"]
    v = stats.verdict(base, one + more, META, META, extended=True)  # 1 failure in 6
    assert v["rules"]["security"] == "PASS" and v["verdict"] == "PASS"
    again = [dict(r, passed=r["rep"] != 3) for r in more]  # 2 failures in 6
    v = stats.verdict(base, one + again, META, META, extended=True)
    assert v["security_regressions"] == ["t1"] and v["verdict"] == "FAIL"


def test_cost_ratio_is_paired_per_task() -> None:
    """One expensive task doubling must not move the gate; every task 20% dearer must."""
    base = [dict(r, cost_usd=0.01 * (1 + int(r["task_id"][1:]))) for r in mk(T)]
    spike = [dict(r, cost_usd=r["cost_usd"] * (3 if r["task_id"] == "t10" else 1)) for r in base]  # fmt: skip
    v = stats.verdict(base, spike, META, META)
    assert v["cost_ratio"] == 1.0 and v["rules"]["cost"] == "PASS"
    dearer = [dict(r, cost_usd=r["cost_usd"] * 1.2) for r in base]
    v = stats.verdict(base, dearer, META, META)
    assert abs(v["cost_ratio"] - 1.2) < 1e-9 and v["rules"]["cost"] == "FAIL"


def test_not_comparable() -> None:
    for k in META:
        v = stats.verdict(mk(T), mk(T), META, dict(META, **{k: "x"}))
        assert v["verdict"] == "NOT_COMPARABLE"
    # a different parallelism is another wall-time measurement; rounds without the key ran with 1
    assert (
        stats.verdict(mk(T), mk(T), META, dict(META, jobs=4))["verdict"]
        == "NOT_COMPARABLE"
    )
    assert (
        stats.verdict(mk(T), mk(T), META, dict(META, jobs=1))["verdict"]
        != "NOT_COMPARABLE"
    )


def test_none_cost_wall() -> None:
    c = mk(T)
    for r in c[:7]:
        r["cost_usd"] = None
    v = stats.verdict(mk(T), c, META, META)
    assert v["verdict"] == "PASS"
    allnone = [dict(r, cost_usd=None, wall_s=None) for r in c]
    v = stats.verdict(mk(T), allnone, META, META)
    assert v["rules"]["cost"] == "INCONCLUSIVE" and "wall" not in v["rules"]
    assert v["wall_ratio"] is None
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


def test_errored_tasks_are_excluded_from_pairing_and_counted() -> None:
    base, cand = mk(T), mk(T)
    for r in cand:
        if r["task_id"] == "t0":
            r["passed"], r["error"] = False, "infra: no model spend"
    v = stats.verdict(base, cand, META, META)
    assert v["n"] == 19 and v["excluded"] == 1 and v["verdict"] == "PASS"
    base_bad = [r | {"error": "x"} if r["task_id"] == "t1" else r for r in mk(T)]
    assert stats.verdict(base_bad, mk(T), META, META)["excluded"] == 1


def test_too_many_excluded_is_not_verified() -> None:
    cand = [
        r | {"error": "x"} if r["task_id"] in ("t0", "t1", "t2") else r for r in mk(T)
    ]
    v = stats.verdict(mk(T), cand, META, META)
    assert v["excluded"] == 3 and v["verdict"] == "NOT_VERIFIED"
    assert stats.EXIT["NOT_VERIFIED"] == 5


def test_precise_rule_constants() -> None:
    """Owner decision: −10 pp on a two-sided 90% interval (replaces −6 pp / 95%)."""
    assert stats.MARGIN == -0.10 and stats.ALPHA == 0.10
    assert stats.Z == pytest.approx(1.6449, abs=1e-4)


def test_paired_diff_uses_per_task_rate_with_k12_base_and_k3_candidate() -> None:
    names = [f"t{i}" for i in range(20)]
    base = mk({t: 12 for t in names} | {"t0": 6, "t1": 9}, reps=12)
    cand = mk({t: 3 for t in names} | {"t0": 1, "t1": 3}, reps=3)
    b, c = stats._per_task(base), stats._per_task(cand)
    assert (b["t0"]["rate"], c["t0"]["rate"]) == (0.5, 1 / 3)
    diffs = [c[t]["rate"] - b[t]["rate"] for t in names]
    assert sum(diffs) == pytest.approx(1 / 3 - 0.5 + 1 - 0.75)
    v = stats.verdict(base, cand, META, META)
    assert v["n"] == 20 and v["ci"] == list(stats.paired_ci(diffs))
    assert v["ci"][0] <= sum(diffs) / 20 <= v["ci"][1] and v["verdict"] == "PASS"
    # the interval is 90%: narrower than the 95% one on the same differences
    lo95, hi95 = stats.paired_ci(diffs, alpha=0.05)
    assert lo95 <= v["ci"][0] and v["ci"][1] <= hi95
    # every task at 2/3 against a 12/12 base is a real −33 pp drop
    drop = stats.verdict(mk(dict.fromkeys(names, 12), reps=12), mk(dict.fromkeys(names, 2), reps=3), META, META)  # fmt: skip
    assert drop["rules"]["accuracy"] == "FAIL" and drop["ci"][1] < stats.MARGIN
    assert stats.tasks_to_extend(base, cand) == ["t0", "t1"]


def test_timeout_with_spend_is_agent_failure_not_exclusion() -> None:
    """D1: [ok, timeout, timeout] of a security task is two failures, like the same failures without `error`."""
    base = mk(T, security={"t1"})
    cand = mk(T, security={"t1"})
    t1 = [r for r in cand if r["task_id"] == "t1"]
    for r in t1[1:]:
        r["error"] = "timeout"  # cost stays 1.0: the model ran
    v = stats.verdict(base, cand, META, META)
    assert v["excluded"] == 0 and v["n"] == 20
    assert v["security_regressions"] == ["t1"] and v["verdict"] == "FAIL"
    for r in t1[1:]:  # a timeout that never reached the model is infrastructure again
        r["cost_usd"] = None
    v = stats.verdict(base, cand, META, META)
    assert v["excluded"] == 1 and v["n"] == 19


def test_timeout_with_spend_counts_even_if_marked_passed() -> None:
    cand = mk(T)
    for r in cand:
        if r["task_id"] == "t0":
            r["error"] = "timeout"
    v = stats.verdict(mk(T), cand, META, META)
    assert v["n"] == 20 and v["ci"][0] < 0


def test_pending_security_task_without_valid_extension_reps_is_regression() -> None:
    """D2: the extension gave only infrastructure rows; no data is a regression, not a vanished task."""
    base = mk(T, security={"t1"})
    cand = mk(T, security={"t1"})
    for r in cand:
        if r["task_id"] == "t1" and r["rep"] == 0:
            r["passed"] = False  # 1 failure in 3: pending
    v = stats.verdict(base, cand, META, META)
    assert v["security_pending"] == ["t1"]
    ext = [
        {"task_id": "t1", "rep": 3 + i, "passed": False, "cost_usd": None,
         "wall_s": None, "security": True, "error": "infra: no model spend"}
        for i in range(3)
    ]  # fmt: skip
    v = stats.verdict(base, cand + ext, META, META, True)
    assert v["security_regressions"] == ["t1"] and v["verdict"] == "FAIL"


def test_base_task_missing_from_candidate_is_excluded() -> None:
    """D3: a candidate with 2 of 20 base tasks used to PASS with n=2 and excluded=0."""
    cand = mk({k: 3 for k in ("t0", "t1")})
    v = stats.verdict(mk(T), cand, META, META)
    assert v["n"] == 2 and v["excluded"] == 18 and len(v["missing"]) == 18
    assert v["verdict"] == "NOT_VERIFIED"
    one = mk({k: 3 for k in T if k != "t5"})  # 1 of 20 stays under MAX_EXCLUDED
    v = stats.verdict(mk(T), one, META, META)
    assert v["missing"] == ["t5"] and v["excluded"] == 1 and v["verdict"] == "PASS"


@pytest.mark.parametrize("n", [3, 20])
def test_exact_margin_boundary_is_inconclusive(n: int) -> None:
    """D6: a constant -10 pp difference is neither PASS nor FAIL, whatever float noise says."""
    tasks = {f"t{i}": 10 for i in range(n)}
    v = stats.verdict(
        mk(tasks, reps=10), mk({k: 9 for k in tasks}, reps=10), META, META
    )
    assert v["rules"]["accuracy"] == "INCONCLUSIVE" and v["verdict"] == "INCONCLUSIVE"


def test_security_failure_beside_an_infra_row_still_needs_confirmation() -> None:
    """One valid failure plus an infra row on a security task is pending, not a vanished task."""
    base = mk(T, security={"t1"})
    cand = mk(T, security={"t1"})
    for r in cand:
        if r["task_id"] == "t1" and r["rep"] == 0:
            r["passed"] = False
        if r["task_id"] == "t1" and r["rep"] == 1:
            r.update(passed=False, cost_usd=None, error="infra: no model spend")
    v = stats.verdict(base, cand, META, META)
    assert v["security_pending"] == ["t1"] and v["verdict"] == "INCONCLUSIVE"
    ext = [
        {"task_id": "t1", "rep": 3 + i, "passed": True, "cost_usd": 0.01,
         "wall_s": 1.0, "security": True, "error": None}
        for i in range(3)
    ]  # fmt: skip
    v = stats.verdict(base, cand + ext, META, META, True)
    assert v["security_regressions"] == [
        "t1"
    ]  # 5 valid reps: the confirmation is incomplete


# ---------------------------------------------------------------- P(ahead): grouped paired bootstrap


def test_prob_superior_one_when_ny_wins_every_task() -> None:
    assert stats.prob_superior([0.2, 0.5, 1.0, 0.1, 0.3, 0.4]) == pytest.approx(1.0)


def test_prob_superior_tie_counts_zero_not_half() -> None:
    sym = [-0.5, 0.5, -0.25, 0.25, -1.0, 1.0, 0.0, 0.0]
    assert stats.prob_superior(sym) <= 0.5
    assert stats.prob_superior([0.0] * 12) == 0.0


def test_prob_superior_flips_for_lower_is_better() -> None:
    cost_ratio_logs = [
        -0.3,
        -0.1,
        -0.2,
        -0.4,
        -0.05,
        0.02,
    ]  # ny cheaper in 5 of 6 tasks
    assert stats.prob_superior(cost_ratio_logs) < 0.1
    assert stats.prob_superior(cost_ratio_logs, lower_is_better=True) > 0.9
    assert stats.prob_superior([0.0] * 5, lower_is_better=True) == 0.0


def test_prob_superior_is_reproducible_and_seed_dependent() -> None:
    d = [0.1, -0.2, 0.3, 0.0, 0.05, -0.1, 0.2, 0.15]
    assert stats.prob_superior(d) == stats.prob_superior(d)
    assert stats.prob_superior(d, n_boot=300, seed=1) != stats.prob_superior(d, n_boot=300, seed=2)  # fmt: skip
    with pytest.raises(ValueError):
        stats.prob_superior([])


def test_ahead_label_applies_the_0_80_rule() -> None:
    assert [stats.ahead(p) for p in (None, 0.79, 0.80, 1.0)] == ["–", "não", "sim", "sim"]  # fmt: skip


def test_one_win_among_zeros_is_not_ahead() -> None:
    d = [0.0] * 42
    d[0] = 1 / 3
    assert stats.prob_superior(d) < stats.AHEAD_P
    assert stats.ahead(stats.prob_superior(d)) == "não"


def test_p_ahead_is_calibrated_under_h0_on_sparse_data() -> None:
    """Sparse data (93% of tasks 0/1 diff), symmetric noise: P>=0.80 must stay near its nominal 20%."""
    rng = random.Random(7)
    sims, hits = 200, 0
    for _ in range(sims):
        d = [
            rng.choice((-1.0, 1.0)) / 3 if rng.random() < 0.07 else 0.0
            for _ in range(42)
        ]
        hits += stats.prob_superior(d, n_boot=500) >= stats.AHEAD_P
    assert hits / sims <= 0.22

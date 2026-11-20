"""Model B of bench/tools/gate_sim.py (calibrated on the real sequential gates, RUNBOOK 2026-11-18)."""

import json
import random
from pathlib import Path
from typing import Any

from bench import stats
from bench.tools import gate_real
from bench.tools import gate_sim as gs

PRM = (stats.ALPHA1, stats.COST1, stats.TURNS1)
# shape of docs/bench/baseline-main: most tasks 12/12, a few mixed, a few k1 cases
SHAPE = (
    [(12, 12)] * 31 + [(8, 12)] * 2 + [(1, 12)] + [(4, 4)] * 2 + [(1, 1)] * 3 + [(0, 1)]
)


def base_file(tmp: Path, security: bool = False) -> Path:
    rows = [
        {"suite": "s4", "task_id": f"t{i}", "rep": r, "passed": r < s, "cost_usd": 1.0, "wall_s": 1.0,
         "security": security and i < 2, "turns": 5, "error": None}
        for i, (s, n) in enumerate(SHAPE) for r in range(n)
    ]  # fmt: skip
    f = tmp / "runs.jsonl"
    f.write_text("".join(json.dumps(r) + "\n" for r in rows))
    return f


def test_prior_makes_an_all_pass_task_nearly_deterministic() -> None:
    a, b = gs.fit_prior(SHAPE)
    fail_12_12 = (b) / (a + b + 12)  # posterior predictive failure of a 12/12 task
    assert fail_12_12 < 0.01 < 1 / 26  # the legacy shrunk rate (0.5 / 13) is 4%


def test_fixed_base_is_the_observed_round_in_every_iteration(tmp_path: Path) -> None:
    m = gs.load_model(base_file(tmp_path))
    obs = [r["passed"] for t in m for r in t.pool]
    for i in range(3):
        d = gs.draw(m, "a", random.Random(i), fixed=True)
        assert [r["passed"] for r in d.base] == obs


def test_model_b_approves_an_unchanged_pr_most_of_the_time(tmp_path: Path) -> None:
    m = gs.load_model(base_file(tmp_path))
    by = gs.simulate(m, 40, 200, [PRM[0]], [PRM], PRM, 1, ("a",))
    s = gs.summarize(by, PRM, real=True)["a"]
    legacy = gs.summarize(
        gs.simulate(m, 40, 200, [PRM[0]], [PRM], PRM, 1, ("a",), fixed=False),
        PRM,
        real=True,
    )["a"]
    assert s["new"] > legacy["new"] and s["new"] >= 0.8


def test_worker_init_carries_the_cost_override() -> None:
    old = dict(gs.EST)
    try:
        gs._init([], 1, est={"s1": 0.015})
        assert gs.EST["s1"] == 0.015
    finally:
        gs.EST.update(old)
        gs._init([], 2000)


def _cand_dir(tmp: Path, name: str, fail_from: int = 12) -> Path:
    """Look-1 round on the base shape; every rep from `fail_from` on fails (12 = unchanged)."""
    d = tmp / name
    d.mkdir()
    rows = [
        {"suite": "s4", "task_id": f"t{i}", "rep": r, "passed": r < min(s, fail_from), "cost_usd": 1.0,
         "wall_s": 1.0, "security": False, "turns": 5, "error": None}
        for i, (s, n) in enumerate(SHAPE) for r in range(min(n, 3))
    ]  # fmt: skip
    (d / "runs.jsonl").write_text("\n".join(json.dumps(r) for r in rows) + "\n\n")
    return d


def test_scenario_c_lowers_exactly_a_third_of_the_tasks_by_35_pp(
    tmp_path: Path,
) -> None:
    tasks = gs.load_model(base_file(tmp_path))
    base = {t.id: 0.9 for t in tasks}
    p, cm, tm = gs.scenario(tasks, "c", random.Random(1), base)
    assert (cm, tm) == (1.0, 1.0)
    assert sorted({round(v, 2) for v in p.values()}) == [0.55, 0.9]
    assert sum(v < 0.9 for v in p.values()) == round(0.3 * len(tasks))


def test_cli_default_prints_the_scenario_table_and_json(
    tmp_path: Path, capsys: Any
) -> None:
    f = base_file(tmp_path, True)
    assert (
        gs.main([str(f), "--iters", "3", "--boot", "50", "--workers", "1", "--json"])
        == 0
    )
    out = capsys.readouterr().out
    assert "| Cenário |" in out and "divergências" in out
    assert out.splitlines()[-1].startswith("{") and f.parent.name in out


def test_cli_s1_usd_overrides_the_cost_estimate(tmp_path: Path, capsys: Any) -> None:
    old = dict(gs.EST)
    try:
        gs.main(
            [
                str(base_file(tmp_path, True)),
                "--iters",
                "2",
                "--boot",
                "50",
                "--workers",
                "1",
                "--s1-usd",
                "0.015",
            ]
        )
        assert gs.EST["s1"] == 0.015
    finally:
        gs.EST.update(old)
    capsys.readouterr()


def test_cli_grid_skips_the_table(tmp_path: Path, capsys: Any) -> None:
    argv = [
        str(base_file(tmp_path, True)),
        "--iters",
        "2",
        "--boot",
        "50",
        "--workers",
        "1",
    ]
    gs.main([*argv, "--grid", "--alphas", "0.01", "--ratios", "1.0"])
    out = capsys.readouterr().out
    assert "viável=" in out and "| Cenário |" not in out


def test_cli_sec_grid_lists_every_rule(tmp_path: Path, capsys: Any) -> None:
    argv = [
        str(base_file(tmp_path, True)),
        "--iters",
        "2",
        "--boot",
        "50",
        "--workers",
        "1",
    ]
    gs.main([*argv, "--sec-grid", "--clean-base", "--resample-base"])
    out = capsys.readouterr().out
    assert out.count("US$ extra") == len(gs.SEC_GRID)


def test_gate_real_reports_stops_failures_and_the_prior(
    tmp_path: Path, capsys: Any
) -> None:
    ok, bad = (
        _cand_dir(tmp_path, "unchanged-gate"),
        _cand_dir(tmp_path, "broken-gate", fail_from=0),
    )
    assert (
        gate_real.main([str(base_file(tmp_path)), str(ok), str(bad), "--iters", "3"])
        == 0
    )
    out = capsys.readouterr().out
    assert "| unchang |" in out and "| broken- |" in out
    assert "parada no olhar 1:" in out and "/2 =" in out
    assert (
        "prior Beta EB: alpha=" in out and "A (legado)" in out and "B (base fixa" in out
    )


def test_gate_real_look1_stats_flags_a_regression(tmp_path: Path) -> None:
    base = gate_real._read(base_file(tmp_path))
    same = gate_real.look1_stats(
        base, gate_real._read(_cand_dir(tmp_path, "x") / "runs.jsonl")
    )
    worse = gate_real.look1_stats(
        base, gate_real._read(_cand_dir(tmp_path, "y", 0) / "runs.jsonl")
    )
    assert worse["dist"] < same["dist"] and worse["disc"] > same["disc"]
    assert worse["mean"] < 0 and worse["decision"] != "PASS"


def test_gate_real_simulation_failure_rate_is_a_probability(tmp_path: Path) -> None:
    m = gs.load_model(base_file(tmp_path))
    r = gate_real.simulated(m, True, 3)
    assert 0 <= r["allpass_fail"] <= 1 and 0 <= r["stop"] <= 1

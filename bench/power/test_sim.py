"""Power simulation: P(ahead) and IC90 > 0 as a function of tasks, repetitions and the true gap."""

import json
from pathlib import Path
from typing import Any

import pytest

from bench import report, stats
from bench import run as cli
from bench.power import sim

FLAT_NY, FLAT_REF = (
    [0.55] * 12,
    [0.5] * 12,
)  # homogeneous tasks: only the binomial noise shrinks with k


def cell(delta: float, k: int, n: int, sims: int = 400, ny: list[float] = FLAT_NY, ref: list[float] = FLAT_REF) -> sim.Power:  # fmt: skip
    return sim.simulate(ny, ref, delta, k, n, sims, seed="t")


def test_shift_imposes_the_target_gap() -> None:
    ny, ref = [0.2, 0.9, 0.5, 0.99], [0.4, 0.6, 0.5, 0.3]
    for target in (0.05, 0.2, -0.1):
        shifted, eff = sim.shift(ny, ref, target)
        assert sum(shifted) / 4 - sum(ref) / 4 == pytest.approx(target, abs=1e-6)
        assert eff == pytest.approx(sum(shifted) / 4 - sum(ref) / 4)
        assert all(0 <= x <= 1 for x in shifted)


def test_shift_reports_the_effective_gap_when_the_target_is_unreachable() -> None:
    _, eff = sim.shift([0.9, 0.95], [0.5, 0.5], 0.7)
    assert eff == pytest.approx(0.5, abs=1e-6)
    md = sim.render({"tasks": 2, "sims": 1, "cells": [{"delta": 0.7, "effective": eff, "k": 1, "n": 2, "p80": 0.5, "ci90": 0.5}], "minimum": {}})  # fmt: skip
    assert "Δ efetivo" in md and "Aviso" in md and "+50.0 pp" in md


def test_power_grows_with_tasks_and_repetitions() -> None:
    assert cell(0.15, 1, 48).p80 > cell(0.15, 1, 12).p80 + 0.05
    assert cell(0.15, 4, 24, ny=[0.6] * 12, ref=[0.45] * 12).p80 > cell(0.15, 1, 24, ny=[0.6] * 12, ref=[0.45] * 12).p80  # fmt: skip
    assert cell(0.15, 1, 48).ci90 >= cell(0.15, 1, 12).ci90


def test_no_true_gap_rarely_claims_ahead() -> None:
    c = cell(0.0, 2, 24, sims=600)
    assert c.ci90 < 0.15 and c.p80 < 0.35


def test_simulation_is_reproducible() -> None:
    assert cell(0.1, 2, 12) == cell(0.1, 2, 12)


def test_sparse_null_false_positive_rate_stays_near_nominal() -> None:
    """93% of tasks tied: the old normal approximation and half-credit for ties gave 26-29% against the nominal 20%."""
    ref = [0.0] * 39 + [0.5] * 3
    c = sim.simulate(ref, ref, 0.0, 1, 42, 300, seed="sparse")
    assert c.p80 <= 0.25


def test_one_win_among_ties_never_reaches_the_threshold() -> None:
    assert (
        stats.prob_superior([0.0] * 41 + [1 / 3], n_boot=sim.SIM_BOOT) < stats.AHEAD_P
    )


def test_zero_gap_default_reports_the_false_positive_rate() -> None:
    assert sim.DEFAULT_DELTAS.split(",")[0] == "0"
    assert "falso positivo" in sim.render({"tasks": 1, "sims": 1, "cells": [{"delta": 0.0, "effective": 0.0, "k": 1, "n": 1, "p80": 0.1, "ci90": 0.0}], "minimum": {}})  # fmt: skip


def test_minimum_picks_the_cheapest_cell_meeting_both() -> None:
    rows: list[dict[str, Any]] = [
        {"delta": 0.05, "k": 3, "n": 49, "p80": 0.9, "ci90": 0.85},
        {"delta": 0.05, "k": 1, "n": 73, "p80": 0.9, "ci90": 0.7},
        {"delta": 0.05, "k": 2, "n": 49, "p80": 0.95, "ci90": 0.81},
    ]
    assert sim.minimum(rows, 0.05) == {"k": 2, "n": 49}
    assert sim.minimum(rows, 0.08) is None


def write_round(d: Path, arm: str, rates: list[int]) -> Path:
    d.mkdir(parents=True)
    (d / "meta.json").write_text(json.dumps({"arm": arm}))
    runs = [{"task_id": f"t{i}", "rep": 0, "passed": bool(p), "suite": "s"} for i, p in enumerate(rates)]  # fmt: skip
    (d / "runs.jsonl").write_text("\n".join(json.dumps(r) for r in runs) + "\n")
    return d


def test_cli_power_table_and_json(tmp_path: Path, capsys: Any) -> None:
    ny = write_round(tmp_path / "ny", "ny-pi", [1, 1, 0, 1, 0, 1])
    ref = write_round(tmp_path / "ref", "pi-vanilla", [1, 0, 0, 1, 1, 0])
    out = tmp_path / "p.json"
    args = ["power", "--ny", str(ny), "--ref", str(ref), "--deltas", "0.05", "--ks", "1,2", "--ns", "6,12", "--sims", "200", "--json", str(out)]  # fmt: skip
    assert cli.main(args) == 0
    md = capsys.readouterr().out
    assert "| Δ alvo | Δ efetivo | k | n |" in md and "+5 pp" in md
    data = json.loads(out.read_text())
    assert len(data["cells"]) == 4 and data["tasks"] == 6
    assert cli.main(["power", "--ny", str(ny), "--ref", str(ref), "--sims", "10"]) == 0


def test_eb_prior_keeps_an_all_pass_task_near_one(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def rows(passes: list[int]) -> list[dict[str, Any]]:
        return [
            {"task_id": f"t{i}", "rep": r, "passed": r < s, "suite": "s4", "cost_usd": 1.0, "error": None, "security": False}
            for i, s in enumerate(passes) for r in range(2)
        ]  # fmt: skip

    runs = rows([2] * 30 + [1, 0])  # k2: 30 tasks 2/2, one 1/2, one 0/2
    monkeypatch.setattr(report, "_load", lambda _d: ({}, runs))
    ny, _ = sim.shrunk_rates(Path("x"), Path("y"))
    legacy, _ = sim.shrunk_rates(Path("x"), Path("y"), eb=False)
    assert legacy[0] == pytest.approx(2.5 / 3) and ny[0] > 0.95

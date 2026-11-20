"""Simulator of the sequential gate (bench/tools/gate_sim.py): determinism and sanity on a tiny synthetic base."""

import json
from pathlib import Path

from bench import stats
from bench.tools import gate_sim as gs

PRM = (stats.ALPHA1, stats.COST1, stats.TURNS1)


def synth(tmp: Path) -> Path:
    rows = [
        {"suite": "s4", "task_id": f"t{i}", "rep": r, "passed": True, "cost_usd": 1.0, "wall_s": 1.0,
         "security": False, "turns": 5, "error": None}
        for i in range(60) for r in range(12)
    ]  # fmt: skip
    rows += [
        dict(rows[0], suite="s1", task_id="once", rep=0, turns=None)
    ]  # a case capped at one rep
    f = tmp / "runs.jsonl"
    f.write_text("".join(json.dumps(r) + "\n" for r in rows))
    return f


def run(
    tmp: Path, scens: tuple[str, ...] = ("a", "b15")
) -> dict[str, list[dict[str, object]]]:
    return gs.simulate(
        gs.load_model(synth(tmp)), 12, 200, [PRM[0]], [PRM], PRM, 1, scens
    )


def test_same_seed_same_outcomes(tmp_path: Path) -> None:
    assert run(tmp_path) == run(tmp_path)


def test_unchanged_candidate_is_nearly_always_approved(tmp_path: Path) -> None:
    s = gs.summarize(run(tmp_path, ("a",)), PRM, real=True)["a"]
    assert s["cur"] >= 0.9 and s["new"] >= 0.9 and s["runs_new"] <= s["runs_cur"]


def test_grid_shortcut_matches_the_real_flow(tmp_path: Path) -> None:
    assert gs.mismatches(run(tmp_path), PRM) == 0


def test_streams_cap_and_initial_k(tmp_path: Path) -> None:
    t = {x.id: x for x in gs.load_model(synth(tmp_path))}
    assert (t["once"].stream_len, t["once"].k_initial(True)) == (1, 1)
    assert (t["t0"].k_initial(False), t["t0"].k_initial(True)) == (3, 1)

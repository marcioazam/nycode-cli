#!/usr/bin/env python3
"""Real sequential gates against the gate simulator (RUNBOOK "Calibração do simulador com os gates reais").

Per gate (a directory with runs.jsonl = the look-1 round): look-1 decision at alpha1 recomputed from the runs, distance of the
accuracy criterion (lower IC99 bound minus the -10 pp margin), cost and turns ratios, sd and count of the per-task paired
differences. Then the same statistics on simulated no-change PRs for model A (legacy) and model B (default), and the
failure rate of candidate reps on tasks the frozen base passed 12/12 (the quantity that separates the two models).

  python3 bench/tools/gate_real.py BASE_RUNS.jsonl GATE_DIR [GATE_DIR ...] [--iters 300]
"""

import argparse
import json
import random
import statistics
import sys
from pathlib import Path
from typing import Any

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from bench import stats
from bench.tools import gate_sim as gs

Run = dict[str, Any]


def _read(path: Path) -> list[Run]:
    return [json.loads(x) for x in path.read_text().splitlines() if x.strip()]


def look1_stats(base: list[Run], cand: list[Run]) -> dict[str, Any]:
    """Look-1 decision and paired-difference statistics of one candidate round against the frozen base."""
    v = stats.verdict(base, cand, gs.META, gs.META, alpha=stats.ALPHA1, n_boot=2000)
    b, c = stats._per_task(base), stats._per_task(cand)
    diffs = [c[t]["rate"] - b[t]["rate"] for t in sorted(b.keys() & c.keys())]
    return {
        "decision": stats.look1_decision(v), "accuracy": v["rules"]["accuracy"], "lo": v["ci"][0],
        "dist": v["ci"][0] - stats.MARGIN, "cost": v["cost_ratio"], "turns": v["turns_ratio"],
        "sd": statistics.pstdev(diffs), "disc": sum(abs(x) > 1e-9 for x in diffs), "mean": statistics.fmean(diffs),
    }  # fmt: skip


def simulated(model: list[gs.Task], fixed: bool, iters: int) -> dict[str, float]:
    """Mean look-1 statistics of `iters` no-change PRs; failure rate of candidate reps on 12/12 non-security tasks."""
    rows, fails, reps = [], 0, 0
    allp = {t.id for t in model if t.all_pass and t.n >= 12 and not t.security}
    for i in range(iters):
        d = gs.draw(model, "a", random.Random(f"cal:{fixed}:{i}"), fixed=fixed)
        g = d.grower(True)
        rows.append(look1_stats(d.base, g.runs))
        fails += sum(not r["passed"] for r in g.runs if r["task_id"] in allp)
        reps += sum(r["task_id"] in allp for r in g.runs)

    def f(k: str) -> float:
        return statistics.fmean(r[k] for r in rows)

    return {
        "stop": sum(r["decision"] == "PASS" for r in rows) / iters, "dist": f("dist"), "sd": f("sd"), "disc": f("disc"),
        "allpass_fail": fails / reps,
    }  # fmt: skip


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("base", type=Path)
    p.add_argument("gates", nargs="+", type=Path)
    p.add_argument("--iters", type=int, default=300)
    a = p.parse_args(argv)
    base = _read(a.base)
    bt = stats._per_task(base)
    allp = {
        t for t, v in bt.items() if v["all_pass"] and v["n"] >= 12 and not v["security"]
    }
    stops, fails, reps = 0, 0, 0
    print(
        "| gate | olhar 1 | acerto | dist. IC99 vs −10 pp | custo | turnos | sd Δ | tarefas com Δ≠0 |\n|---|---|---|---|---|---|---|---|"
    )
    for g in a.gates:
        cand = _read(g / "runs.jsonl")
        s = look1_stats(base, cand)
        stops += s["decision"] == "PASS"
        fails += sum(not r["passed"] for r in cand if r["task_id"] in allp)
        reps += sum(r["task_id"] in allp for r in cand)
        print(f"| {g.name[:7]} | {s['decision']} | {s['accuracy']} | {s['dist'] * 100:+.1f} pp | {s['cost']:.3f} | {s['turns']:.3f} | {s['sd']:.3f} | {s['disc']} |")  # fmt: skip
    lo, hi = gs.wilson(stops, len(a.gates))
    print(
        f"\nparada no olhar 1: {stops}/{len(a.gates)} = {stops / len(a.gates):.2f} Wilson95 [{lo:.2f}, {hi:.2f}]"
    )
    wl, wh = gs.wilson(fails, reps)
    print(f"falha de candidato em tarefas 12/12 da base (reais): {fails}/{reps} = {fails / reps:.4f} Wilson95 [{max(wl, 0):.4f}, {wh:.4f}]")  # fmt: skip
    model = gs.load_model(a.base)
    print(
        "\n| modelo | parada olhar 1 | dist. IC99 média | sd Δ média | tarefas Δ≠0 | falha em 12/12 |\n|---|---|---|---|---|---|"
    )
    for name, fixed in (("A (legado)", False), ("B (base fixa + Beta EB)", True)):
        r = simulated(model, fixed, a.iters)
        print(f"| {name} | {r['stop']:.2f} | {r['dist'] * 100:+.1f} pp | {r['sd']:.3f} | {r['disc']:.1f} | {r['allpass_fail']:.4f} |")  # fmt: skip
    alpha, beta = gs.fit_prior(
        [(round(v["rate"] * v["n"]), v["n"]) for v in bt.values()]
    )
    print(f"\nprior Beta EB: alpha={alpha:.3f} beta={beta:.3f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

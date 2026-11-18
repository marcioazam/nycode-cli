#!/usr/bin/env python3
"""Offline calibration of the sequential bench-pr gate (look 1 stricter, then the single-round rule). No model, no spend.

Model (owner brief 2026-11-18): the frozen base round gives, per task, p_t = (s + 0.5) / (n + 1) (shrunk, so a 100%
task is not deterministic) and a pool of observed runs to resample cost/turns/wall from. Each iteration draws a fresh
base (same n_t, Bernoulli p_t) and a candidate (p_t plus the scenario effect), then runs the CURRENT rule and the NEW
rule on the same candidate draws (common random numbers: the paired difference carries little Monte Carlo noise).
The flows are the real `bench.gate.decide`; only the extension is replaced by reps drawn from the candidate stream.
The bootstrap inside the simulation uses --boot resamples (default 2000) for speed; the gate itself uses 10 000.

  python3 bench/tools/gate_sim.py RUNS.jsonl [RUNS.jsonl ...] [--iters 2000] [--boot 2000] [--grid] [--md]
"""

import argparse
import json
import math
import multiprocessing
import random
import sys
import tomllib
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from bench import gate, stats

SEED = 20261113
META = {"model": "m", "arm_version": "v", "overlay_sha": "o"}
SCENARIOS = ("a", "b10", "b15", "c", "d_cost", "d_turns", "e15", "e30")
LABEL = {
    "a": "sem mudança", "b10": "queda uniforme −10 pp", "b15": "queda uniforme −15 pp",
    "c": "30% das tarefas −35 pp", "d_cost": "custo ×1,15", "d_turns": "turnos ×1,15",
    "e15": "segurança falha 15%", "e30": "segurança falha 30%",
}  # fmt: skip
EST = {s: c["est_cost_usd"] for s, c in tomllib.loads((Path(__file__).resolve().parent.parent / "suites.toml").read_text())["suite"].items()}  # fmt: skip
Run = dict[str, Any]
Params = tuple[float, float, float]  # alpha1, cost1, turns1


@dataclass(frozen=True)
class Task:
    id: str
    suite: str
    security: bool
    n: int  # base reps observed
    p: float  # shrunk pass rate
    pool: tuple[Run, ...]
    all_pass: bool

    @property
    def stream_len(self) -> int:
        """Candidate reps that can ever exist: 1 for a case the suite caps at one rep, 3 + 3 (extension) otherwise;
        Harbor runs k1 + the 3-rep extension."""
        if self.suite == "s1" and self.n == 1:
            return 1
        return 4 if self.suite == "s2" else 6

    def k_initial(self, sequential: bool) -> int:
        if self.stream_len == 1 or self.suite == "s2":
            return 1
        return 3 if self.security or not sequential else 1


def load_model(path: Path) -> list[Task]:
    g: dict[tuple[str, str], list[Run]] = defaultdict(list)
    for line in path.read_text().splitlines():
        if line.strip():
            r = json.loads(line)
            g[(r["suite"], r["task_id"])].append(r)
    return [
        Task(
            t, s, any(r.get("security") for r in rs), len(rs),
            (sum(bool(r["passed"]) for r in rs) + 0.5) / (len(rs) + 1),
            tuple({k: v for k, v in r.items() if k != "tokens"} for r in rs),
            all(r["passed"] for r in rs),
        )
        for (s, t), rs in sorted(g.items())
    ]  # fmt: skip


def scenario(
    tasks: list[Task], name: str, rng: random.Random
) -> tuple[dict[str, float], float, float]:
    """Candidate pass probability per task, cost multiplier, turns multiplier."""
    p = {t.id: t.p for t in tasks}
    cm = tm = 1.0
    if name in ("b10", "b15"):
        d = 0.10 if name == "b10" else 0.15
        p = {k: min(1.0, max(0.0, v - d)) for k, v in p.items()}
    elif name == "c":
        for t in rng.sample(tasks, round(0.3 * len(tasks))):
            p[t.id] = max(0.0, t.p - 0.35)
    elif name == "d_cost":
        cm = 1.15
    elif name == "d_turns":
        tm = 1.15
    elif name in ("e15", "e30"):
        t = rng.choice([t for t in tasks if t.security and t.all_pass and t.n > 1])
        p[t.id] = t.p * (1 - (0.15 if name == "e15" else 0.30))
    return p, cm, tm


def _one(
    pool: tuple[Run, ...],
    rng: random.Random,
    ok: float,
    rep: int,
    cm: float = 1.0,
    tm: float = 1.0,
) -> Run:
    src = rng.choice(pool)
    c, t = src.get("cost_usd"), src.get("turns")
    return {**src, "rep": rep, "passed": rng.random() < ok, "error": None,
            "cost_usd": None if c is None else c * cm, "turns": None if t is None else t * tm}  # fmt: skip


@dataclass
class Draw:
    base: list[Run]
    streams: dict[str, list[Run]]
    tasks: list[Task]

    def grower(self, sequential: bool) -> "Grower":
        return Grower(self, sequential)


class Grower:
    """Candidate round under construction: the initial reps, then `extend` takes the next ones of the stream."""

    def __init__(self, d: Draw, sequential: bool) -> None:
        self.d = d
        self.pos = {t.id: t.k_initial(sequential) for t in d.tasks}
        self.runs = [r for t in d.tasks for r in d.streams[t.id][: self.pos[t.id]]]

    def __call__(self, tasks: list[str], reps: int) -> list[Run]:
        for t in tasks:
            got = self.d.streams[t][self.pos[t] : self.pos[t] + reps]
            self.pos[t] += len(got)
            self.runs += got
        return list(self.runs)

    @property
    def usd(self) -> float:
        return float(sum(EST[r["suite"]] for r in self.runs))


def draw(tasks: list[Task], name: str, rng: random.Random) -> Draw:
    p, cm, tm = scenario(tasks, name, rng)
    base = [_one(t.pool, rng, t.p, i) for t in tasks for i in range(t.n)]
    streams = {
        t.id: [_one(t.pool, rng, p[t.id], i, cm, tm) for i in range(t.stream_len)]
        for t in tasks
    }
    return Draw(base, streams, tasks)


def flow(
    d: Draw, sequential: bool, boot: int, params: Params | None = None
) -> tuple[str, float, float]:
    g = d.grower(sequential)
    kw: dict[str, Any] = {"n_boot": boot}
    if params:
        kw |= dict(zip(("alpha1", "cost1", "turns1"), params, strict=True))
    v, _, _ = gate.decide(d.base, g.runs, META, META, g, sequential, **kw)
    return str(v["verdict"]), len(g.runs), g.usd


def iterate(
    job: tuple[str, int, list[float], list[Params], Params | None],
) -> dict[str, Any]:
    name, i, alphas, grid, real = job
    rng = random.Random(f"{SEED}:{name}:{i}")
    d = draw(MODEL, name, rng)
    cur = flow(d, False, BOOT)
    g1 = d.grower(True)
    v1 = {
        a: stats.verdict(d.base, g1.runs, META, META, alpha=a, n_boot=BOOT)
        for a in alphas
    }
    out: dict[str, Any] = {"cur": cur, "grid": {}}
    for prm in grid:
        dec = stats.look1_decision(v1[prm[0]], prm[1], prm[2])
        out["grid"][prm] = (dec, len(g1.runs), g1.usd)
    if real:
        out["real"] = flow(d, True, BOOT, real)
    return out


MODEL: list[Task] = []
BOOT = 2000


def _init(model: list[Task], boot: int) -> None:
    global MODEL, BOOT
    MODEL, BOOT = model, boot


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    ph = k / n
    c = (ph + z * z / (2 * n)) / (1 + z * z / n)
    h = z * math.sqrt(ph * (1 - ph) / n + z * z / (4 * n * n)) / (1 + z * z / n)
    return c - h, c + h


def simulate(
    model: list[Task], iters: int, boot: int, alphas: list[float], grid: list[Params],
    real: Params | None = None, workers: int = 1, scenarios: tuple[str, ...] = SCENARIOS,
) -> dict[str, list[dict[str, Any]]]:  # fmt: skip
    """scenario -> per-iteration outcomes (deterministic: each iteration seeds its own RNG)."""
    jobs = [(s, i, alphas, grid, real) for s in scenarios for i in range(iters)]
    if workers > 1:
        with multiprocessing.Pool(workers, _init, (model, boot)) as pool:
            res = pool.map(iterate, jobs, chunksize=16)
    else:
        _init(model, boot)
        res = [iterate(j) for j in jobs]
    by: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for j, r in zip(jobs, res, strict=True):
        by[j[0]].append(r)
    return by


def _won(scen: str, verdict: str) -> bool:
    """The rate the owner tracks: approval when nothing changed, blocking otherwise."""
    return (verdict == "PASS") if scen == "a" else (verdict != "PASS")


def summarize(
    by: dict[str, list[dict[str, Any]]], prm: Params, real: bool = False
) -> dict[str, Any]:
    """Per scenario: rate of the current and the new rule, paired difference (new − cur) with 1.96 SE, mean runs."""
    out: dict[str, Any] = {}
    for scen, rs in by.items():
        n = len(rs)
        cur = [_won(scen, r["cur"][0]) for r in rs]
        new = []
        for r in rs:
            dec, ex, usd = r["real"] if real else r["grid"][prm]
            decided = dec in ("PASS", "FAIL")
            v = dec if decided else r["cur"][0]
            new.append(
                (
                    _won(scen, v),
                    ex if decided else r["cur"][1],
                    usd if decided else r["cur"][2],
                )
            )
        d = [int(b[0]) - int(a) for a, b in zip(cur, new, strict=True)]
        md = sum(d) / n
        se = math.sqrt(max(sum((x - md) ** 2 for x in d) / (n - 1), 0) / n)
        out[scen] = {
            "n": n, "cur": sum(cur) / n, "cur_ci": wilson(sum(cur), n),
            "new": sum(b[0] for b in new) / n, "new_ci": wilson(sum(b[0] for b in new), n),
            "diff": md, "se": se,
            "runs_cur": sum(r["cur"][1] for r in rs) / n, "runs_new": sum(b[1] for b in new) / n,
            "usd_cur": sum(r["cur"][2] for r in rs) / n, "usd_new": sum(b[2] for b in new) / n,
        }  # fmt: skip
    return out


def mismatches(by: dict[str, list[dict[str, Any]]], prm: Params) -> int:
    """Iterations where the real sequential flow disagrees with the grid shortcut (look-1 decision, else current rule)."""
    n = 0
    for scen, rs in by.items():
        for r in rs:
            dec, ex, _ = r["grid"][prm]
            decided = dec in ("PASS", "FAIL")
            short = (
                _won(scen, dec if decided else r["cur"][0]),
                ex if decided else r["cur"][1],
            )
            n += short != (_won(scen, r["real"][0]), r["real"][1])
    return n


def feasible(summary: dict[str, Any]) -> bool:
    """No tracked rate of the new rule is below the current one beyond Monte Carlo error (1.96 SE)."""
    return all(s["diff"] + 1.96 * s["se"] >= 0 for s in summary.values())


def md_table(summary: dict[str, Any]) -> str:
    L = ["| Cenário | Taxa atual [IC95] | Taxa nova [IC95] | Δ pareado ±1,96 EP | Exec. atual | Exec. nova | US$ atual | US$ nova |", "|---|---|---|---|---|---|---|---|"]  # fmt: skip
    for scen, s in summary.items():
        what = "aprova" if scen == "a" else "bloqueia"
        L.append(
            f"| {LABEL[scen]} ({what}) | {s['cur'] * 100:.1f}% [{s['cur_ci'][0] * 100:.1f}, {s['cur_ci'][1] * 100:.1f}] "
            f"| {s['new'] * 100:.1f}% [{s['new_ci'][0] * 100:.1f}, {s['new_ci'][1] * 100:.1f}] "
            f"| {s['diff'] * 100:+.2f} ±{1.96 * s['se'] * 100:.2f} pp | {s['runs_cur']:.1f} | {s['runs_new']:.1f} "
            f"| {s['usd_cur']:.2f} | {s['usd_new']:.2f} |"
        )  # fmt: skip
    return "\n".join(L)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        description="Calibration of the sequential bench-pr gate (offline)"
    )
    p.add_argument("runs", nargs="+", type=Path)
    p.add_argument("--iters", type=int, default=2000)
    p.add_argument("--boot", type=int, default=2000)
    p.add_argument("--workers", type=int, default=multiprocessing.cpu_count())
    p.add_argument("--alphas", type=float, nargs="+", default=[0.02, 0.01, 0.005])
    p.add_argument("--ratios", type=float, nargs="+", default=[1.00, 1.05])
    p.add_argument(
        "--grid",
        action="store_true",
        help="search alpha1 x cost1 x turns1; else use the stats constants",
    )
    p.add_argument("--json", action="store_true")
    a = p.parse_args(argv)
    chosen: Params = (stats.ALPHA1, stats.COST1, stats.TURNS1)
    grid = (
        [(x, c, t) for x in a.alphas for c in a.ratios for t in a.ratios]
        if a.grid
        else [chosen]
    )
    result: dict[str, Any] = {}
    for path in a.runs:
        model = load_model(path)
        by = simulate(
            model,
            a.iters,
            a.boot,
            a.alphas if a.grid else [chosen[0]],
            grid,
            None if a.grid else chosen,
            a.workers,
        )
        label = path.parent.name
        rows = {prm: summarize(by, prm, real=not a.grid) for prm in grid}
        result[label] = {str(prm): s for prm, s in rows.items()}
        print(
            f"### {label}: {len(model)} tarefas, {a.iters} iterações por cenário, seed {SEED}, boot {a.boot}"
        )
        for prm, s in rows.items():
            print(f"\nα1={prm[0]} C1={prm[1]} T1={prm[2]} viável={feasible(s)} exec(a) {s['a']['runs_new']:.1f} vs {s['a']['runs_cur']:.1f}")  # fmt: skip
            if not a.grid:
                print(md_table(s))
                print(
                    f"\natalho do grid × fluxo real de gate.decide: {mismatches(by, prm)} divergências"
                )
    if a.json:
        print(json.dumps(result, default=list))
    return 0


if __name__ == "__main__":
    sys.exit(main())

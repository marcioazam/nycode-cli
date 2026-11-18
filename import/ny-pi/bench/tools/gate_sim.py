#!/usr/bin/env python3
"""Offline calibration of the sequential bench-pr gate (look 1 stricter, then the single-round rule). No model, no spend.

Model A (legacy, --resample-base): per task p_t = (s + 0.5) / (n + 1), a fresh base ~ Bernoulli(p_t) every iteration.
It overstates noise: a 12/12 task fails 4% of the time and the base is redrawn although the real gate has one frozen base.
Model B (default, calibrated 2026-11-18 on the 8 real sequential gates, RUNBOOK "Calibração do simulador"): the base is the
OBSERVED frozen round, as in the real gate; the true p_t is drawn per iteration from the Beta posterior of the task, with
an empirical-Bayes prior (alpha, beta) fitted by beta-binomial maximum likelihood over the base's own tasks (`fit_prior`),
so tasks that pass 12/12 are mostly deterministic; the candidate is Bernoulli(p_t plus the scenario effect).
Both models resample cost/turns/wall from the observed runs of the task and run the CURRENT rule and the NEW rule on the
same candidate draws (common random numbers: the paired difference carries little Monte Carlo noise).
The flows are the real `bench.gate.decide`; only the extension is replaced by reps drawn from the candidate stream.
The bootstrap inside the simulation uses --boot resamples (default 2000) for speed; the gate itself uses 10 000.

  python3 bench/tools/gate_sim.py RUNS.jsonl [RUNS.jsonl ...] [--iters 2000] [--boot 2000] [--grid] [--resample-base]
  python3 bench/tools/gate_sim.py RUNS.jsonl --sec-grid [--iters 4000]   # security-rule designs vs the rule in main

Security rules (--sec-grid): ("count", k0, N, t) or ("fisher", k0, N, alpha). A security task whose base is clean
runs k0 candidate reps; a failure among them extends to N; "count" blocks at t failures (curtailed once decided),
"fisher" blocks when the one-sided exact test against the clean base has p < alpha. The rest of the flow is the
real sequential gate with the security rule neutralised, so only the security verdict and spend change.
"""

import argparse
import json
import math
import multiprocessing
import random
import sys
import tomllib
from collections import defaultdict
from dataclasses import dataclass, field
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
SecRule = tuple[str, int, int, float]
SEC_GRID: list[SecRule] = [
    *[("count", k, n, t) for k, n, t in ((3, 6, 2), (6, 6, 2), (6, 6, 3), (3, 12, 3), (3, 12, 4), (6, 12, 3), (6, 12, 4),
                                          (3, 18, 4), (3, 18, 5), (3, 24, 4), (3, 24, 5), (6, 24, 5), (6, 48, 5), (6, 48, 6))],
    *[("fisher", k, n, a) for k, n, a in ((3, 12, 0.05), (3, 12, 0.1), (3, 24, 0.1), (3, 24, 0.2), (6, 24, 0.2), (6, 48, 0.2), (6, 48, 0.3))],
]  # fmt: skip
Run = dict[str, Any]
Params = tuple[float, float, float]  # alpha1, cost1, turns1


@dataclass(frozen=True)
class Task:
    id: str
    suite: str
    security: bool
    n: int  # base reps observed
    p: float  # shrunk pass rate (model A)
    pool: tuple[Run, ...]
    all_pass: bool
    a: float = 0.5  # Beta posterior of the true pass rate (model B): prior alpha + passes, prior beta + failures
    b: float = 0.5

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


def fit_prior(counts: list[tuple[int, int]]) -> tuple[float, float]:
    """Beta(alpha, beta) prior of the per-task pass rate by beta-binomial maximum likelihood over (passes, reps) pairs.
    Deterministic log-grid search on [0.02, 50]^2, refined twice; bounded so a base with only 12/12 tasks stays proper."""

    def ll(a: float, b: float) -> float:
        lb = math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b)
        return sum(
            lb + math.lgamma(a + s) + math.lgamma(b + n - s) - math.lgamma(a + b + n)
            for s, n in counts
        )

    la, lb_, span = math.log(1.0), math.log(1.0), math.log(50 / 0.02) / 2
    for _ in range(3):
        grid = [
            (la + i * span / 20, lb_ + j * span / 20)
            for i in range(-20, 21)
            for j in range(-20, 21)
        ]
        la, lb_ = max(
            (
                (x, y)
                for x, y in grid
                if 0.02 <= math.exp(x) <= 50 and 0.02 <= math.exp(y) <= 50
            ),
            key=lambda xy: ll(math.exp(xy[0]), math.exp(xy[1])),
        )
        span /= 10
    return math.exp(la), math.exp(lb_)


def load_model(path: Path) -> list[Task]:
    g: dict[tuple[str, str], list[Run]] = defaultdict(list)
    for line in path.read_text().splitlines():
        if line.strip():
            r = json.loads(line)
            g[(r["suite"], r["task_id"])].append(r)
    counts = {k: (sum(bool(r["passed"]) for r in rs), len(rs)) for k, rs in g.items()}
    alpha, beta = fit_prior(list(counts.values()))
    return [
        Task(
            t, s, any(r.get("security") for r in rs), len(rs),
            (counts[s, t][0] + 0.5) / (len(rs) + 1),
            tuple({k: v for k, v in r.items() if k != "tokens"} for r in rs),
            all(r["passed"] for r in rs),
            alpha + counts[s, t][0], beta + len(rs) - counts[s, t][0],
        )
        for (s, t), rs in sorted(g.items())
    ]  # fmt: skip


def scenario(
    tasks: list[Task], name: str, rng: random.Random, p0: dict[str, float] | None = None
) -> tuple[dict[str, float], float, float]:
    """Candidate pass probability per task (effect applied to `p0`, default the shrunk rate), cost and turns multipliers."""
    base_p = p0 or {t.id: t.p for t in tasks}
    p = dict(base_p)
    cm = tm = 1.0
    if name in ("b10", "b15"):
        d = 0.10 if name == "b10" else 0.15
        p = {k: min(1.0, max(0.0, v - d)) for k, v in p.items()}
    elif name == "c":
        for t in rng.sample(tasks, round(0.3 * len(tasks))):
            p[t.id] = max(0.0, base_p[t.id] - 0.35)
    elif name == "d_cost":
        cm = 1.15
    elif name == "d_turns":
        tm = 1.15
    elif name in ("e15", "e30"):
        t = rng.choice([t for t in tasks if t.security and t.all_pass and t.n > 1])
        p[t.id] = base_p[t.id] * (1 - (0.15 if name == "e15" else 0.30))
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
    extra: dict[str, list[Run]] = field(
        default_factory=dict
    )  # security reps beyond the stream, for --sec-grid

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


def draw(
    tasks: list[Task],
    name: str,
    rng: random.Random,
    extra: int = 0,
    clean_sec: bool = False,
    fixed: bool = False,
) -> Draw:
    """`fixed` = model B: observed frozen base, true p_t ~ Beta posterior; else model A (fresh base ~ Bernoulli(p_t))."""
    if fixed:
        p, cm, tm = scenario(
            tasks, name, rng, {t.id: rng.betavariate(t.a, t.b) for t in tasks}
        )
        base = [{**r, "rep": i} for t in tasks for i, r in enumerate(t.pool)]
    else:
        p, cm, tm = scenario(tasks, name, rng)
        base = [_one(t.pool, rng, t.p, i) for t in tasks for i in range(t.n)]
    if clean_sec:  # the frozen base is what was observed: a 12/12 security task stays 12/12 (same RNG use either way)
        keep = {t.id for t in tasks if t.security and t.all_pass}
        base = [{**r, "passed": True} if r["task_id"] in keep else r for r in base]
    streams = {
        t.id: [_one(t.pool, rng, p[t.id], i, cm, tm) for i in range(t.stream_len)]
        for t in tasks
    }
    # drawn last: the RNG sequence of everything above is the same with or without `extra`
    more = {
        t.id: [_one(t.pool, rng, p[t.id], i, cm, tm) for i in range(t.stream_len, extra)]
        for t in tasks if t.security and t.n > 1
    }  # fmt: skip
    return Draw(base, streams, tasks, more)


def flow(
    d: Draw, sequential: bool, boot: int, params: Params | None = None
) -> tuple[str, float, float]:
    g = d.grower(sequential)
    kw: dict[str, Any] = {"n_boot": boot}
    if params:
        kw |= dict(zip(("alpha1", "cost1", "turns1"), params, strict=True))
    v, _, _ = gate.decide(d.base, g.runs, META, META, g, sequential, **kw)
    return str(v["verdict"]), len(g.runs), g.usd


def fisher_tail(f: int, n: int, nb: int) -> float:
    """One-sided exact (Fisher) p of f failures in n candidate reps against nb clean base reps: P(all f fall on the candidate side)."""
    return math.comb(n, f) / math.comb(n + nb, f)


def sec_outcome(rule: SecRule, passes: list[bool], nb: int) -> tuple[bool, int]:
    """(blocks, candidate reps used) for one security task with a clean base; `passes` is the candidate stream."""
    kind, k0, n, x = rule
    f = sum(not p for p in passes[:k0])
    if f == 0:
        return False, k0
    if kind == "fisher":
        return fisher_tail(sum(not p for p in passes[:n]), n, nb) < x, n
    for i in range(
        k0, n + 1
    ):  # curtailed: stop once the threshold is met or out of reach
        f = sum(not p for p in passes[:i])
        if f >= x or f + (n - i) < x:
            return f >= x, i
    return False, n  # unreachable: i = n always stops


def sec_verdicts(
    d: Draw, rules: list[SecRule], flow_out: tuple[str, float, float], look1_usd: float
) -> dict[SecRule, tuple[str, float]]:
    """Verdict and spend of each security rule on top of the neutralised flow `flow_out` = (verdict, runs, usd).
    The security confirmation runs at look 1, so a block stops the PR there: spend = look-1 spend + security reps."""
    v, _, usd = flow_out
    clean = [
        t for t in d.tasks
        if t.security and t.n > 1 and all(r["passed"] for r in d.base if r["task_id"] == t.id)
    ]  # fmt: skip
    out: dict[SecRule, tuple[str, float]] = {}
    for rule in rules:
        blocked, spend = False, 0.0
        for t in clean:
            b, reps = sec_outcome(
                rule, [r["passed"] for r in d.streams[t.id] + d.extra[t.id]], t.n
            )
            blocked |= b
            spend += (reps - t.k_initial(True)) * EST[t.suite]
        out[rule] = ("FAIL" if blocked else v, spend + (look1_usd if blocked else usd))
    return out


def neutral(d: Draw) -> Draw:
    """The same draw with the security flag cleared, so stats.verdict applies no security rule of its own."""

    def strip(rs: list[Run]) -> list[Run]:
        return [{**r, "security": False} for r in rs]

    return Draw(strip(d.base), {k: strip(v) for k, v in d.streams.items()}, d.tasks)


def iterate(
    job: tuple[str, int, list[float], list[Params], Params | None],
) -> dict[str, Any]:
    name, i, alphas, grid, real = job
    rng = random.Random(f"{SEED}:{name}:{i}")
    d = draw(MODEL, name, rng, max((r[2] for r in SECRULES), default=0), CLEAN, FIXED)
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
    if SECRULES:
        out["sec"] = sec_verdicts(
            d, SECRULES, flow(neutral(d), True, BOOT, real), g1.usd
        )
    return out


MODEL: list[Task] = []
BOOT = 2000
SECRULES: list[SecRule] = []
CLEAN = False
FIXED = False


def _init(
    model: list[Task],
    boot: int,
    secrules: list[SecRule] | None = None,
    clean: bool = False,
    fixed: bool = False,
    est: dict[str, float] | None = None,
) -> None:
    global MODEL, BOOT, SECRULES, CLEAN, FIXED
    EST.update(
        est or {}
    )  # spawn/forkserver workers re-import the module: carry the CLI override
    MODEL, BOOT, SECRULES, CLEAN, FIXED = model, boot, secrules or [], clean, fixed


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    ph = k / n
    c = (ph + z * z / (2 * n)) / (1 + z * z / n)
    h = z * math.sqrt(ph * (1 - ph) / n + z * z / (4 * n * n)) / (1 + z * z / n)
    return c - h, c + h


def simulate(
    model: list[Task], iters: int, boot: int, alphas: list[float], grid: list[Params],
    real: Params | None = None, workers: int = 1, scenarios: tuple[str, ...] = SCENARIOS,
    secrules: list[SecRule] | None = None, clean: bool = False, fixed: bool = True,
) -> dict[str, list[dict[str, Any]]]:  # fmt: skip
    """scenario -> per-iteration outcomes (deterministic: each iteration seeds its own RNG)."""
    jobs = [(s, i, alphas, grid, real) for s in scenarios for i in range(iters)]
    if workers > 1:
        with multiprocessing.Pool(
            workers, _init, (model, boot, secrules, clean, fixed, dict(EST))
        ) as pool:
            res = pool.map(iterate, jobs, chunksize=16)
    else:
        _init(model, boot, secrules, clean, fixed)
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
            "stop1": sum(r["grid"][prm][0] in ("PASS", "FAIL") for r in rs) / n,
            "runs_cur": sum(r["cur"][1] for r in rs) / n, "runs_new": sum(b[1] for b in new) / n,
            "usd_cur": sum(r["cur"][2] for r in rs) / n, "usd_new": sum(b[2] for b in new) / n,
        }  # fmt: skip
    return out


def sec_summary(by: dict[str, list[dict[str, Any]]], rule: SecRule) -> dict[str, Any]:
    """Per scenario: tracked rate of the gate in main (`ref`) and of the gate with `rule`, paired difference, extra spend."""
    out: dict[str, Any] = {}
    for scen, rs in by.items():
        n = len(rs)
        ref = [_won(scen, r["real"][0]) for r in rs]
        new = [_won(scen, r["sec"][rule][0]) for r in rs]
        d = [int(b) - int(a) for a, b in zip(ref, new, strict=True)]
        md = sum(d) / n
        se = math.sqrt(max(sum((x - md) ** 2 for x in d) / (n - 1), 0) / n)
        out[scen] = {
            "n": n, "ref": sum(ref) / n, "ref_ci": wilson(sum(ref), n), "new": sum(new) / n, "new_ci": wilson(sum(new), n),
            "diff": md, "se": se, "usd_extra": sum(r["sec"][rule][1] - r["real"][2] for r in rs) / n,
        }  # fmt: skip
    return out


def sec_meets(
    s: dict[str, Any],
    target15: float = 0.80,
    target30: float = 0.95,
    usd_max: float = 0.30,
) -> dict[str, bool]:
    """Pre-registered criteria (RUNBOOK): a/others do not worsen beyond 1.96 SE, e15 and e30 targets, mean extra spend."""
    ok = {k: s[k]["diff"] + 1.96 * s[k]["se"] >= 0 for k in s}
    ok["e15>=80"] = "e15" in s and s["e15"]["new"] >= target15
    ok["e30>=95"] = "e30" in s and s["e30"]["new"] >= target30
    ok["usd"] = all(x["usd_extra"] <= usd_max for x in s.values())
    return ok


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
    L = ["| Cenário | Taxa atual [IC95] | Taxa nova [IC95] | Δ pareado ±1,96 EP | Parou no olhar 1 | Exec. atual | Exec. nova | US$ atual | US$ nova |", "|---|---|---|---|---|---|---|---|---|"]  # fmt: skip
    for scen, s in summary.items():
        what = "aprova" if scen == "a" else "bloqueia"
        L.append(
            f"| {LABEL[scen]} ({what}) | {s['cur'] * 100:.1f}% [{s['cur_ci'][0] * 100:.1f}, {s['cur_ci'][1] * 100:.1f}] "
            f"| {s['new'] * 100:.1f}% [{s['new_ci'][0] * 100:.1f}, {s['new_ci'][1] * 100:.1f}] "
            f"| {s['diff'] * 100:+.2f} ±{1.96 * s['se'] * 100:.2f} pp | {s['stop1'] * 100:.1f}% | {s['runs_cur']:.1f} | {s['runs_new']:.1f} "
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
    p.add_argument(
        "--sec-grid",
        action="store_true",
        help="compare the SEC_GRID security rules with the gate in main",
    )
    p.add_argument(
        "--clean-base",
        action="store_true",
        help="--sec-grid: keep the observed all-pass base of security tasks",
    )
    p.add_argument(
        "--resample-base",
        action="store_true",
        help="legacy model A: fresh base k12 per iteration, shrunk p (the default is model B, see the module docstring)",
    )
    p.add_argument(
        "--s1-usd",
        type=float,
        help="USD per S1 run instead of est_cost_usd of suites.toml (measured: 0.015)",
    )
    p.add_argument("--json", action="store_true")
    a = p.parse_args(argv)
    if a.s1_usd is not None:
        EST["s1"] = a.s1_usd
    chosen: Params = (stats.ALPHA1, stats.COST1, stats.TURNS1)
    grid = (
        [(x, c, t) for x in a.alphas for c in a.ratios for t in a.ratios]
        if a.grid
        else [chosen]
    )
    result: dict[str, Any] = {}
    for path in a.runs:
        model = load_model(path)
        if a.sec_grid:
            by = simulate(
                model,
                a.iters,
                a.boot,
                [chosen[0]],
                [chosen],
                chosen,
                a.workers,
                secrules=SEC_GRID,
                clean=a.clean_base,
                fixed=not a.resample_base,
            )
            print(
                f"### {path.parent.name}: {len(model)} tarefas, {a.iters} iterações por cenário, seed {SEED}, boot {a.boot}"
            )
            for rule in SEC_GRID:
                s = sec_summary(by, rule)
                print(f"\n{rule} critérios {sec_meets(s)}")
                print(
                    "| Cenário | Atual [IC95] | Nova [IC95] | Δ pareado ±1,96 EP | US$ extra |\n|---|---|---|---|---|"
                )
                for k, x in s.items():
                    print(f"| {LABEL[k]} | {x['ref'] * 100:.1f}% [{x['ref_ci'][0] * 100:.1f}, {x['ref_ci'][1] * 100:.1f}] | {x['new'] * 100:.1f}% [{x['new_ci'][0] * 100:.1f}, {x['new_ci'][1] * 100:.1f}] | {x['diff'] * 100:+.2f} ±{1.96 * x['se'] * 100:.2f} pp | {x['usd_extra']:+.3f} |")  # fmt: skip
            continue
        by = simulate(
            model,
            a.iters,
            a.boot,
            a.alphas if a.grid else [chosen[0]],
            grid,
            None if a.grid else chosen,
            a.workers,
            fixed=not a.resample_base,
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

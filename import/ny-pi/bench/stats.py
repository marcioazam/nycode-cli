#!/usr/bin/env python3
"""Veredito do gate de benchmark (D6/D7), stdlib apenas.

IC (a): bootstrap pareado por cluster de tarefa, percentil BCa, 10 000 reamostras,
seed fixa. `evalstats` 0.3.3 foi inspecionado e descartado: sua API pareada
(`bayes_paired_diff_ci`) exige vetores binários por item (não aceita taxa média por
tarefa com reps) e arrasta pandas/matplotlib/statsmodels/scipy para um gate de CI.
"""

import argparse
import json
import math
import random
import statistics
import sys
from collections.abc import Callable, Iterable
from pathlib import Path
from statistics import NormalDist
from typing import Any, Literal, TypedDict

if __package__ in (None, ""):  # run as a script (`python bench/stats.py verdict ...`)
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from bench import evidence

ND = NormalDist()
# "Precise" gate (owner decision, replaces the D6 accuracy rule): non-inferiority margin −10 pp on a two-sided
# 90% interval, base k12 (tier baseline), candidate k3 plus one +3 extension when inconclusive.
# Simulated on the real ny-pi round (42 tasks): the old rule (base k2, cand k2+2, −6 pp, CI95) approves an
# unchanged PR 41% of the time and blocks a real 10 pp drop 97%; the new rule approves 98%, blocks −10 pp 96%
# and −15 pp 100%, at ~146 runs per PR.
MARGIN = -0.10
# Wall time is informative only (2026-11-15): it measures the API and the machine load, not the PR.
COST_MAX, TURNS_MAX = 1.10, 1.10
N_BOOT, SEED, ALPHA = 10_000, 20261113, 0.10
Z = NormalDist().inv_cdf(1 - ALPHA / 2)  # normal quantile of the two-sided interval
# Sequential gate (owner decision 2026-11-18): look 1 stops early only on a stricter interval and stricter
# ratios than the final rule; anything else goes on to the current rule at k3. Values: docs/bench/RUNBOOK.md
# ("Gate sequencial"), calibrated by bench/tools/gate_sim.py.
ALPHA1, COST1, TURNS1 = 0.01, 1.05, 1.05
META_KEYS = ("model", "arm_version", "overlay_sha")
EXIT = {"PASS": 0, "FAIL": 1, "INCONCLUSIVE": 3, "NOT_COMPARABLE": 4, "NOT_VERIFIED": 5}
SEC_CONFIRM_REPS = (
    6  # candidate reps of a security task before one failure counts as noise
)
MAX_EXCLUDED = 0.10  # tasks with an errored run (infra, refusal) or missing from the candidate are dropped from pairing; above this share nothing is verified

Run = dict[
    str, Any
]  # linha JSON de resultado; chaves lidas: task_id, passed, cost_usd, wall_s, security
Meta = dict[str, Any]
Verdict = dict[str, Any]


class TaskStat(TypedDict):
    rate: float
    cost: float | None
    wall: float | None
    turns: float | None
    security: bool
    all_pass: bool
    fails: int
    n: int


def agent_timeout(r: Run) -> bool:
    """A timeout that spent money is the agent's failure; one with no spend died before the model (infra)."""
    return bool(r.get("error") and r.get("cost_usd")) and evidence.signature(r, [], {}) == "timeout"  # fmt: skip


def excluded_run(r: Run) -> bool:
    """Errored run that says nothing about the agent (infra, refusal, other error): its task leaves the pairing."""
    return bool(r.get("error")) and not agent_timeout(r)


def _per_task(runs: Iterable[Run]) -> dict[str, TaskStat]:
    """task_id -> {rate, cost, wall, security, all_pass}; cost/wall = média das reps não-None."""
    g: dict[str, list[Run]] = {}
    for r in runs:
        g.setdefault(r["task_id"], []).append(r)

    def mean(xs: Iterable[float | None], positive: bool = False) -> float | None:
        vals = [x for x in xs if x is not None and (x > 0 or not positive)]
        return sum(vals) / len(vals) if vals else None

    return {
        t: {
            "rate": sum(r["passed"] for r in rs) / len(rs),
            "cost": mean(r.get("cost_usd") for r in rs),
            "wall": mean(r.get("wall_s") for r in rs),
            "turns": mean((r.get("turns") for r in rs), positive=True),
            "security": any(r.get("security") for r in rs),
            "all_pass": all(r["passed"] for r in rs),
            "fails": sum(not r["passed"] for r in rs),
            "n": len(rs),
        }
        for t, rs in g.items()
    }


def paired_ci(
    diffs: list[float], alpha: float = ALPHA, n_boot: int = N_BOOT, seed: int = SEED
) -> tuple[float, float]:
    """IC BCa da média das diferenças por tarefa (cluster = tarefa).

    Cada diferença é taxa do candidato − taxa da base na tarefa, então k pode diferir entre os lados."""
    n = len(diffs)
    theta = sum(diffs) / n
    if max(diffs) == min(diffs):
        return theta, theta
    rng = random.Random(seed)
    boots = sorted(sum(rng.choices(diffs, k=n)) / n for _ in range(n_boot))
    below = sum(b < theta for b in boots) / n_boot
    z0 = ND.inv_cdf(min(max(below, 1 / (n_boot + 1)), 1 - 1 / (n_boot + 1)))
    jack = [(sum(diffs) - d) / (n - 1) for d in diffs] if n > 1 else [theta]
    jm = sum(jack) / len(jack)
    num = sum((jm - j) ** 3 for j in jack)
    den = 6 * sum((jm - j) ** 2 for j in jack) ** 1.5
    a = num / den if den else 0.0

    def q(p: float) -> float:
        z = ND.inv_cdf(p)
        adj = ND.cdf(z0 + (z0 + z) / (1 - a * (z0 + z)))
        return boots[min(n_boot - 1, max(0, int(adj * n_boot)))]

    return q(alpha / 2), q(1 - alpha / 2)


AHEAD_P = 0.80  # "ahead" on a metric: P(candidate better than reference | data) >= 0.80 (owner rule)


def prob_superior(
    diffs: list[float],
    lower_is_better: bool = False,
    n_boot: int = N_BOOT,
    seed: int = SEED,
) -> float:
    """P(candidato melhor que a referência | dados): bootstrap pareado agrupado por tarefa.

    `diffs` = uma diferença por tarefa (taxa média das repetições; para razões, o log da razão). Reamostra tarefas
    com semente fixa e conta só as médias ESTRITAMENTE melhores (> 0; < 0 se menor é melhor). Empate (média ≈ 0) conta 0: creditar meio
    dava P≈0,82 a 1 vitória entre 41 zeros; empate exato total dá P = 0."""
    if not diffs:
        raise ValueError("no paired tasks")
    n, sign = len(diffs), -1.0 if lower_is_better else 1.0
    d = [sign * x for x in diffs]
    rng = random.Random(seed)
    return sum(sum(rng.choices(d, k=n)) / n > 1e-12 for _ in range(n_boot)) / n_boot


# Pre-registered metrics (owner, multiplicity): primary = accuracy, co-primary = cost per task and time. Only these
# get a yes/no "ahead"; the rest show P but are exploratory (many metrics, 80% each: some will cross by chance).
PREREGISTERED = ("pass_rate", "cost", "wall")


def ahead(p: float | None, preregistered: bool = True) -> str:
    """Column "à frente (P≥0,80)?": sim / não / – (no paired data); "exploratório" off the pre-registered list."""
    if p is None:
        return "–"
    return ("sim" if p >= AHEAD_P else "não") if preregistered else "exploratório"


def _ratio(
    base: dict[str, TaskStat],
    cand: dict[str, TaskStat],
    tasks: list[str],
    key: Literal["cost", "wall", "turns"],
    agg: Callable[[Iterable[float]], float],
) -> float | None:
    # Paired: the ratio is taken per task and then aggregated. A ratio of two medians moves with whichever
    # task lands in the middle (A/A on 2026-11-14: 1.285 against 0.998 paired).
    ratios: list[float] = []
    for t in tasks:
        bv, cv = base[t][key], cand[t][key]
        if bv is not None and cv is not None and bv > 0:
            ratios.append(cv / bv)
    return agg(ratios) if ratios else None


def tasks_to_extend(base_runs: Iterable[Run], cand_runs: Iterable[Run]) -> list[str]:
    """Tarefas pareadas cuja taxa de acerto difere entre base e candidato."""
    b, c = _per_task(base_runs), _per_task(cand_runs)
    return sorted(t for t in b.keys() & c.keys() if b[t]["rate"] != c[t]["rate"])


def score(
    acc_ratio: float | None,
    cost_ratio: float | None,
    wall_ratio: float | None,
    plan: float = 1.0,
    multi: float = 1.0,
    sec_regressed: bool = False,
) -> float:
    """D7 informativa 0–100: pesos 50/20/10/10/10; cada componente é fração em [0,1] vs base."""
    if sec_regressed:
        return 0.0

    def cl(x: float | None) -> float:
        return 0.0 if x is None else min(1.0, max(0.0, x))

    def inv(r: float | None) -> float:
        return 1.0 if r is None else (1.0 if r <= 0 else 1 / r)

    return round(
        50 * cl(acc_ratio)
        + 20 * cl(inv(cost_ratio))
        + 10 * cl(inv(wall_ratio))
        + 10 * cl(plan)
        + 10 * cl(multi),
        2,
    )


def verdict(
    base_runs: Iterable[Run],
    cand_runs: Iterable[Run],
    meta_base: Meta,
    meta_cand: Meta,
    extended: bool = False,
    plan: float = 1.0,
    multi: float = 1.0,
    alpha: float = ALPHA,
    n_boot: int = N_BOOT,
) -> Verdict:
    out: Verdict = {
        "verdict": None,
        "alpha": alpha,
        "rules": {},
        "n": 0,
        "ci": None,
        "cost_ratio": None,
        "wall_ratio": None,
        "turns_ratio": None,
        "turns_n": 0,
        "security_regressions": [],
        "security_pending": [],
        "score": None,
        "excluded": 0,
        "missing": [],
    }
    # `jobs`: wall time under a different parallelism is another measurement (rounds before 2026-11-14 ran with 1)
    if any(meta_base.get(k) != meta_cand.get(k) for k in META_KEYS) or meta_base.get(
        "jobs", 1
    ) != meta_cand.get("jobs", 1):
        out["verdict"] = "NOT_COMPARABLE"
        return out
    # a timeout with spend stays in the pairing as a failure; every other errored run drops its task
    base_l = [dict(r, passed=False) if agent_timeout(r) else r for r in base_runs]
    cand_l = [dict(r, passed=False) if agent_timeout(r) else r for r in cand_runs]
    errored = {r["task_id"] for r in base_l + cand_l if excluded_run(r)}
    seen = {r["task_id"] for r in base_l + cand_l}
    missing = sorted({r["task_id"] for r in base_l} - {r["task_id"] for r in cand_l} - errored)  # fmt: skip
    out["missing"] = missing
    dropped = errored | set(missing)
    out["excluded"] = len(dropped)
    b = _per_task(r for r in base_l if r["task_id"] not in errored)
    c = _per_task(r for r in cand_l if r["task_id"] not in errored)
    tasks = sorted(b.keys() & c.keys())
    out["n"] = len(tasks)
    diffs = [c[t]["rate"] - b[t]["rate"] for t in tasks]
    rules: dict[str, str] = out["rules"]
    if tasks:
        lo, hi = paired_ci(diffs, alpha, n_boot)
        out["ci"] = [lo, hi]
        lo, hi = (
            round(lo, 9),
            round(hi, 9),
        )  # float noise must not decide the exact -10 pp boundary
        rules["accuracy"] = (
            "PASS" if lo > MARGIN else "FAIL" if hi < MARGIN else "INCONCLUSIVE"
        )
    else:
        rules["accuracy"] = "INCONCLUSIVE"
    out["cost_ratio"] = _ratio(b, c, tasks, "cost", statistics.median)
    out["wall_ratio"] = _ratio(b, c, tasks, "wall", statistics.median)
    out["turns_ratio"] = _ratio(b, c, tasks, "turns", statistics.median)
    out["turns_n"] = sum(
        b[t]["turns"] is not None and c[t]["turns"] is not None for t in tasks
    )
    for name, r, lim in (
        ("cost", out["cost_ratio"], COST_MAX),
        ("turns", out["turns_ratio"], TURNS_MAX),
    ):
        rules[name] = "INCONCLUSIVE" if r is None else "PASS" if r <= lim else "FAIL"
    # Owner rule 2026-11-14: one failed rep of a security task is confirmed before it blocks. The gate re-runs
    # the task once (SEC_CONFIRM_REPS in total); two failures, or no confirmation data, are a regression.
    # Judged on the valid reps of every task, errored ones included: a task that leaves the pairing for an infra
    # row must not hide a failure, and fewer than SEC_CONFIRM_REPS valid reps is an incomplete confirmation.
    bv = _per_task(r for r in base_l if not excluded_run(r))
    cv = _per_task(r for r in cand_l if not excluded_run(r))
    sec = [
        t
        for t in sorted(bv.keys() & cv.keys())
        if bv[t]["security"] and bv[t]["all_pass"] and cv[t]["fails"]
    ]
    unconfirmed = [
        t for t in sec if cv[t]["fails"] == 1 and cv[t]["n"] < SEC_CONFIRM_REPS
    ]
    out["security_regressions"] = [
        t for t in sec if cv[t]["fails"] >= 2 or (extended and t in unconfirmed)
    ]
    out["security_pending"] = [] if extended else unconfirmed
    rules["security"] = (
        "FAIL"
        if out["security_regressions"]
        else "INCONCLUSIVE"
        if out["security_pending"]
        else "PASS"
    )
    # b/c sem dados (INCONCLUSIVE) não alteram o veredito global: D6e só estende por (a).
    if "FAIL" in rules.values():
        v = "FAIL"
    elif rules["accuracy"] == "INCONCLUSIVE":
        v = "FAIL" if extended else "INCONCLUSIVE"
    elif rules["security"] == "INCONCLUSIVE":
        v = "INCONCLUSIVE"
    else:
        v = "PASS"
    if seen and len(dropped) / len(seen) > MAX_EXCLUDED:
        v = "NOT_VERIFIED"
    out["verdict"] = v
    mb = statistics.mean(x["rate"] for x in b.values()) if b else 0
    mc = statistics.mean(x["rate"] for x in c.values()) if c else 0
    acc = 1.0 if mb == 0 else mc / mb
    out["score"] = score(
        acc,
        out["cost_ratio"],
        out["wall_ratio"],
        plan,
        multi,
        bool(out["security_regressions"]),
    )
    return out


def look1_decision(v: Verdict, cost1: float = COST1, turns1: float = TURNS1) -> str:
    """PASS, FAIL (both final), another final verdict (NOT_*) or CONTINUE, from a verdict taken at alpha1."""
    if v["verdict"] in ("NOT_COMPARABLE", "NOT_VERIFIED"):
        return str(v["verdict"])
    if v["rules"]["accuracy"] == "FAIL" or v["security_regressions"]:
        return "FAIL"
    cost, turns = v["cost_ratio"], v["turns_ratio"]
    ok = (
        v["rules"]["accuracy"] == "PASS" and v["rules"]["security"] == "PASS"
        and cost is not None and cost <= cost1 and turns is not None and turns <= turns1
    )  # fmt: skip
    return "PASS" if ok else "CONTINUE"


def look1(
    base_runs: Iterable[Run],
    cand_runs: Iterable[Run],
    meta_base: Meta,
    meta_cand: Meta,
    alpha1: float = ALPHA1,
    cost1: float = COST1,
    turns1: float = TURNS1,
    **kw: Any,
) -> tuple[str, Verdict]:
    """Look 1 of the sequential gate: candidate k1 (security tasks k3), interval at the stricter alpha1."""
    v = verdict(base_runs, cand_runs, meta_base, meta_cand, alpha=alpha1, **kw)
    return look1_decision(v, cost1, turns1), v


def _var_diff(k: float, sd_task: float) -> float:
    # variância da diferença por tarefa: dispersão entre tarefas + ruído binomial (pior caso 0.25/k por lado)
    return sd_task**2 + 0.5 / k


def halfwidth(n_tasks: float, k: float, sd_task: float, z: float = Z) -> float:
    return z * math.sqrt(_var_diff(k, sd_task) / n_tasks)


def power(
    n_tasks: float,
    k: float,
    sd_task: float,
    effect: float = 0.0,
    margin: float = -MARGIN,
) -> float:
    """P(limite inferior do IC > −margin) se a diferença verdadeira = effect (normal)."""
    se = math.sqrt(_var_diff(k, sd_task) / n_tasks)
    return ND.cdf((effect + margin) / se - Z)


def required_tasks(
    halfwidth_target: float, k: float, sd_task: float, z: float = Z
) -> int:
    """Menor N com meia-largura do IC ≤ alvo."""
    return math.ceil(_var_diff(k, sd_task) * (z / halfwidth_target) ** 2)


def _load(path: str) -> list[Run]:
    with open(path) as f:
        return [json.loads(line) for line in f if line.strip()]


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    v = sub.add_parser("verdict")
    v.add_argument("base")
    v.add_argument("cand")
    v.add_argument("--meta-base", required=True)
    v.add_argument("--meta-cand", required=True)
    v.add_argument("--extended", action="store_true")
    a = p.parse_args(argv)
    with open(a.meta_base) as fb, open(a.meta_cand) as fc:
        meta_base, meta_cand = json.load(fb), json.load(fc)
    res = verdict(_load(a.base), _load(a.cand), meta_base, meta_cand, a.extended)
    print(json.dumps(res))
    return EXIT[res["verdict"]]


if __name__ == "__main__":
    sys.exit(main())

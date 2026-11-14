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
from statistics import NormalDist
from typing import Any, Literal, TypedDict

ND = NormalDist()
# Non-inferiority margin: −6 pp (was −5 pp, D6). Measured ny-pi×ny-pi noise (42 tasks, sd 0.305 of the paired
# difference) puts ±5 pp at ~US$ 15–17 per PR; the US$ 12 cap reaches ~±6 pp with k2 + one extension.
# Record: docs/bench/pi-harness-ci-2026-11-13.md (A5, 2026-11-14).
MARGIN = -0.06
COST_MAX, WALL_MAX = 1.10, 1.20
N_BOOT, SEED, ALPHA = 10_000, 20261113, 0.05
META_KEYS = ("model", "arm_version", "overlay_sha")
EXIT = {"PASS": 0, "FAIL": 1, "INCONCLUSIVE": 3, "NOT_COMPARABLE": 4}

Run = dict[
    str, Any
]  # linha JSON de resultado; chaves lidas: task_id, passed, cost_usd, wall_s, security
Meta = dict[str, Any]
Verdict = dict[str, Any]


class TaskStat(TypedDict):
    rate: float
    cost: float | None
    wall: float | None
    security: bool
    all_pass: bool


def _per_task(runs: Iterable[Run]) -> dict[str, TaskStat]:
    """task_id -> {rate, cost, wall, security, all_pass}; cost/wall = média das reps não-None."""
    g: dict[str, list[Run]] = {}
    for r in runs:
        g.setdefault(r["task_id"], []).append(r)

    def mean(xs: Iterable[float | None]) -> float | None:
        vals = [x for x in xs if x is not None]
        return sum(vals) / len(vals) if vals else None

    return {
        t: {
            "rate": sum(r["passed"] for r in rs) / len(rs),
            "cost": mean(r.get("cost_usd") for r in rs),
            "wall": mean(r.get("wall_s") for r in rs),
            "security": any(r.get("security") for r in rs),
            "all_pass": all(r["passed"] for r in rs),
        }
        for t, rs in g.items()
    }


def paired_ci(
    diffs: list[float], alpha: float = ALPHA, n_boot: int = N_BOOT, seed: int = SEED
) -> tuple[float, float]:
    """IC BCa da média das diferenças por tarefa (cluster = tarefa)."""
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


def _ratio(
    base: dict[str, TaskStat],
    cand: dict[str, TaskStat],
    tasks: list[str],
    key: Literal["cost", "wall"],
    agg: Callable[[Iterable[float]], float],
) -> float | None:
    pairs: list[tuple[float, float]] = []
    for t in tasks:
        bv, cv = base[t][key], cand[t][key]
        if bv is not None and cv is not None:
            pairs.append((bv, cv))
    if not pairs:
        return None
    b, c = agg(p[0] for p in pairs), agg(p[1] for p in pairs)
    return c / b if b > 0 else None


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
) -> Verdict:
    out: Verdict = {
        "verdict": None,
        "rules": {},
        "n": 0,
        "ci": None,
        "cost_ratio": None,
        "wall_ratio": None,
        "security_regressions": [],
        "score": None,
    }
    if any(meta_base.get(k) != meta_cand.get(k) for k in META_KEYS):
        out["verdict"] = "NOT_COMPARABLE"
        return out
    b, c = _per_task(base_runs), _per_task(cand_runs)
    tasks = sorted(b.keys() & c.keys())
    out["n"] = len(tasks)
    diffs = [c[t]["rate"] - b[t]["rate"] for t in tasks]
    rules: dict[str, str] = out["rules"]
    if tasks:
        lo, hi = paired_ci(diffs)
        out["ci"] = [lo, hi]
        rules["accuracy"] = (
            "PASS" if lo > MARGIN else "FAIL" if hi < MARGIN else "INCONCLUSIVE"
        )
    else:
        rules["accuracy"] = "INCONCLUSIVE"
    out["cost_ratio"] = _ratio(b, c, tasks, "cost", statistics.median)
    out["wall_ratio"] = _ratio(b, c, tasks, "wall", statistics.median)
    for name, r, lim in (
        ("cost", out["cost_ratio"], COST_MAX),
        ("wall", out["wall_ratio"], WALL_MAX),
    ):
        rules[name] = "INCONCLUSIVE" if r is None else "PASS" if r <= lim else "FAIL"
    out["security_regressions"] = [
        t
        for t in tasks
        if b[t]["security"] and b[t]["all_pass"] and not c[t]["all_pass"]
    ]
    rules["security"] = "FAIL" if out["security_regressions"] else "PASS"
    # b/c sem dados (INCONCLUSIVE) não alteram o veredito global: D6e só estende por (a).
    if "FAIL" in rules.values():
        v = "FAIL"
    elif rules["accuracy"] == "INCONCLUSIVE":
        v = "FAIL" if extended else "INCONCLUSIVE"
    else:
        v = "PASS"
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


def _var_diff(k: float, sd_task: float) -> float:
    # variância da diferença por tarefa: dispersão entre tarefas + ruído binomial (pior caso 0.25/k por lado)
    return sd_task**2 + 0.5 / k


def halfwidth(n_tasks: float, k: float, sd_task: float, z: float = 1.96) -> float:
    return z * math.sqrt(_var_diff(k, sd_task) / n_tasks)


def power(
    n_tasks: float,
    k: float,
    sd_task: float,
    effect: float = 0.0,
    margin: float = -MARGIN,
) -> float:
    """P(limite inferior do IC95 > −margin) se a diferença verdadeira = effect (normal)."""
    se = math.sqrt(_var_diff(k, sd_task) / n_tasks)
    return ND.cdf((effect + margin) / se - 1.96)


def required_tasks(
    halfwidth_target: float, k: float, sd_task: float, z: float = 1.96
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

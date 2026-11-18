"""Power of the "ahead" claim by simulation from observed per-task pass rates (stdlib only, fixed seed).

Each arm's observed per-task rate is shrunk (Beta(0.5, 0.5) prior) so no task sits on an exact 0 or 1, the ny rates are
shifted until the mean gap equals the target, then tasks are drawn with replacement and k Bernoulli runs per arm per
task. Per simulated round two decisions: P(ahead) >= 0.80 and "strong" (90% interval lower bound > 0).

Inside the simulation the "strong" decision uses the normal approximation of the task-clustered bootstrap (mean/se of
the per-task differences). P(ahead) uses the real rule, `stats.prob_superior`, with SIM_BOOT resamples instead of
10 000 (cost: 10 000 resamples per round is ~10^10 operations for a grid): the normal approximation overstates P on
sparse data (1 win among 41 ties: 0.84 against 0.64) and so overstated the power and the false-positive rate."""

import json
import math
import random
from pathlib import Path
from typing import Any, NamedTuple

from bench import report, stats

PRIOR = 0.5  # Beta(0.5, 0.5) (Jeffreys): rate = (passes + 0.5) / (runs + 1)
DEFAULT_DELTAS, DEFAULT_KS, DEFAULT_NS = "0,0.03,0.05,0.08", "1,2,3", "24,49,73"
N_SIMS = 2000
SIM_BOOT = 100  # resamples per simulated round for P(ahead); noise ~0.04 around the 0.80 threshold
TOL = 0.005  # warn when the reachable gap strays this far from the target


class Power(NamedTuple):
    p80: float  # share of simulated rounds with P(ahead) >= 0.80
    ci90: float  # share with the 90% interval lower bound > 0
    effective: float = 0.0  # mean(shifted ny) - mean(ref) actually simulated


def shrunk_rates(ny_dir: Path, ref_dir: Path) -> tuple[list[float], list[float]]:
    """Per-task shrunk pass rates of both arms over the tasks both ran with no errored run."""
    _, ny = report._load(ny_dir)
    _, ref = report._load(ref_dir)
    a, b = report._clean([ny, ref])
    tasks = sorted(a)

    def shrink(t: stats.TaskStat) -> float:
        return (t["rate"] * t["n"] + PRIOR) / (t["n"] + 2 * PRIOR)

    return [shrink(a[t]) for t in tasks], [shrink(b[t]) for t in tasks]


def shift(ny: list[float], ref: list[float], delta: float) -> tuple[list[float], float]:
    """ny rates plus one constant, clipped to [0, 1], so the mean gap to ref is `delta` (nearest reachable).

    Returns (shifted rates, EFFECTIVE gap mean(shifted) - mean(ref)); clipping can make it differ from `delta`."""
    target = sum(ref) / len(ref) + delta

    def mean(c: float) -> float:
        return sum(min(1.0, max(0.0, x + c)) for x in ny) / len(ny)

    lo, hi = -1.0, 1.0
    for _ in range(50):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if mean(mid) < target else (lo, mid)
    out = [min(1.0, max(0.0, x + (lo + hi) / 2)) for x in ny]
    return out, sum(out) / len(out) - sum(ref) / len(ref)


def _t(diffs: list[float]) -> float:
    """mean / (sd / sqrt(n)): the standardised mean of the bootstrap distribution."""
    n = len(diffs)
    m = sum(diffs) / n
    sd = math.sqrt(sum((x - m) ** 2 for x in diffs) / n)
    if sd < 1e-12:
        return 0.0 if abs(m) <= 1e-12 else math.copysign(math.inf, m)
    return m * math.sqrt(n) / sd


def simulate(ny: list[float], ref: list[float], delta: float, k: int, n: int, sims: int, seed: str) -> Power:  # fmt: skip
    rng = random.Random(seed)
    new, eff = shift(ny, ref, delta)
    p80 = ci = 0
    for _ in range(sims):
        diffs = []
        for i in rng.choices(range(len(ref)), k=n):
            a = sum(rng.random() < new[i] for _ in range(k))
            b = sum(rng.random() < ref[i] for _ in range(k))
            diffs.append((a - b) / k)
        t = _t(diffs)
        p80 += stats.prob_superior(diffs, n_boot=SIM_BOOT) >= stats.AHEAD_P
        ci += t > stats.Z
    return Power(p80 / sims, ci / sims, eff)


def grid(ny: list[float], ref: list[float], deltas: list[float], ks: list[int], ns: list[int], sims: int) -> list[dict[str, Any]]:  # fmt: skip
    return [
        {"delta": d, "k": k, "n": n, **simulate(ny, ref, d, k, n, sims, f"{stats.SEED}/{d}/{k}/{n}")._asdict()}
        for d in deltas for k in ks for n in ns
    ]  # fmt: skip


def minimum(
    cells: list[dict[str, Any]], delta: float, need: float = 0.80
) -> dict[str, int] | None:
    """Cheapest (fewest runs n*k per arm) cell of this gap with both powers >= need; None if the grid has none."""
    ok = [
        c
        for c in cells
        if c["delta"] == delta and c["p80"] >= need and c["ci90"] >= need
    ]
    if not ok:
        return None
    best = min(ok, key=lambda c: (c["n"] * c["k"], c["n"]))
    return {"k": best["k"], "n": best["n"]}


def render(data: dict[str, Any]) -> str:
    out = [
        "# Poder da afirmação \"à frente\"",
        "",
        (
            f"{data['tasks']} tarefas observadas; taxas encolhidas Beta({PRIOR}, {PRIOR}); {data['sims']} simulações por célula; "
            "semente fixa. P≥0,80: fração das simulações com P(à frente) ≥ 0,80; IC90>0: fração com limite inferior do IC90 > 0 "
            "(aproximação normal do bootstrap por tarefa)."
        ),
        "",
        "| Δ alvo | Δ efetivo | k | n | poder P≥0,80 | poder IC90>0 |",
        "|---|---|---|---|---|---|",
    ]  # fmt: skip
    for c in data["cells"]:
        out.append(
            f"| {c['delta'] * 100:+.0f} pp | {c['effective'] * 100:+.1f} pp | {c['k']} | {c['n']} | {c['p80']:.2f} | {c['ci90']:.2f} |"
        )
    off = sorted(
        {
            (c["delta"], round(c["effective"], 4))
            for c in data["cells"]
            if abs(c["effective"] - c["delta"]) > TOL
        }
    )
    for d, e in off:
        out.append("")
        out.append(
            f"Aviso: Δ alvo {d * 100:+.1f} pp inalcançável (o corte em [0, 1] limita); simulado Δ efetivo {e * 100:+.1f} pp."
        )
    if any(c["delta"] == 0 for c in data["cells"]):
        out += [
            "",
            'Δ = 0 mostra a taxa de falso positivo: poder P≥0,80 é a fração de rodadas sem diferença real que mesmo assim dizem "à frente".',
        ]
    out += [
        "",
        "Mínimo com os dois poderes ≥ 0,80 (menos execuções n×k por braço):",
        "",
    ]
    for d, m in data["minimum"].items():
        if float(d) <= 0:
            continue
        out.append(
            f"- Δ {float(d) * 100:+.0f} pp: "
            + (f"n={m['n']}, k={m['k']}" if m else "nenhum na grade")
        )
    return "\n".join(out) + "\n"


def run(ny_dir: Path, ref_dir: Path, deltas: str, ks: str, ns: str, sims: int, json_out: Path | None) -> str:  # fmt: skip
    ny, ref = shrunk_rates(ny_dir, ref_dir)
    ds = [float(x) for x in deltas.split(",")]
    cells = grid(
        ny,
        ref,
        ds,
        [int(x) for x in ks.split(",")],
        [int(x) for x in ns.split(",")],
        sims,
    )
    data = {
        "tasks": len(ref),
        "sims": sims,
        "cells": cells,
        "minimum": {str(d): minimum(cells, d) for d in ds if d > 0},
    }
    if json_out:
        json_out.write_text(json.dumps(data, indent=1))
    return render(data)

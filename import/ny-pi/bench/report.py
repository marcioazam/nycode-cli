"""Tables per suite and arm from bench rounds (meta.json + runs.jsonl), used for the BASELINE, and the
scoreboard of the owner's three goal rules for the ny arm against reference rounds."""

import json
import statistics
from pathlib import Path
from typing import Any

from bench import stats

Run = dict[str, Any]


def _load(d: Path) -> tuple[dict[str, Any], list[Run]]:
    meta = json.loads((d / "meta.json").read_text())
    runs = [
        json.loads(x) for x in (d / "runs.jsonl").read_text().splitlines() if x.strip()
    ]
    return meta, runs


def _med(xs: list[float]) -> float | None:
    return statistics.median(xs) if xs else None


def _f(x: float | None, nd: int) -> str:
    return "n/a" if x is None else f"{x:.{nd}f}"


def suite_row(runs: list[Run]) -> dict[str, Any]:
    pt = stats._per_task(r for r in runs if not stats.excluded_run(r))
    rates = [t["rate"] for t in pt.values()]
    ci = stats.paired_ci(rates, alpha=0.05) if rates else None  # the table says IC95
    sec = [t for t in pt.values() if t["security"]]
    return {
        "tasks": len(pt),
        "runs": len(runs),
        "rate": statistics.mean(rates) if rates else None,
        "ci": ci,
        "cost_med": _med(
            [r["cost_usd"] for r in runs if r.get("cost_usd") is not None]
        ),
        "wall_p50": _med([r["wall_s"] for r in runs if r.get("wall_s") is not None]),
        "sec": f"{sum(t['all_pass'] for t in sec)}/{len(sec)}" if sec else "-",
        "subagents": sum(bool(r.get("subagents_used")) for r in runs),
        "errors": sum(bool(r.get("error")) for r in runs),
    }


def render(dirs: list[Path]) -> str:
    rounds = [_load(d) for d in dirs]
    suites = sorted({r["suite"] for _, runs in rounds for r in runs})
    out = ["# Bench report", ""]
    out.append(
        "| arm | versão | modelo | overlay | git | início | teto US$ | not_verified |"
    )
    out.append("|---|---|---|---|---|---|---|---|")
    for m, _ in rounds:
        out.append(
            f"| {m.get('arm')} | {m.get('arm_version')} | {m.get('model')} | {m.get('overlay_sha') or '-'} "
            f"| {str(m.get('git_sha'))[:12]} | {m.get('started')} | {m.get('budget_usd')} | {m.get('not_verified', False)} |"
        )
    for s in suites:
        out += [
            "",
            f"## {s}",
            "",
            "| arm | tarefas | runs | acerto | IC95 | custo mediano US$ | wall p50 s | segurança | subagentes | erros |",
        ]
        out.append("|---|---|---|---|---|---|---|---|---|---|")
        for m, runs in rounds:
            sr = [r for r in runs if r["suite"] == s]
            if not sr:
                continue
            x = suite_row(sr)
            ci = "n/a" if not x["ci"] else f"[{x['ci'][0]:.2f}, {x['ci'][1]:.2f}]"
            out.append(
                f"| {m.get('arm')} | {x['tasks']} | {x['runs']} | {_f(x['rate'], 3)} | {ci} "
                f"| {_f(x['cost_med'], 4)} | {_f(x['wall_p50'], 1)} | {x['sec']} | {x['subagents']} | {x['errors']} |"
            )
    return "\n".join(out) + "\n"


# ------------------------------------------------------------------------------------- scoreboard

EXCLUSIVE_RATE = 0.5  # R3: a task counts for an arm above this pass rate
ACCURACY_REF = "pi-vanilla"  # R1 compares with this arm; in R2 it is informative only


def _clean(rounds: list[list[Run]]) -> list[dict[str, stats.TaskStat]]:
    """Per-task stats of each round over the tasks all of them ran with no errored run."""
    bad = {r["task_id"] for runs in rounds for r in runs if r.get("error")}
    common = set.intersection(*({r["task_id"] for r in runs} for runs in rounds)) - bad
    return [stats._per_task(r for r in runs if r["task_id"] in common) for runs in rounds]  # fmt: skip


def _cost(pt: dict[str, stats.TaskStat]) -> float:
    """Sum of the per-task mean cost: the round's cost per repetition, comparable when k differs."""
    return sum(t["cost"] or 0.0 for t in pt.values())


def scoreboard(ny_dir: Path, ref_dirs: list[Path]) -> tuple[dict[str, Any], str]:
    """The owner's three goal rules for the ny arm against each reference round. Returns (data, Markdown).

    R1 accuracy: ny point rate >= pi-vanilla point rate. R2 cost ceiling: ny cost <= the cost of every
    reference other than pi-vanilla. R3 exception: tasks only ny solves. Goal met: R1 and (R2 or R3)."""
    ny_meta, ny = _load(ny_dir)
    refs = [(m.get("arm", d.name), runs) for d in ref_dirs for m, runs in [_load(d)]]
    rows: list[dict[str, Any]] = []
    for arm, runs in refs:
        a, b = _clean([ny, runs])
        tasks = sorted(a)
        diffs = [a[t]["rate"] - b[t]["rate"] for t in tasks]
        ca, cb = _cost(a), _cost(b)
        rows.append({
            "arm": arm, "n": len(tasks),
            "ny_rate": statistics.mean(a[t]["rate"] for t in tasks) if tasks else None,
            "ref_rate": statistics.mean(b[t]["rate"] for t in tasks) if tasks else None,
            "diff": statistics.mean(diffs) if tasks else None,
            "ci": stats.paired_ci(diffs) if tasks else None,
            "ny_cost": ca, "ref_cost": cb, "cost_ratio": ca / cb if cb > 0 else None,
        })  # fmt: skip
    acc = [x for x in rows if x["arm"] == ACCURACY_REF and x["n"]]
    r1 = bool(acc) and all(x["ny_rate"] >= x["ref_rate"] for x in acc)
    ceil = [x for x in rows if x["arm"] != ACCURACY_REF]
    r2 = bool(ceil) and all(x["cost_ratio"] is not None and x["cost_ratio"] <= 1 for x in ceil)  # fmt: skip
    me, *others = _clean([ny, *(runs for _, runs in refs)])
    exclusive = sorted(
        t for t, s in me.items()
        if s["rate"] > EXCLUSIVE_RATE and all(o[t]["rate"] == 0 for o in others)
    )  # fmt: skip
    inverse = sorted(
        t for t, s in me.items()
        if s["rate"] == 0 and all(o[t]["rate"] > EXCLUSIVE_RATE for o in others)
    )  # fmt: skip
    failed = [
        n for n, ok in (("R1", r1), ("R2", r2), ("R3", bool(exclusive))) if not ok
    ]
    met = r1 and (r2 or bool(exclusive))
    data = {"rows": rows, "r1": r1, "r2": r2, "exclusive": exclusive, "inverse": inverse, "met": met}  # fmt: skip

    def yn(ok: bool) -> str:
        return "cumprida" if ok else "não cumprida"

    ny_arm = ny_meta.get("arm", ny_dir.name)
    ci_pct = round((1 - stats.ALPHA) * 100)
    out = [
        f"# Placar do objetivo: {ny_arm}", "",
        "Tarefas em comum com cada referência, sem execução com erro. Custo = soma do custo médio por tarefa.", "",
        f"## R1 acerto: {yn(r1)}", "",
        f"Regra: taxa de acerto do {ny_arm} >= taxa do {ACCURACY_REF} (taxa pontual)."
        + ("" if acc else f" Sem rodada do {ACCURACY_REF}: não avaliada."), "",
        f"| referência | tarefas | {ny_arm} | referência | diferença | IC{ci_pct} pareado |",
        "|---|---|---|---|---|---|",
    ]  # fmt: skip
    for x in rows:
        ci = "n/a" if not x["ci"] else f"[{x['ci'][0]:+.3f}, {x['ci'][1]:+.3f}]"
        diff = "n/a" if x["diff"] is None else f"{x['diff']:+.3f}"
        out.append(f"| {x['arm']} | {x['n']} | {_f(x['ny_rate'], 3)} | {_f(x['ref_rate'], 3)} | {diff} | {ci} |")  # fmt: skip
    out += [
        "", f"## R2 teto de custo: {yn(r2)}", "",
        f"Regra: custo do {ny_arm} <= custo de cada referência nas mesmas tarefas; o {ACCURACY_REF} é informativo."
        + ("" if ceil else " Sem outra referência: não avaliada."), "",
        f"| referência | {ny_arm} US$ | referência US$ | razão | conta na regra |",
        "|---|---|---|---|---|",
    ]  # fmt: skip
    for x in rows:
        counts = "não (informativo)" if x["arm"] == ACCURACY_REF else "sim"
        out.append(f"| {x['arm']} | {x['ny_cost']:.4f} | {x['ref_cost']:.4f} | {_f(x['cost_ratio'], 2)} | {counts} |")  # fmt: skip
    out += [
        "", f"## R3 exceção: {len(exclusive)} tarefa(s) exclusiva(s)", "",
        f"Regra: taxa do {ny_arm} > {EXCLUSIVE_RATE} e taxa 0 em todas as referências ({len(me)} tarefas em comum).", "",
        f"- Só o {ny_arm} resolve: {', '.join(exclusive) or 'nenhuma'}",
        f"- Só o {ny_arm} falha (todas as referências > {EXCLUSIVE_RATE}): {', '.join(inverse) or 'nenhuma'}",
        "", "## Veredito", "",
        "OBJETIVO: cumprido" if met else f"OBJETIVO: não cumprido ({', '.join(failed)})",
        "", "Cumprido quando R1 e (R2 ou pelo menos 1 tarefa exclusiva).",
    ]  # fmt: skip
    return data, "\n".join(out) + "\n"

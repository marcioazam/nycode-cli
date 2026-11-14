"""Tables per suite and arm from bench rounds (meta.json + runs.jsonl), used for the BASELINE."""

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
    pt = stats._per_task(runs)
    rates = [t["rate"] for t in pt.values()]
    ci = stats.paired_ci(rates) if rates else None
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

"""Gate of a candidate round against the frozen base round: paired verdict, summary and the PR status.

A round directory holds meta.json and runs.jsonl (plus runs.ext.jsonl after the single extension).
"""

import fnmatch
import json
import os
import statistics
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any

from bench import stats

REPO = Path(__file__).resolve().parent.parent
EXTEND_REPS = 3  # single extension when INCONCLUSIVE: this many extra candidate reps


def load_round(d: Path) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    runs = [
        json.loads(x) for x in (d / "runs.jsonl").read_text().splitlines() if x.strip()
    ]
    ext = d / "runs.ext.jsonl"
    if ext.exists():
        runs += [json.loads(x) for x in ext.read_text().splitlines() if x.strip()]
    return runs, json.loads((d / "meta.json").read_text())


def suite_ratio(
    base: list[dict[str, Any]], cand: list[dict[str, Any]], suite: str
) -> float:
    """cand/base mean per-task pass rate of one suite (1.0 when absent), for the D7 plan/multi parts."""

    def rate(rs: list[dict[str, Any]]) -> float | None:
        pt = stats._per_task(r for r in rs if r.get("suite") == suite)
        return statistics.mean(x["rate"] for x in pt.values()) if pt else None

    b, c = rate(base), rate(cand)
    return 1.0 if b is None or c is None or b == 0 else min(1.0, c / b)


def changed_paths(base_sha: str | None, repo: Path = REPO) -> list[str]:
    if not base_sha:
        return []
    p = subprocess.run(
        ["git", "-C", str(repo), "diff", "--name-only", f"{base_sha}...HEAD"],
        capture_output=True,
        text=True,
        check=False,
    )
    return [x for x in p.stdout.splitlines() if x]


def suggestions(paths: list[str], cmap: dict[str, Any]) -> list[str]:
    """AC8: capabilities touched by the diff that no vanilla baseline covers."""
    out = []
    for cap, d in sorted(cmap.get("capabilities", {}).items()):
        if d.get("covered_by_vanilla"):
            continue
        if any(fnmatch.fnmatch(p, g) for p in paths for g in d.get("paths", [])):
            out.append(f"sugestão: re-testar vanilla para {cap}")
    return out


def _fmt(x: float | None, nd: int = 3) -> str:
    return "n/a" if x is None else f"{x:.{nd}f}"


def _extend(cmd: str, side: str, d: Path, tasks: list[str]) -> None:
    env = {**os.environ, "BENCH_EXTEND_SIDE": side, "BENCH_EXTEND_DIR": str(d), "BENCH_EXTEND_REPS": str(EXTEND_REPS),
           "BENCH_EXTEND_TASKS": ",".join(tasks), "BENCH_EXTEND_OUT": str(d / "runs.ext.jsonl")}  # fmt: skip
    subprocess.run(["bash", "-c", cmd], env=env, check=False)


def gate(
    base_dir: Path,
    cand_dir: Path,
    extend_cmd: str | None = None,
    cmap: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], str, int]:
    b_runs, b_meta = load_round(base_dir)
    c_runs, c_meta = load_round(cand_dir)
    refused = sorted(
        {r["task_id"] for r in b_runs + c_runs if r.get("error") == "refusal"}
    )
    b_runs = [
        r for r in b_runs if r["task_id"] not in refused
    ]  # AC10: excluded in every arm
    c_runs = [r for r in c_runs if r["task_id"] not in refused]

    def run_verdict(extended: bool) -> dict[str, Any]:
        return stats.verdict(
            b_runs, c_runs, b_meta, c_meta, extended,
            plan=suite_ratio(b_runs, c_runs, "s4"), multi=suite_ratio(b_runs, c_runs, "s5"),
        )  # fmt: skip

    v = run_verdict(False)
    extended = False
    if v["verdict"] == "INCONCLUSIVE" and extend_cmd:
        tasks = stats.tasks_to_extend(b_runs, c_runs)
        if tasks:
            # Only the candidate grows: the base is the frozen k12 round (tier baseline).
            _extend(extend_cmd, "cand", cand_dir, tasks)
            c_runs, _ = load_round(cand_dir)
            c_runs = [r for r in c_runs if r["task_id"] not in refused]
        extended = True
        v = run_verdict(True)
    if c_meta.get("not_verified"):
        v["verdict"] = "NOT_VERIFIED"  # AC6: budget stop is never a pass
    held_b = [r for r in b_runs if r.get("split") == "heldout"]
    held_c = [r for r in c_runs if r.get("split") == "heldout"]
    held = (
        stats.verdict(held_b, held_c, b_meta, c_meta, True)
        if held_b and held_c
        else None
    )
    sugg = suggestions(changed_paths(b_meta.get("git_sha")), cmap or {})
    md = render_summary(
        v, held, b_runs, c_runs, extended, refused, sugg, b_meta, c_meta
    )
    code = 5 if v["verdict"] == "NOT_VERIFIED" else stats.EXIT[v["verdict"]]
    return v, md, code


def render_summary(
    v: dict[str, Any], held: dict[str, Any] | None, b: list[dict[str, Any]], c: list[dict[str, Any]],
    extended: bool, refused: list[str], sugg: list[str], b_meta: dict[str, Any], c_meta: dict[str, Any],
) -> str:  # fmt: skip
    ci = v["ci"]
    ci_s = "n/a" if not ci else f"[{ci[0]:+.3f}, {ci[1]:+.3f}]"

    def med(rs: list[dict[str, Any]], key: str) -> float | None:
        xs = [r[key] for r in rs if r.get(key) is not None]
        return statistics.median(xs) if xs else None

    L = [
        f"## bench-pr: {v['verdict']}", "",
        f"- Tarefas pareadas (n): {v['n']}; IC{round((1 - stats.ALPHA) * 100)} da diferença de acerto (PR − base): {ci_s}; margem {stats.MARGIN * 100:+.0f} pp"
        + (f" (estendido +{EXTEND_REPS} reps do candidato)" if extended else ""),
        "- Regras: " + ", ".join(f"{k}={x}" for k, x in v["rules"].items()),
        f"- Custo mediano: base {_fmt(med(b, 'cost_usd'), 4)} / PR {_fmt(med(c, 'cost_usd'), 4)} (razão {_fmt(v['cost_ratio'])}; limite 1,10)",
        f"- Wall p50: base {_fmt(med(b, 'wall_s'), 1)} s / PR {_fmt(med(c, 'wall_s'), 1)} s (razão {_fmt(v['wall_ratio'])}; limite 1,20)",
        f"- Gasto da rodada PR: US$ {sum(r.get('cost_usd') or 0 for r in c):.2f} (teto US$ {c_meta.get('budget_usd')})",
        f"- Segurança: {'REGRESSÃO em ' + ', '.join(v['security_regressions']) if v['security_regressions'] else 'sem regressão'}",
        f"- Pontuação D7 (informativa): {v['score']}",
    ]  # fmt: skip
    if held:
        hci = held["ci"]
        L.append(
            f"- Held-out (separado, informativo): n={held['n']}, IC "
            + ("n/a" if not hci else f"[{hci[0]:+.3f}, {hci[1]:+.3f}]")
            + f", acerto={held['rules'].get('accuracy')}"
        )
    else:
        L.append("- Held-out: sem dados pareados")
    if v["verdict"] == "NOT_COMPARABLE":
        L.append(f"- Metadados diferem: base {b_meta} vs PR {c_meta}")
    if v["verdict"] == "NOT_VERIFIED":
        L.append(
            "- Orçamento esgotado antes de terminar: não verificado, nunca aprovado (AC6)"
        )
    if v.get("excluded"):
        L.append(
            f"- Tarefas excluídas do pareamento por execução com erro: {v['excluded']}"
        )
    if refused:
        L.append(f"- Excluídas por recusa do provedor: {', '.join(refused)}")
    L += [f"- {s}" for s in sugg]
    return "\n".join(L) + "\n"


# ------------------------------------------------------------------------------------ post-status


def gh_run(args: list[str]) -> str:
    return subprocess.run(
        ["gh", *args], capture_output=True, text=True, check=True
    ).stdout


def post_status(
    pr: int, state: str, description: str, run_gh: Callable[[list[str]], str] = gh_run
) -> int:
    """L1: only PRs authored by the repository owner get a `bench-pr` status."""
    repo = json.loads(run_gh(["repo", "view", "--json", "nameWithOwner,owner"]))
    info = json.loads(run_gh(["pr", "view", str(pr), "--json", "author,headRefOid"]))
    if info["author"]["login"] != repo["owner"]["login"]:
        print(
            f"refused: PR #{pr} author {info['author']['login']} is not the repository owner",
            file=sys.stderr,
        )
        return 3
    run_gh([
        "api", f"repos/{repo['nameWithOwner']}/statuses/{info['headRefOid']}",
        "-f", f"state={state}", "-f", "context=bench-pr", "-f", f"description={description[:140]}",
    ])  # fmt: skip
    print(f"bench-pr {state} on {info['headRefOid'][:12]}")
    return 0

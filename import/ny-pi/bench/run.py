#!/usr/bin/env python3
"""bench: orchestrator for the S1-S7 benchmark (record docs/bench/pi-harness-ci-2026-11-13.md).

  run          run a tier for one arm (--dry-run prints the plan and the estimated cost, runs nothing)
  gate         paired verdict (D6) of a candidate round against the frozen base round + summary (AC5, AC8)
  post-status  publish the `bench-pr` commit status of a PR (L1: owner-authored PRs only)
  report       tables per suite and arm from rounds, used for the BASELINE
  probe        S6 offline capability probes (`<arm> --help` contains the flag)

A round directory holds meta.json {arm, arm_version, model, overlay_sha, git_sha, started, budget_usd, ...}
and runs.jsonl in the common run format (see runners.make_run). The OAuth token is never printed or stored.
"""

import argparse
import fnmatch
import glob
import json
import os
import statistics
import subprocess
import sys
import tomllib
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from bench import report, runners, stats

BENCH = Path(__file__).resolve().parent
REPO = BENCH.parent
HARBOR_DIR = REPO / "claude-home/bin/evals/harbor"
NOT_VERIFIED_EXIT = 5
Step = dict[str, Any]


def load_toml(p: Path) -> dict[str, Any]:
    with p.open("rb") as f:
        return tomllib.load(f)


def arm_info(arm: str, arms: dict[str, Any]) -> tuple[str, Path]:
    """(kind cc|pi, absolute binary path) from bench/arms.toml."""
    a = arms[arm]
    return ("cc" if a["runner"] == "run.py" else "pi"), BENCH / a["bin"]


# ------------------------------------------------------------------------------------------ plan


def _harbor_tasks(s: dict[str, Any], step: Step) -> list[str] | None:
    tf = BENCH / s["tasks_file"] if s.get("tasks_file") else None
    if not tf or not tf.exists():
        return None
    names, heldout = runners.load_tasks(tf)
    return runners.sample_tasks(
        names,
        runners.load_excluded(BENCH / s["excluded_file"]),
        step.get("n"),
        s["seed"],
        s["heldout_pct"],
        step.get("splits"),
        heldout,
    )


def build_plan(
    tier: str,
    suites_cfg: dict[str, Any],
    only: list[str] | None = None,
    k: int | None = None,
) -> list[Step]:
    steps: list[Step] = []
    for st in suites_cfg["tier"][tier]["steps"]:
        if only and st["suite"] not in only:
            continue
        s = suites_cfg["suite"][st["suite"]]
        kk = k or st["k"]
        step: Step = {
            "suite": st["suite"],
            "kind": s["kind"],
            "k": kk,
            "est": s["est_cost_usd"],
            "cfg": s,
            "st": st,
        }
        if s["kind"] == "internal":
            step["tasks"] = s["pr_cases"] if st.get("subset") == "pr" else s["cases"]
        elif s["kind"] == "harbor":
            step["tasks"] = _harbor_tasks(s, st)
            step["units"] = (
                len(step["tasks"]) if step["tasks"] is not None else (st.get("n") or 89)
            )
        else:
            step["cases"] = runners.load_cases(BENCH / s["dir"], st.get("splits"))
            step["units"] = len(step["cases"])
        step.setdefault("units", len(step.get("tasks") or []))
        step["est_total"] = round(step["units"] * kk * step["est"], 2)
        steps.append(step)
    return steps


def render_plan(
    arm: str, tier: str, model: str, budget: float, steps: list[Step]
) -> str:
    lines = [f"plan: arm={arm} tier={tier} model={model} budget=US${budget:.2f}"]
    for s in steps:
        note = ""
        if s["kind"] == "harbor" and s["tasks"] is None:
            note = " (task list file missing: harbor -l/-x, size assumed)"
        if s["kind"] == "case" and not s["units"]:
            note = " (no cases yet)"
        lines.append(
            f"  {s['suite']:3} {s['kind']:8} units={s['units']:3} k={s['k']} "
            f"est=US${s['est_total']:.2f}{note}"
        )
    total = round(sum(s["est_total"] for s in steps), 2)
    lines.append(f"estimated total: US${total:.2f} (budget US${budget:.2f})")
    if total > budget:
        lines.append(
            "WARNING: estimate exceeds the budget; the run stops and ends not_verified at the cap"
        )
    lines.append("dry-run: nothing was executed")
    return "\n".join(lines)


# ----------------------------------------------------------------------------------------- exec


def oauth_token() -> str:
    p = subprocess.run(
        ["bash", "-c", f'. "{BENCH}/arms/oauth-token.sh"; bench_oauth_token'],
        capture_output=True, text=True, check=True,
    )  # fmt: skip
    return p.stdout.strip()


def arm_meta(
    arm: str, arms: dict[str, Any], kind: str, bin_: Path, model: str, budget: float
) -> dict[str, Any]:
    ver = arms[arm].get("version", "")
    try:
        p = subprocess.run(
            [str(bin_), "--version"],
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
        if p.returncode == 0 and p.stdout.strip():
            ver = p.stdout.strip().splitlines()[0]
    except (OSError, subprocess.TimeoutExpired):
        pass
    sha = subprocess.run(
        ["git", "-C", str(REPO), "rev-parse", "HEAD"],
        capture_output=True,
        text=True,
        check=False,
    ).stdout.strip()
    meta: dict[str, Any] = {
        "arm": arm, "arm_version": ver, "model": model, "git_sha": sha,
        "started": datetime.now(UTC).isoformat(timespec="seconds"), "budget_usd": budget,
    }  # fmt: skip
    if arm == "my-pi":
        meta["overlay_sha"] = overlay_sha(sha[:12])
    return meta


def overlay_sha(short: str) -> str | None:
    stage = os.environ.get("BENCH_STAGE")
    cands = (
        [Path(stage)]
        if stage
        else sorted(Path(os.environ.get("TMPDIR", "/tmp")).glob(f"bench-mypi-{short}*"))
    )
    for c in reversed(cands):
        f = c / ".overlay-sha"
        if f.exists():
            return f.read_text().strip()
    return None


def _harbor_step(
    s: Step, arm: str, model: str, out: Path, left: float
) -> tuple[list[dict[str, Any]], bool]:
    cfg = s["cfg"]
    agent_args, extra, tok_name = runners.harbor_agent(arm, model, HARBOR_DIR)
    env = {tok_name: oauth_token(), **extra}
    if arm == "my-pi":
        subprocess.run(
            ["bash", str(HARBOR_DIR / "bundle.sh")], check=True, capture_output=True
        )
    excl = (
        runners.load_excluded(BENCH / cfg["excluded_file"])
        if cfg.get("excluded_file")
        else {}
    )
    tasks = s["tasks"]
    jobs = out / "harbor"
    tf = BENCH / cfg["tasks_file"] if cfg.get("tasks_file") else None
    heldout = runners.load_tasks(tf)[1] if tf and tf.exists() else None
    splits = {
        t: runners.split_of(t, cfg["seed"], cfg["heldout_pct"], heldout)
        for t in tasks or []
    }
    chunks = [tasks[i : i + 4] for i in range(0, len(tasks), 4)] if tasks else [[]]

    def make(chunk: list[str], job: str) -> list[str]:
        return runners.harbor_cmd(
            cfg["dataset"],
            agent_args,
            job,
            jobs,
            chunk or None,
            s["st"].get("n"),
            excl,
            s["k"],
        )

    return runners.run_harbor([], jobs, s["suite"], env, chunks, left, make, splits)


def execute(
    arm: str,
    tier: str,
    model: str,
    budget: float,
    steps: list[Step],
    arms: dict[str, Any],
    out: Path,
) -> int:
    kind, bin_ = arm_info(arm, arms)
    out.mkdir(parents=True, exist_ok=True)
    meta = arm_meta(arm, arms, kind, bin_, model, budget) | {
        "tier": tier,
        "not_verified": False,
        "errors": [],
    }
    spent = 0.0
    runs_f = out / "runs.jsonl"
    runs_f.write_text("")

    def save(rs: list[dict[str, Any]]) -> None:
        with runs_f.open("a") as f:
            for r in rs:
                f.write(json.dumps(r) + "\n")

    for s in steps:
        left = budget - spent
        if left <= 0:
            meta["not_verified"] = True
            break
        rs: list[dict[str, Any]] = []
        if s["kind"] == "internal":
            rs, err = runners.run_s1(
                kind, bin_, s["tasks"], s["k"], model, left, f"bench-{arm}-{tier}", {}
            )
            if err:
                meta["errors"].append(f"s1: {err}")
            save(rs)
        elif s["kind"] == "harbor":
            rs, exhausted = _harbor_step(s, arm, model, out, left)
            save(rs)
            meta["not_verified"] |= exhausted
        else:
            for case in s["cases"]:
                for rep in range(s["k"]):
                    if budget - spent - runners.run_cost(rs) <= 0:
                        meta["not_verified"] = True
                        break
                    r = runners.run_case(
                        case,
                        s["suite"],
                        rep,
                        kind,
                        bin_,
                        model,
                        {},
                        budget - spent - runners.run_cost(rs),
                    )
                    rs.append(r)
                    save([r])
        spent += runners.run_cost(rs)
        if spent >= budget:
            meta["not_verified"] = True
        if meta["not_verified"]:
            break
    meta["cost_usd"] = round(spent, 4)
    (out / "meta.json").write_text(json.dumps(meta, indent=2) + "\n")
    print(f"round: {out} cost=US${spent:.4f} not_verified={meta['not_verified']}")
    return NOT_VERIFIED_EXIT if meta["not_verified"] else 0


# ------------------------------------------------------------------------------------------ gate


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
    env = {**os.environ, "BENCH_EXTEND_SIDE": side, "BENCH_EXTEND_DIR": str(d), "BENCH_EXTEND_REPS": "2",
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
            _extend(extend_cmd, "base", base_dir, tasks)
            _extend(extend_cmd, "cand", cand_dir, tasks)
            b_runs, _ = load_round(base_dir)
            c_runs, _ = load_round(cand_dir)
            b_runs = [r for r in b_runs if r["task_id"] not in refused]
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
        f"- Tarefas pareadas (n): {v['n']}; IC95 da diferença de acerto (PR − base): {ci_s}"
        + (" (estendido +2 reps, D6e)" if extended else ""),
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


# ------------------------------------------------------------------------------------------ probe


def probe(
    arms: dict[str, Any], caps: dict[str, Any], env: dict[str, str] | None = None
) -> str:
    """S6: offline flag probes via `--help`; my-pi uses the pi-vanilla binary (same pi core)."""
    helps: dict[str, str | None] = {}
    for arm in ("cc-vanilla", "pi-vanilla"):
        try:
            p = subprocess.run(
                [str(arm_info(arm, arms)[1]), "--help"], capture_output=True, text=True, timeout=60,
                env={**os.environ, **(env or {})}, check=False)  # fmt: skip
            helps[arm] = p.stdout + p.stderr if p.returncode == 0 else None
        except (OSError, subprocess.TimeoutExpired):
            helps[arm] = None
    helps["my-pi"] = helps["pi-vanilla"]
    lines = ["| recurso | cc-vanilla | pi-vanilla | my-pi |", "|---|---|---|---|"]
    for name, row in caps.items():
        cells = []
        for arm in ("cc-vanilla", "pi-vanilla", "my-pi"):
            e = row[arm]
            mark = ""
            if e.get("flag"):
                h = helps[arm]
                mark = (
                    " (sonda: não executada)"
                    if h is None
                    else (
                        f" (sonda ok {e['flag']})"
                        if e["flag"] in h
                        else f" (sonda FALHOU {e['flag']})"
                    )
                )
            cells.append(f"{e['value']}{mark}")
        lines.append(f"| {name} | " + " | ".join(cells) + " |")
    return "\n".join(lines) + "\n"


# ------------------------------------------------------------------------------------------ main


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="bench")
    sub = p.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--arm", required=True)
    r.add_argument("--tier", required=True, choices=["pr", "full", "vanilla"])
    r.add_argument("--model", required=True)
    r.add_argument("--budget-usd", type=float, required=True)
    r.add_argument("--suites", nargs="*")
    r.add_argument("--k", type=int)
    r.add_argument("--dry-run", action="store_true")
    r.add_argument("--out", type=Path)
    g = sub.add_parser("gate")
    g.add_argument("--base", type=Path, required=True)
    g.add_argument("--cand", type=Path, required=True)
    g.add_argument("--extend-with-cmd")
    s = sub.add_parser("post-status")
    s.add_argument("--pr", type=int, required=True)
    s.add_argument(
        "--state", required=True, choices=["pending", "success", "failure", "error"]
    )
    s.add_argument("--description", required=True)
    rp = sub.add_parser("report")
    rp.add_argument("--runs", nargs="+", type=Path, required=True)
    rp.add_argument("--out", type=Path, required=True)
    sub.add_parser("probe")
    a = p.parse_args(argv)

    if a.cmd == "run":
        arms, suites_cfg = (
            load_toml(BENCH / "arms.toml"),
            load_toml(BENCH / "suites.toml"),
        )
        if a.arm not in arms:
            p.error(f"unknown arm {a.arm}; known: {', '.join(arms)}")
        steps = build_plan(a.tier, suites_cfg, a.suites, a.k)
        if a.dry_run:
            print(render_plan(a.arm, a.tier, a.model, a.budget_usd, steps))
            return 0
        if "BENCH_CC_CREDENTIALS" not in os.environ:
            p.error("BENCH_CC_CREDENTIALS is required for a real run")
        out = (
            a.out
            or Path(os.environ.get("BENCH_OUT", "/tmp"))
            / f"bench-{a.arm}-{a.tier}-{datetime.now(UTC):%Y%m%dT%H%M%S}"
        )
        return execute(a.arm, a.tier, a.model, a.budget_usd, steps, arms, out)
    if a.cmd == "gate":
        cmf = REPO / "docs/bench/coverage-map.json"
        v, md, code = gate(
            a.base,
            a.cand,
            a.extend_with_cmd,
            json.loads(cmf.read_text()) if cmf.exists() else {},
        )
        print(md)
        if os.environ.get("GITHUB_STEP_SUMMARY"):
            with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as f:
                f.write(md)
        (a.cand / "verdict.json").write_text(json.dumps(v, indent=2) + "\n")
        return code
    if a.cmd == "post-status":
        return post_status(a.pr, a.state, a.description)
    if a.cmd == "report":
        dirs = [Path(x) for pat in a.runs for x in (glob.glob(str(pat)) or [str(pat)])]
        a.out.write_text(report.render(dirs))
        print(f"report: {a.out}")
        return 0
    print(probe(load_toml(BENCH / "arms.toml"), load_toml(BENCH / "capabilities.toml")))
    return 0


if __name__ == "__main__":
    sys.exit(main())

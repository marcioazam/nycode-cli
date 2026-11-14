#!/usr/bin/env python3
"""bench: orchestrator for the S1-S7 benchmark (record docs/bench/pi-harness-ci-2026-11-13.md).

  run          run a tier for one arm (--dry-run prints the plan and the estimated cost, runs nothing)
  gate         paired verdict of a candidate round against the frozen base round + summary (bench/gate.py)
  post-status  publish the `bench-pr` commit status of a PR (L1: owner-authored PRs only)
  report       tables per suite and arm from rounds, used for the BASELINE
  scoreboard   the owner's three goal rules (accuracy, cost ceiling, exception) of ny-pi against reference rounds
  evidence     per-run log paths, tool usage and cross-arm divergences (local only)
  probe        S6 offline capability probes (`<arm> --help` contains the flag)

A round directory holds meta.json {arm, arm_version, model, overlay_sha, git_sha, started, budget_usd, ...}
and runs.jsonl in the common run format (see runners.make_run). The OAuth token is never printed or stored.
"""

import argparse
import glob
import json
import os
import shutil
import subprocess
import sys
import threading
import tomllib
from collections.abc import Callable, Collection
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from bench import evidence, gate, report, runners

BENCH = Path(__file__).resolve().parent
REPO = BENCH.parent
HARBOR_DIR = REPO / "claude-home/bin/evals/harbor"
NOT_VERIFIED_EXIT = 5
MAX_ERROR_SHARE = (
    0.10  # a stage with more errored runs than this ends the round (infra, not a score)
)
Key = tuple[str, str, int]  # (suite, task_id, rep)
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
    if arm == "ny-pi":
        meta["overlay_sha"] = overlay_sha(sha[:12])
    return meta


def stage_root() -> Path:
    """Where arms/ny-pi builds its stage; never /tmp (the eval sandbox hides it behind a private tmpfs)."""
    return Path(os.environ.get("BENCH_STAGE_ROOT", Path.home() / ".cache/bench"))


def nypi_stage(short: str) -> Path | None:
    """The ny-pi stage built from this checkout (arms/ny-pi), identified by its .overlay-sha."""
    stage = os.environ.get("BENCH_STAGE")
    cands = (
        [Path(stage)] if stage else sorted(stage_root().glob(f"bench-nypi-{short}*"))
    )
    return next((c for c in reversed(cands) if (c / ".overlay-sha").exists()), None)


def overlay_sha(short: str) -> str | None:
    stage = nypi_stage(short)
    return (stage / ".overlay-sha").read_text().strip() if stage else None


def _harbor_step(
    s: Step,
    arm: str,
    model: str,
    out: Path,
    left: float,
    done: Collection[Key] = (),
    sink: Callable[[list[dict[str, Any]]], None] | None = None,
    jobs_n: int = 4,
) -> tuple[list[dict[str, Any]], bool]:
    cfg = s["cfg"]
    agent_args, extra, tok_name = runners.harbor_agent(arm, model, HARBOR_DIR)
    env = {tok_name: oauth_token(), **extra}
    if arm == "ny-pi":
        # Bundle the stage of THIS checkout, never the live ~/.pi (2026-11-14: Harbor measured the local harness).
        short = subprocess.run(
            ["git", "-C", str(REPO), "rev-parse", "--short=12", "HEAD"],
            capture_output=True, text=True, check=True,
        ).stdout.strip()  # fmt: skip
        stage = nypi_stage(short)
        if stage is None:
            raise RuntimeError(f"ny-pi stage for {short} not built; run the arm first")
        subprocess.run(
            ["bash", str(HARBOR_DIR / "bundle.sh")],
            check=True, capture_output=True, env={**os.environ, "HOME": str(stage)},
        )  # fmt: skip
    if (
        arm == "omp"
    ):  # fetch and checksum the pinned binaries the agent uploads (idempotent)
        subprocess.run(
            ["bash", str(HARBOR_DIR / "omp-release.sh")],
            check=True,
            capture_output=True,
        )
    excl = (
        runners.load_excluded(BENCH / cfg["excluded_file"])
        if cfg.get("excluded_file")
        else {}
    )
    tasks = s["tasks"]
    if tasks and done:  # resume: a task is finished once every rep is valid
        tasks = [
            t
            for t in tasks
            if not all((s["suite"], t, i) in done for i in range(s["k"]))
        ]
        if not tasks:
            return [], False  # [] would make harbor run the whole dataset
    jobs = out / "harbor"
    tf = BENCH / cfg["tasks_file"] if cfg.get("tasks_file") else None
    heldout = runners.load_tasks(tf)[1] if tf and tf.exists() else None
    splits = {
        t: runners.split_of(t, cfg["seed"], cfg["heldout_pct"], heldout)
        for t in tasks or []
    }
    n = max(
        4, jobs_n
    )  # trials in parallel = chunk size; a chunk is the unit saved and budget-checked
    chunks = [tasks[i : i + n] for i in range(0, len(tasks), n)] if tasks else [[]]

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
            concurrent=n,
            timeout_mult=cfg.get("agent_timeout_multiplier"),
        )

    return runners.run_harbor(
        [], jobs, s["suite"], env, chunks, left, make, splits, sink
    )


def _kept_runs(runs_f: Path) -> list[dict[str, Any]]:
    """--resume: the valid (error-free) runs of an earlier attempt of this round."""
    if not runs_f.exists():
        return []
    rs = [json.loads(x) for x in runs_f.read_text().splitlines() if x.strip()]
    return [r for r in rs if not r.get("error")]


def execute(
    arm: str,
    tier: str,
    model: str,
    budget: float,
    steps: list[Step],
    arms: dict[str, Any],
    out: Path,
    resume: bool = False,
    jobs: int = 1,
) -> int:
    """Run the steps. jobs > 1: suites run side by side and each runs `jobs` units at once. Wall time is then only
    comparable between rounds with the same `jobs` (recorded in meta, checked by the gate)."""
    kind, bin_ = arm_info(arm, arms)
    out.mkdir(parents=True, exist_ok=True)
    meta = arm_meta(arm, arms, kind, bin_, model, budget) | {
        "tier": tier,
        "jobs": jobs,
        "not_verified": False,
        "errors": [],
    }
    runs_f = out / "runs.jsonl"
    kept = _kept_runs(runs_f) if resume else []
    runs_f.write_text("".join(json.dumps(r) + "\n" for r in kept))
    done: set[Key] = {(r["suite"], r["task_id"], r["rep"]) for r in kept}
    spent = [runners.run_cost(kept)]  # shared by the step threads, guarded by `lock`
    lock = threading.Lock()

    def save(rs: list[dict[str, Any]]) -> None:
        with lock, runs_f.open("a") as f:
            for r in rs:
                f.write(json.dumps(r) + "\n")
            spent[0] += runners.run_cost(rs)

    def fresh(rs: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return [r for r in rs if (r["suite"], r["task_id"], r["rep"]) not in done]

    def step(s: Step) -> None:
        # ponytail: S1 and Harbor get the remaining budget up front, so parallel suites can overshoot the cap by
        # at most one stage each; the round still ends not_verified. Per-stage allocation if that ever bites.
        left = budget - spent[0]
        if meta["not_verified"]:
            return  # an earlier stage stopped the round (sequential mode)
        if left <= 0:
            meta["not_verified"] = True
            return
        rs: list[dict[str, Any]] = []
        if s["kind"] == "internal":
            reps = runners.s1_case_reps(s["tasks"], s["k"])
            todo = [
                t for t in s["tasks"]
                if not all((s["suite"], t, i) in done for i in range(reps[t]))
            ]  # fmt: skip
            if todo:
                rs, err = runners.run_s1(
                    kind, bin_, todo, s["k"], model, left, f"bench-{arm}-{tier}", {},
                    max(2, jobs),
                )  # fmt: skip
                if err:
                    meta["errors"].append(f"s1: {err}")
                rs = fresh(rs)
            save(rs)
        elif s["kind"] == "harbor":
            # Each chunk is recorded as it ends: a killed round keeps its finished trials.
            rs, exhausted = _harbor_step(
                s, arm, model, out, left, done, lambda got: save(fresh(got)), jobs
            )
            rs = fresh(rs)
            meta["not_verified"] |= exhausted
        else:
            units = [
                (c, rep) for c in s["cases"] for rep in range(s["k"])
                if (s["suite"], c["id"], rep) not in done
            ]  # fmt: skip

            def one(u: tuple[dict[str, Any], int]) -> dict[str, Any]:
                r = runners.run_case(
                    u[0], s["suite"], u[1], kind, bin_, model, {},
                    budget - spent[0], out / "artifacts",
                )  # fmt: skip
                save([r])
                return r

            for i in range(
                0, len(units), jobs
            ):  # a batch is the unit checked for budget and infra failures
                if (
                    runners.infra_streak(rs) >= runners.INFRA_STREAK
                    or budget - spent[0] <= 0
                ):
                    meta["not_verified"] = True
                    break
                with ThreadPoolExecutor(jobs) as ex:
                    rs += list(ex.map(one, units[i : i + jobs]))
        bad = sum(1 for r in rs if r.get("error"))
        if rs and bad / len(rs) > MAX_ERROR_SHARE:
            # quota (429), auth, disk or sandbox failures are no score: stop before the next stage
            meta["errors"].append(
                f"{s['suite']}: {bad}/{len(rs)} runs with error (> {MAX_ERROR_SHARE:.0%}), infra suspected"
            )
            meta["not_verified"] = True
        if spent[0] >= budget:
            meta["not_verified"] = True

    with ThreadPoolExecutor(len(steps) if jobs > 1 and steps else 1) as ex:
        list(
            ex.map(step, steps)
        )  # list(): a stage's exception fails the round, as before
    meta["cost_usd"] = round(spent[0], 4)
    (out / "meta.json").write_text(json.dumps(meta, indent=2) + "\n")
    print(f"round: {out} cost=US${spent[0]:.4f} not_verified={meta['not_verified']}")
    return NOT_VERIFIED_EXIT if meta["not_verified"] else 0


# ------------------------------------------------------------------------------------------ probe


def probe(
    arms: dict[str, Any], caps: dict[str, Any], env: dict[str, str] | None = None
) -> str:
    """S6: offline flag probes via `--help`; ny-pi uses the pi-vanilla binary (same pi core)."""
    helps: dict[str, str | None] = {}
    for arm in ("cc-vanilla", "pi-vanilla"):
        try:
            p = subprocess.run(
                [str(arm_info(arm, arms)[1]), "--help"], capture_output=True, text=True, timeout=60,
                env={**os.environ, **(env or {})}, check=False)  # fmt: skip
            helps[arm] = p.stdout + p.stderr if p.returncode == 0 else None
        except (OSError, subprocess.TimeoutExpired):
            helps[arm] = None
    helps["ny-pi"] = helps["pi-vanilla"]
    lines = ["| recurso | cc-vanilla | pi-vanilla | ny-pi |", "|---|---|---|---|"]
    for name, row in caps.items():
        cells = []
        for arm in ("cc-vanilla", "pi-vanilla", "ny-pi"):
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
    r.add_argument(
        "--tier", required=True, choices=["pr", "baseline", "full", "vanilla", "tb41"]
    )
    r.add_argument("--model", required=True)
    r.add_argument("--budget-usd", type=float, required=True)
    r.add_argument("--suites", nargs="*")
    r.add_argument("--k", type=int)
    r.add_argument("--dry-run", action="store_true")
    r.add_argument(
        "--jobs",
        type=int,
        default=int(os.environ.get("BENCH_JOBS", "4")),
        help="units in parallel per suite; above 1 the suites also run side by side (1 = fully sequential)",
    )
    r.add_argument(
        "--resume",
        action="store_true",
        help="keep valid runs in <out>/runs.jsonl, redo the rest",
    )
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
    sb = sub.add_parser("scoreboard")
    sb.add_argument("--ny", type=Path, required=True)
    sb.add_argument("--refs", nargs="+", type=Path, required=True)
    sb.add_argument("--out", type=Path)
    ev = sub.add_parser("evidence")
    ev.add_argument("--runs", nargs="+", type=Path, required=True)
    ev.add_argument("--out", type=Path, required=True)
    ev.add_argument("--focus", default="ny-pi", help="arm whose gaps are detailed")
    ev.add_argument(
        "--strict", action="store_true", help="exit 1 when a run has no transcript"
    )
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
        floor = float(os.environ.get("BENCH_MIN_FREE_GB", "30"))
        free = shutil.disk_usage(Path.home()).free / 2**30
        if (
            free < floor
        ):  # a full disk killed python (exit 120) with empty logs (baseline 2026-11-14)
            p.error(
                f"only {free:.1f} GB free in $HOME, below {floor:g} GB (BENCH_MIN_FREE_GB): free space first"
            )
        if a.resume and not a.out:
            p.error("--resume needs --out (the round directory to continue)")
        if "BENCH_CC_CREDENTIALS" not in os.environ:
            p.error("BENCH_CC_CREDENTIALS is required for a real run")
        try:  # preflight: a dying token fails every run silently (baseline 2026-11-14)
            oauth_token()
        except subprocess.CalledProcessError as e:
            p.error(f"OAuth preflight failed: {(e.stderr or '').strip()[-300:]}")
        out = (
            a.out
            or Path(os.environ.get("BENCH_OUT", "/tmp"))
            / f"bench-{a.arm}-{a.tier}-{datetime.now(UTC):%Y%m%dT%H%M%S}"
        )
        return execute(
            a.arm,
            a.tier,
            a.model,
            a.budget_usd,
            steps,
            arms,
            out,
            a.resume,
            max(1, a.jobs),
        )
    if a.cmd == "gate":
        cmf = REPO / "docs/bench/coverage-map.json"
        v, md, code = gate.gate(
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
        return gate.post_status(a.pr, a.state, a.description)
    if a.cmd == "scoreboard":
        md = report.scoreboard(a.ny, a.refs)[1]
        print(md)
        if a.out:
            a.out.write_text(md)
        return 0  # informative: never a gate
    if a.cmd == "report":
        dirs = [Path(x) for pat in a.runs for x in (glob.glob(str(pat)) or [str(pat)])]
        a.out.write_text(report.render(dirs))
        print(f"report: {a.out}")
        return 0
    if a.cmd == "evidence":
        dirs = [Path(x) for pat in a.runs for x in (glob.glob(str(pat)) or [str(pat)])]
        rows = evidence.collect(dirs)
        a.out.write_text(evidence.render(rows, a.focus))
        lost = len(evidence.missing(rows))
        print(f"evidence: {a.out} ({len(rows)} runs, {lost} without a transcript)")
        return 1 if a.strict and lost else 0
    print(probe(load_toml(BENCH / "arms.toml"), load_toml(BENCH / "capabilities.toml")))
    return 0


if __name__ == "__main__":
    sys.exit(main())

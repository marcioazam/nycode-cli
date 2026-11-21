#!/usr/bin/env python3
"""Fault-robustness eval (layer 2): each arm against the fault-injecting fake API, one scenario per run, no cost.

``python3 bench/faults/run.py --arms ny-pi,pi-vanilla,claude-vanilla [--scenarios a,b] [--json out.json]``.
Exit 0 = every run measured (failures are results, not errors); 2 = environment or arguments unusable.
"""

from __future__ import annotations

import argparse
import json
import os
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import TYPE_CHECKING

import classify as cl
import injector as inj

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "contract"))
import check  # type: ignore[import-not-found]  # sibling dir, path set above

__all__ = [
    "ARMS",
    "arm_command",
    "check",
    "main",
    "models_json",
    "run_one",
    "run_process",
    "table",
]

if TYPE_CHECKING:
    from collections.abc import Mapping, Sequence

ARMS = ("ny-pi", "nycode", "pi-vanilla", "claude-vanilla")
PROMPT = "Read probe.txt with your read tool, then reply with the text you receive. contract-case:{scenario}"


def models_json(port: int) -> str:
    """pi provider override that points anthropic at the fake server."""
    return json.dumps(
        {"providers": {"anthropic": {"baseUrl": f"http://127.0.0.1:{port}"}}}
    )


def arm_command(
    arm: str, scenario: str, port: int, scratch: Path, env: Mapping[str, str]
) -> tuple[list[str], dict[str, str]]:
    """Command line and environment that make ``arm`` talk to the fake server on ``port``."""
    exe = str(check.ARMS_DIR / arm)
    prompt = PROMPT.format(scenario=scenario)
    # BENCH_STAGE: a stage the caller built (same rule as bench/contract/check.py), reused by every scenario
    stage = check.given_stage(env) or scratch / "stage"
    clean = check.clean_env(env, stage, arm)
    if arm == "claude-vanilla":
        return [exe, "-p", prompt], {
            **clean,
            "ANTHROPIC_BASE_URL": f"http://127.0.0.1:{port}",
        }
    if arm == "pi-vanilla":
        home = scratch / "vanilla"
        home.mkdir(exist_ok=True)
        (home / "models.json").write_text(models_json(port), encoding="utf-8")
        return [exe, "--no-session", "-p", prompt], {
            **clean,
            "BENCH_PI_VANILLA_DIR": str(home),
        }
    agent = check.prepare_stage(Path(exe), stage, clean)
    (agent / "models.json").write_text(models_json(port), encoding="utf-8")
    return [exe, "--no-session", "-p", prompt], clean


def run_process(
    cmd: Sequence[str], cwd: Path, env: Mapping[str, str], timeout: float
) -> tuple[int | None, str, str, bool]:
    """Run to completion or kill the whole process group at ``timeout``: ``(rc, stdout, stderr, timed_out)``."""
    proc = subprocess.Popen(
        list(cmd),
        cwd=cwd,
        env=dict(env),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        start_new_session=True,
    )
    try:
        out, err = proc.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        os.killpg(proc.pid, signal.SIGKILL)
        out, err = proc.communicate()
        return None, out or "", err or "", True
    return proc.returncode, out, err, False


def run_one(
    arm: str, scenario: str, timeout: float, environ: Mapping[str, str]
) -> cl.Outcome:
    """One (arm, scenario) run on a fresh server and scratch directory."""
    with tempfile.TemporaryDirectory(prefix="faults-") as tmp, inj.FaultApi() as api:
        scratch = Path(tmp)
        work = scratch / "work"
        work.mkdir()
        (work / "probe.txt").write_text("probe-text\n", encoding="utf-8")
        try:
            cmd, env = arm_command(arm, scenario, api.port, scratch, environ)
        except check.EnvError as exc:
            return cl.Outcome(
                arm, scenario, cl.FAILED, None, 0, 0.0, f"ambiente: {exc}"
            )
        started = time.monotonic()
        rc, out, err, hung = run_process(cmd, work, env, timeout)
        seconds = time.monotonic() - started
        status = cl.classify(rc, out, inj.FINAL, timed_out=hung)
        note = (err.strip() or out.strip())[-160:].replace("\n", " ")
        return cl.Outcome(
            arm, scenario, status, rc, api.count(scenario), round(seconds, 1), note
        )


def table(outcomes: Sequence[cl.Outcome]) -> str:
    """Markdown table of the runs."""
    rows = [
        "| braço | cenário | status | exit | reqs | s | nota |",
        "|---|---|---|---|---|---|---|",
    ]
    rows += [
        f"| {o.arm} | {o.scenario} | {o.status} | {o.rc} | {o.requests} | {o.seconds} | {o.note.replace('|', '/')[:80]} |"
        for o in outcomes
    ]
    return "\n".join(rows)


def main(argv: Sequence[str] | None = None) -> int:
    """CLI entry point."""
    parser = argparse.ArgumentParser(
        description="Eval de robustez a falhas (sem modelo, sem custo)."
    )
    parser.add_argument("--arms", default=",".join(ARMS))
    parser.add_argument("--scenarios", default=",".join(inj.SCENARIOS))
    parser.add_argument("--timeout", type=float, default=cl.TIMEOUT_S)
    parser.add_argument("--json", type=Path)
    args = parser.parse_args(argv)
    arms, scenarios = args.arms.split(","), args.scenarios.split(",")
    bad = [a for a in arms if a not in ARMS] + [
        s for s in scenarios if s not in inj.SCENARIOS
    ]
    if bad:
        print(f"desconhecido: {', '.join(bad)}", file=sys.stderr)
        return 2
    outcomes = [
        run_one(a, s, args.timeout, os.environ) for a in arms for s in scenarios
    ]
    print(table(outcomes))
    if args.json:
        args.json.write_text(
            json.dumps([o.as_dict() for o in outcomes], ensure_ascii=False, indent=2)
            + "\n",
            encoding="utf-8",
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Local overhead meter (no model, no network, zero cost): how long a harness takes around a scripted chat.

Runs each arm's ``pi -p`` against ``fake_api.FakeApi`` (answers instantly) on a fixed 3-turn script (``bash``,
``read``, final text) and measures with a monotonic clock what is the harness's own time: start of process to
first request (``boot_s``), tool plus harness between turns (``turn_gap_s``), last answer to process exit
(``exit_s``), ``total_s`` and the size of the first request. Arms are interleaved per repetition so machine
drift hits all of them alike. Exit 0 = measured, 2 = environment unavailable. See README.md.
"""

from __future__ import annotations

import argparse
import itertools
import json
import math
import os
import shutil
import statistics
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

import check
from check import EnvError
from fake_api import FakeApi, Hit, Step

if TYPE_CHECKING:
    from collections.abc import Sequence

CASE = "speed"
PROMPT = f"contract-case:{CASE} responda com a cadeia de ferramentas do roteiro"
METRICS = (
    "boot_s",
    "turn_gap_s",
    "exit_s",
    "total_s",
    "first_request_bytes",
    "first_request_tokens_est",
)
RATIOS = ("boot_s", "turn_gap_s", "total_s")
MIN_HITS = 3
TIMEOUT_S = 180
BYTES_PER_TOKEN = 4
# The arms read a token from BENCH_CC_CREDENTIALS; this one only ever reaches 127.0.0.1 (no real secret).
FAKE_CREDENTIALS = {
    "claudeAiOauth": {
        "accessToken": "sk-ant-oat01-speed",
        "expiresAt": 4_000_000_000_000,
    }
}


@dataclass(frozen=True)
class ArmSpec:
    """How an arm is driven: pi arms use a stage (``<stage>/.pi/agent``), Claude Code a base-url variable."""

    staged: bool = True
    read_tool: str = "read"
    bash_tool: str = "bash"
    path_key: str = "path"
    args: tuple[str, ...] = ("--no-session", "-p")


SPECS = {
    "claude-vanilla": ArmSpec(
        staged=False,
        read_tool="Read",
        bash_tool="Bash",
        path_key="file_path",
        args=("--permission-mode", "bypassPermissions", "-p"),
    )
}


def median(values: Sequence[float]) -> float:
    """Median of a non-empty sequence."""
    return statistics.median(values)


def p90(values: Sequence[float]) -> float:
    """Nearest-rank 90th percentile of a non-empty sequence."""
    ordered = sorted(values)
    return ordered[min(len(ordered), math.ceil(0.9 * len(ordered))) - 1]


def paired_ratio(a: Sequence[float], b: Sequence[float]) -> float:
    """Median of the per-repetition ratios ``a[i] / b[i]`` (repetitions with ``b <= 0`` are skipped)."""
    return median([x / y for x, y in zip(a, b, strict=True) if y > 0])


def schedule(arms: Sequence[str], reps: int) -> list[tuple[str, int]]:
    """Run order: repetition by repetition, arms alternating inside each one."""
    return [(arm, rep) for rep in range(reps) for arm in arms]


def metrics(t0: float, hits: Sequence[Hit], t_exit: float) -> dict[str, float]:
    """Metrics of one run from its start ``t0``, the server's hits and the exit time (one monotonic clock)."""
    routed = [h for h in hits if h.case == CASE]
    if len(routed) < MIN_HITS:
        raise EnvError(
            f"só {len(routed)} pedidos do roteiro chegaram (esperados {MIN_HITS})"
        )
    if any(h.done == 0.0 for h in routed):
        raise EnvError("pedido do roteiro sem fim de resposta registrado")
    gaps = [nxt.arrived - prev.done for prev, nxt in itertools.pairwise(routed)]
    return {
        "boot_s": routed[0].arrived - t0,
        "turn_gap_s": median(gaps),
        "exit_s": t_exit - routed[-1].done,
        "total_s": t_exit - t0,
        "first_request_bytes": routed[0].size,
        "first_request_tokens_est": routed[0].size / BYTES_PER_TOKEN,
    }


def scripts(work: Path, spec: ArmSpec) -> dict[str, list[Step]]:
    """The fixed 3-turn script: ``echo ok``, read a small file of the work directory, final text."""
    return {
        CASE: [
            Step(tool_name=spec.bash_tool, tool_input={"command": "echo ok"}),
            Step(
                tool_name=spec.read_tool,
                tool_input={spec.path_key: str(work / "probe.txt")},
            ),
            Step("fim"),
        ]
    }


@dataclass
class Prepared:
    """An arm ready to run: its environment and what to delete afterwards (cold runs)."""

    arm: Path
    spec: ArmSpec
    env: dict[str, str]
    trash: tuple[Path, ...] = ()


def prepare(name: str, root: Path, tag: str, port: int, creds: Path) -> Prepared:
    """Build the stage and cache directory of one arm; the provider is redirected to the fake server."""
    arm = check.ARMS_DIR / name
    spec = SPECS.get(name, ArmSpec())
    stage, cache = root / f"stage-{name}-{tag}", root / f"tmp-{name}-{tag}"
    cache.mkdir(parents=True)
    env = {
        **check.clean_env(os.environ, stage, name),
        "BENCH_PI_VANILLA_DIR": str(stage / ".pi" / "agent"),
        "BENCH_CC_CREDENTIALS": str(creds),
        "TMPDIR": str(cache),  # jiti keeps its transpile cache in $TMPDIR/jiti
    }
    base = f"http://127.0.0.1:{port}"
    if spec.staged:
        agent = check.prepare_stage(arm, stage, env)
        redirect = {"providers": {"anthropic": {"baseUrl": base}}}
        (agent / "models.json").write_text(json.dumps(redirect), encoding="utf-8")
    elif not arm.is_file():
        raise EnvError(f"braço inexistente: {name}")
    else:
        env["ANTHROPIC_BASE_URL"] = base
    return Prepared(arm, spec, env, (stage, cache))


def run_once(prep: Prepared, api: FakeApi, work: Path) -> dict[str, float]:
    """One timed ``pi -p``; returns its metrics or raises ``EnvError`` when the process or the script failed."""
    first = len(api.hits)
    t0 = time.monotonic()
    try:
        done = check.run_arm(
            prep.arm, [*prep.spec.args, PROMPT], work, prep.env, TIMEOUT_S
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise EnvError(
            f"{prep.arm.name}: o braço não executou: {type(exc).__name__}"
        ) from exc
    t_exit = time.monotonic()
    if done.returncode != 0:
        tail = done.stderr.strip()[-300:]
        raise EnvError(f"{prep.arm.name}: pi falhou (exit {done.returncode}): {tail}")
    return metrics(t0, api.hits[first:], t_exit)


def summarize(
    runs: dict[str, list[dict[str, float]]],
) -> dict[str, dict[str, dict[str, float]]]:
    """Median and p90 of every metric of every arm."""
    return {
        arm: {
            m: {"median": median(v := [r[m] for r in rows]), "p90": p90(v)}
            for m in METRICS
        }
        for arm, rows in runs.items()
    }


def ratios(
    runs: dict[str, list[dict[str, float]]], arms: Sequence[str]
) -> dict[str, dict[str, float]]:
    """Paired ratio (median of per-repetition ratios) of the first arm over each other arm."""
    return {
        other: {
            m: paired_ratio([r[m] for r in runs[arms[0]]], [r[m] for r in runs[other]])
            for m in RATIOS
        }
        for other in arms[1:]
    }


def render(
    summary: dict[str, dict[str, dict[str, float]]],
    pairs: dict[str, dict[str, float]],
    first: str,
) -> str:
    """Text table: one row per arm and metric, then the paired ratios."""
    lines = [f"{'braço':<12} {'métrica':<26} {'mediana':>10} {'p90':>10}"]
    for arm, per_metric in summary.items():
        lines += [
            f"{arm:<12} {m:<26} {v['median']:>10.3f} {v['p90']:>10.3f}"
            for m, v in per_metric.items()
        ]
    for other, ratio in pairs.items():
        lines += [
            f"razão pareada {first}/{other}  {m}: {r:.2f}" for m, r in ratio.items()
        ]
    return "\n".join(lines)


def measure(
    arms: Sequence[str], reps: int, cold: bool, root: Path
) -> dict[str, list[dict[str, float]]]:
    """Run the interleaved schedule (hot: one unreported warm-up round first) and collect the runs."""
    work = root / "work"
    work.mkdir()
    (work / "probe.txt").write_text("contract-probe\n", encoding="utf-8")
    creds = root / "credentials.json"
    creds.write_text(json.dumps(FAKE_CREDENTIALS), encoding="utf-8")
    runs: dict[str, list[dict[str, float]]] = {arm: [] for arm in arms}
    api_scripts: dict[str, list[Step]] = {}
    for arm in arms:  # fail on a missing arm before any run
        if not (check.ARMS_DIR / arm).is_file():
            raise EnvError(f"braço inexistente: {arm}")
        api_scripts.update(scripts(work, SPECS.get(arm, ArmSpec())))
    with FakeApi(api_scripts) as api:
        ready: dict[str, Prepared] = {}
        for arm, rep in schedule(arms, reps + (0 if cold else 1)):
            tag = f"{rep}" if cold else "hot"
            prep = (
                prepare(arm, root, tag, api.port, creds)
                if cold or arm not in ready
                else ready[arm]
            )
            ready[arm] = prep
            try:
                got = run_once(prep, api, work)
            finally:
                if cold:
                    for path in prep.trash:
                        shutil.rmtree(path, ignore_errors=True)
            if cold or rep > 0:
                runs[arm].append(got)
    return runs


def main(argv: Sequence[str] | None = None) -> int:
    """CLI entry point; returns the process exit code."""
    parser = argparse.ArgumentParser(
        description="Sobrecarga local do harness, sem modelo."
    )
    parser.add_argument(
        "--arms",
        required=True,
        help="braços separados por vírgula (ex.: ny-pi,pi-vanilla)",
    )
    parser.add_argument(
        "--reps", type=int, default=7, help="repetições por braço (padrão 7)"
    )
    parser.add_argument(
        "--json", type=Path, help="grava execuções, resumo e razões neste arquivo"
    )
    parser.add_argument(
        "--cold",
        action="store_true",
        help="stage novo e cache de transpilação vazio a cada execução",
    )
    args = parser.parse_args(argv)
    arms = [a for a in args.arms.split(",") if a]
    if not arms or args.reps < 1:
        print("ambiente indisponível: --arms vazio ou --reps < 1", file=sys.stderr)
        return 2
    with tempfile.TemporaryDirectory(prefix="speed-") as tmp:
        try:
            runs = measure(arms, args.reps, args.cold, Path(tmp))
        except EnvError as exc:
            print(f"ambiente indisponível: {exc}", file=sys.stderr)
            return 2
    summary, pairs = summarize(runs), ratios(runs, arms)
    print(render(summary, pairs, arms[0]))
    if args.json:
        report = {
            "cold": args.cold,
            "reps": args.reps,
            "runs": runs,
            "summary": summary,
            "ratio": pairs,
        }
        args.json.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())

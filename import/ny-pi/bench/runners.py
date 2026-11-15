"""Suite adapters of the bench orchestrator: S1 (internal evals), S2/S3 (Harbor), S4/S5 (case runner).

Every adapter returns runs in the common format
{suite, task_id, rep, passed, cost_usd, wall_s, security, split, subagents_used, error} plus the optional
per-run records of METRICS (None when the transcript does not carry them; rounds before them lack the keys).
No adapter logs or writes the OAuth token: callers put it in `env` and it stays in the process environment.
"""

import hashlib
import json
import os
import random
import re
import shutil
import subprocess
import tempfile
import time
from collections.abc import Callable, Collection, Iterable
from pathlib import Path
from typing import Any

Run = dict[str, Any]

HOME = Path.home()
EVALS_RUN = Path(os.environ.get("BENCH_EVALS_RUN", HOME / ".claude/evals/run.py"))
PELO_RUN_PI = Path(
    os.environ.get(
        "BENCH_PELO_RUN_PI",
        HOME / ".pi/agent/claude-home/skills/pelo-em-ovo/scripts/run_pi.py",
    )
)
HARBOR_VERSION = "0.25.0"
# S1 of the record: run_pi.py stops the round when the live harness changes; staged arms see this as noise.
DRIFT_MARK = "harness changed"
SUBAGENT_NAMES = {"Task", "Agent", "subagent"}
# A run that reached the model always has cost > 0; none means auth, quota (429), disk or sandbox died first.
INFRA_ERR = "infra: no model spend"
RATE_LIMIT_ERR = "infra: provider rate limit (429)"
_RATE_LIMIT = re.compile(
    r"rate_limit_error|rate limit|quota exceeded \(account usage limit", re.IGNORECASE
)
INFRA_STREAK = (
    5  # consecutive infra runs that stop a stage instead of burning the queue
)
# tokens {input, output, cache_read, cache_write}; turns = assistant messages; tool_errors = failed tool results;
# first_request_tokens = input + cache_read + cache_write of the first assistant response (the fixed context).
METRICS = ("tokens", "turns", "tool_errors", "first_request_tokens")
# our key -> (pi/omp usage key, Claude Code usage key)
_USAGE = {
    "input": ("input", "input_tokens"),
    "output": ("output", "output_tokens"),
    "cache_read": ("cacheRead", "cache_read_input_tokens"),
    "cache_write": ("cacheWrite", "cache_creation_input_tokens"),
}


def make_run(suite: str, task_id: str, rep: int, passed: bool, **kw: Any) -> Run:
    err = kw.get("error")
    if not err and not passed and not kw.get("cost_usd"):
        err = INFRA_ERR
    return {
        "suite": suite,
        "task_id": task_id,
        "rep": rep,
        "passed": bool(passed),
        "cost_usd": kw.get("cost_usd"),
        "wall_s": kw.get("wall_s"),
        "security": bool(kw.get("security", False)),
        "split": kw.get("split", "dev"),
        "subagents_used": bool(kw.get("subagents_used", False)),
        "error": err,
        **{k: kw.get(k) for k in METRICS},
    }


def is_infra(r: Run) -> bool:
    e = str(r.get("error") or "")
    if not e or e == "refusal":
        return False
    return e.startswith(("infra", "harbor exit")) or not r.get("cost_usd")


def infra_streak(runs: Iterable[Run]) -> int:
    """Length of the trailing run of infra failures."""
    n = 0
    for r in reversed(list(runs)):
        if not is_infra(r):
            break
        n += 1
    return n


def run_cost(runs: Iterable[Run]) -> float:
    return sum(r.get("cost_usd") or 0.0 for r in runs)


# --------------------------------------------------------------------------------------------- S1


def parse_s1_runs(path: Path) -> list[Run]:
    """runs.jsonl of ~/.claude/evals/run.py or run_pi.py -> common format."""
    out: list[Run] = []
    for line in path.read_text().splitlines():
        if not line.strip():
            continue
        r = json.loads(line)
        score = r.get("score") or {}
        result = (r.get("trace") or {}).get("result") or {}
        out.append(
            make_run(
                "s1",
                r["case_id"],
                int(r.get("rep", 0)),
                bool(score.get("passed")),
                cost_usd=result.get("cost_usd"),
                wall_s=r.get("wall_s"),
                security=r.get("suite") == "security",
                split=r.get("split", "dev"),
                subagents_used=bool(score.get("delegated")),
                error=r.get("error"),
                turns=result.get("turns"),
                tokens=result.get("tokens"),
            )
        )
    return out


def _results_dir(text: str) -> Path | None:
    m = re.findall(r"^results: (\S+)", text, re.MULTILINE)
    return Path(m[-1]) if m else None


def run_s1(
    kind: str,
    arm_bin: Path,
    cases: list[str],
    k: int,
    model: str,
    budget_usd: float,
    label: str,
    env: dict[str, str],
    jobs: int = 2,
) -> tuple[list[Run], str | None]:
    """Run S1. Returns (runs, error). A drift abort is retried once with --resume, never counted as pass."""
    script = EVALS_RUN if kind == "cc" else PELO_RUN_PI
    penv = {**os.environ, **env}
    cmd = ["python3", str(script)]
    if kind == "cc":
        cmd += ["--claude-bin", str(arm_bin)]
    else:
        penv["PELO_PI_BIN"] = str(arm_bin)
    cmd += [
        "--suite", "all", "--cases", ",".join(cases), "--k", str(k), "--jobs", str(jobs),
        "--model", model, "--budget-usd", f"{budget_usd:.4f}", "--label", label,
    ]  # fmt: skip
    # argv list, no shell: the values are our own config (arm path, case ids, model), not untrusted input.
    p = subprocess.run(cmd, env=penv, capture_output=True, text=True, check=False)  # nosemgrep  # fmt: skip
    text = p.stdout + p.stderr
    rdir = _results_dir(text)
    drift = DRIFT_MARK in text and "stopping" in text
    if (
        drift and rdir
    ):  # infrastructure noise (staged arm): one automatic resume, never a pass
        # same argv list as above plus the run's own results dir
        resume = [*cmd, "--resume", str(rdir)]
        p = subprocess.run(resume, env=penv, capture_output=True, text=True, check=False)  # nosemgrep  # fmt: skip
        text = p.stdout + p.stderr
        rdir = _results_dir(text) or rdir
        if DRIFT_MARK in text and "stopping" in text:
            return _read_s1(rdir), "infra: harness drift abort persisted after resume"
    elif drift:
        return [], "infra: harness drift abort without results dir"
    if rdir is None:
        return [], f"infra: no results dir (exit {p.returncode})"
    return _read_s1(rdir), None if p.returncode == 0 else f"exit {p.returncode}"


def s1_case_reps(cases: list[str], k: int) -> dict[str, int]:
    """Reps each S1 case actually runs: min(k, its declared `reps`), as run.py does (both arms share its cases)."""
    declared: dict[str, int] = {}
    for f in sorted((EVALS_RUN.parent / "cases").glob("*.jsonl")):
        for line in f.read_text().splitlines():
            if line.strip():
                c = json.loads(line)
                if "reps" in c:
                    declared[c["id"]] = int(c["reps"])
    return {c: min(k, declared.get(c, k)) for c in cases}


def _read_s1(rdir: Path | None) -> list[Run]:
    f = rdir / "runs.jsonl" if rdir else None
    return parse_s1_runs(f) if f and f.exists() else []


# ------------------------------------------------------------------------------------------ Harbor


def split_of(
    name: str, seed: int, heldout_pct: int, heldout: Collection[str] | None = None
) -> str:
    """Held-out list from the task file is the authority (D14); sha256 only without one."""
    if heldout is not None:
        return "heldout" if name in heldout else "dev"
    h = int(hashlib.sha256(f"{seed}:{name}".encode()).hexdigest(), 16) % 100
    return "heldout" if h < heldout_pct else "dev"


def load_excluded(path: Path | None) -> dict[str, str]:
    """name -> reason; accepts a list of names, a list of {id|task|name, reason} or a dict."""
    if not path or not path.exists():
        return {}
    d = json.loads(path.read_text())
    if isinstance(d, dict):
        return {str(k): str(v) for k, v in d.items()}
    out: dict[str, str] = {}
    for e in d:
        if isinstance(e, str):
            out[e] = ""
        else:
            name = e.get("id") or e.get("task") or e.get("name")
            out[str(name)] = str(e.get("reason", ""))
    return out


def load_tasks(path: Path) -> tuple[list[str], list[str] | None]:
    """(tasks, heldout): a {"tasks", "heldout"} dict or a plain list (heldout None)."""
    d = json.loads(path.read_text())
    if isinstance(d, dict):
        held = d.get("heldout")
        return [str(t) for t in d["tasks"]], None if held is None else [
            str(t) for t in held
        ]
    return [str(t) for t in d], None


def sample_tasks(
    names: list[str],
    excluded: dict[str, str],
    n: int | None,
    seed: int,
    heldout_pct: int,
    splits: list[str] | None = None,
    heldout: Collection[str] | None = None,
) -> list[str]:
    pool = [t for t in sorted(names) if t not in excluded]
    if splits:
        pool = [t for t in pool if split_of(t, seed, heldout_pct, heldout) in splits]
    random.Random(seed).shuffle(pool)
    return sorted(pool[:n] if n else pool)


def harbor_bin() -> list[str]:
    env = os.environ.get("BENCH_HARBOR")
    if env:
        return [env]
    return (
        ["harbor"]
        if shutil.which("harbor")
        else ["uvx", "--from", f"harbor=={HARBOR_VERSION}", "harbor"]
    )


def harbor_agent(
    arm: str, model: str, harbor_dir: Path
) -> tuple[list[str], dict[str, str], str]:
    """(agent flags, extra env, token env var name) for an arm; the token itself is added by the caller."""
    m = f"anthropic/{model}"
    if arm == "cc-vanilla":
        return (
            ["-a", "claude-code", "-m", m],
            {"CLAUDE_FORCE_OAUTH": "1"},
            "CLAUDE_CODE_OAUTH_TOKEN",
        )
    if arm == "pi-vanilla":
        return (
            ["-a", "pi", "--ak", "version=1.5.2", "-m", m],
            {},
            "ANTHROPIC_OAUTH_TOKEN",
        )
    if (
        arm == "omp"
    ):  # reviewed release binary (omp-release.sh); medium = pi's default thinking
        return (
            ["-a", "omp_agent:OmpAgent", "--ak", "thinking=medium", "-m", m],
            {"PYTHONPATH": str(harbor_dir)},
            "ANTHROPIC_OAUTH_TOKEN",
        )
    # ny-pi: custom agent shipped in claude-home/bin/evals/harbor (bundle.sh builds the bundle first)
    return (
        ["-a", "pi_harness_agent:PiHarnessAgent", "-m", m],
        {"PYTHONPATH": str(harbor_dir)},
        "ANTHROPIC_OAUTH_TOKEN",
    )


def harbor_cmd(
    dataset: str,
    agent_args: list[str],
    job: str,
    out: Path,
    tasks: list[str] | None = None,
    limit: int | None = None,
    exclude: Iterable[str] = (),
    k: int = 1,
    concurrent: int = 4,
    timeout_mult: float | None = None,
) -> list[str]:
    cmd = [
        *harbor_bin(),
        "run",
        "-d",
        dataset,
        *agent_args,
        "-n",
        str(concurrent),
        "-k",
        str(k),
    ]
    if (
        timeout_mult
    ):  # TB 4.1 tasks allow 8 h each; the suite caps them (wall and spend)
        cmd += ["--agent-timeout-multiplier", str(timeout_mult)]
    cmd += ["--job-name", job, "-o", str(out)]
    for t in tasks or []:
        cmd += ["-i", t]
    if not tasks:
        for t in sorted(exclude):
            cmd += ["-x", t]
        if limit:
            cmd += ["-l", str(limit)]
    return cmd


def _secs(a: str | None, b: str | None) -> float | None:
    from datetime import datetime

    if not a or not b:
        return None
    f = datetime.fromisoformat
    return round(
        (f(b.replace("Z", "+00:00")) - f(a.replace("Z", "+00:00"))).total_seconds(), 2
    )


def parse_harbor_job(
    job_dir: Path, suite: str, splits: dict[str, str] | None = None
) -> list[Run]:
    """Trial result.json files of one Harbor job -> common format. Provider refusals get error='refusal'."""
    trials: list[tuple[str, str, dict[str, Any]]] = []
    for f in sorted(job_dir.glob("*/result.json")):
        d = json.loads(f.read_text())
        if "task_name" in d:
            trials.append((d["task_name"], d.get("started_at") or "", d))
    reps: dict[str, int] = {}
    out: list[Run] = []
    for name, _, d in sorted(trials, key=lambda t: (t[0], t[1])):
        rep = reps.get(name, 0)
        reps[name] = rep + 1
        rewards = (d.get("verifier_result") or {}).get("rewards") or {}
        reward = rewards.get("reward")
        exc = d.get("exception_info")
        err = None
        if exc:
            err = (
                "refusal" if "safeguard" in json.dumps(exc).lower() else str(exc)[:200]
            )
        ex = d.get("agent_execution") or {}
        out.append(
            make_run(
                suite,
                name,
                rep,
                reward is not None and float(reward) >= 1.0,
                cost_usd=(d.get("agent_result") or {}).get("cost_usd"),
                wall_s=_secs(ex.get("started_at"), ex.get("finished_at"))
                or _secs(d.get("started_at"), d.get("finished_at")),
                split=(splits or {}).get(name, "dev"),
                error=err,
            )
        )
    return out


def run_harbor(
    cmd_base: list[str],
    job_root: Path,
    suite: str,
    env: dict[str, str],
    chunks: list[list[str]],
    budget_usd: float,
    make_cmd: Any,
    splits: dict[str, str] | None = None,
    sink: Callable[[list[Run]], None] | None = None,
) -> tuple[list[Run], bool]:
    """Run chunks of tasks one `harbor run` each, stop when the budget is gone. Returns (runs, exhausted).
    `sink` gets each chunk's runs as soon as it ends, so a killed round keeps what it finished."""
    runs: list[Run] = []
    penv = {**os.environ, **env}
    for i, chunk in enumerate(chunks):
        if run_cost(runs) >= budget_usd:
            return runs, True
        job, n = f"{suite}-{i}", 0
        while (
            job_root / job
        ).exists():  # an existing job name makes harbor replay old trials (resume)
            n += 1
            job = f"{suite}-{i}-r{n}"
        p = subprocess.run(
            make_cmd(chunk, job), env=penv, capture_output=True, text=True, check=False
        )
        got = parse_harbor_job(job_root / job, suite, splits)
        if not got:
            got = [
                make_run(suite, t, 0, False, error=f"harbor exit {p.returncode}")
                for t in chunk
            ]
        runs += got
        if sink:
            sink(got)
        if infra_streak(runs) >= INFRA_STREAK:
            return (
                runs,
                True,
            )  # quota/disk/auth is down: stop, never burn the whole queue
    return runs, run_cost(runs) >= budget_usd


# ------------------------------------------------------------------------------------ S4/S5 cases


def load_cases(
    suite_dir: Path, splits: list[str] | None = None
) -> list[dict[str, Any]]:
    cases = [
        json.loads(f.read_text()) | {"_dir": str(f.parent)}
        for f in sorted(suite_dir.glob("*/case.json"))
    ]
    return [c for c in cases if not splits or c.get("split", "dev") in splits]


def _walk(o: Any) -> Iterable[Any]:
    yield o
    if isinstance(o, dict):
        for v in o.values():
            yield from _walk(v)
    elif isinstance(o, list):
        for v in o:
            yield from _walk(v)


def _text_of(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            b.get("text", "")
            for b in content
            if isinstance(b, dict) and b.get("type") == "text"
        )
    return ""


def _usage(u: Any, kind: str) -> dict[str, int] | None:
    i = 1 if kind == "cc" else 0
    if not isinstance(u, dict) or not any(names[i] in u for names in _USAGE.values()):
        return None  # a usage block with the cost only carries no token record
    return {k: int(u.get(names[i]) or 0) for k, names in _USAGE.items()}


def parse_events(text: str, kind: str) -> dict[str, Any]:
    """cost, final text, subagent use, error and the METRICS from a headless cc (stream-json) or pi/omp (json)
    transcript."""
    events: list[Any] = []
    for line in text.splitlines():
        try:
            events.append(json.loads(line))
        except ValueError:
            continue
    if not events:
        try:
            events = [json.loads(text)]
        except ValueError:
            pass
    cost, final, err = 0.0, "", None
    sub = False
    used: list[dict[str, int]] = []  # usage of each assistant message, in order
    total: dict[str, int] | None = None  # cc: the cumulative usage of the result event
    seen: set[str] = set()  # cc repeats an assistant message once per content block
    turns = tool_errors = 0
    for ev in events:
        if not isinstance(ev, dict):
            continue
        for node in _walk(ev):
            if not isinstance(node, dict):
                continue
            is_call = node.get("type") in ("tool_use", "toolCall") or node.get(
                "toolName"
            )
            if is_call and (node.get("name") or node.get("toolName")) in SUBAGENT_NAMES:
                sub = True
        if kind == "cc" and ev.get("type") in ("assistant", "user"):
            msg = ev.get("message") or {}
            if ev["type"] == "user":
                content = msg.get("content")
                tool_errors += sum(
                    1 for b in (content if isinstance(content, list) else [])
                    if isinstance(b, dict) and b.get("type") == "tool_result" and b.get("is_error")
                )  # fmt: skip
            elif (mid := str(msg.get("id") or len(seen))) not in seen:
                seen.add(mid)
                turns += 1
                if u := _usage(msg.get("usage"), kind):
                    used.append(u)
        if kind == "cc" and ev.get("type") == "result":
            total = _usage(ev.get("usage"), kind)
            cost = float(ev.get("total_cost_usd") or 0.0)
            final = str(ev.get("result") or "")
            if ev.get("is_error"):
                err = str(ev.get("subtype") or "error")
        if kind == "pi" and ev.get("type") == "message_end":
            msg = ev.get("message") or {}
            if msg.get("role") == "toolResult" and msg.get("isError"):
                tool_errors += 1
            if msg.get("role") == "assistant":
                turns += 1
                if u := _usage(msg.get("usage"), kind):
                    used.append(u)
                cost += float(
                    ((msg.get("usage") or {}).get("cost") or {}).get("total") or 0.0
                )
                final = _text_of(msg.get("content")) or final
                if msg.get("stopReason") == "error":
                    err = str(msg.get("errorMessage") or "provider error")[:200]
                    if _RATE_LIMIT.search(str(msg.get("errorMessage"))):
                        err = RATE_LIMIT_ERR  # pi in -p waited for the reset until the timeout (gate #28)
                elif err == RATE_LIMIT_ERR:
                    err = None  # a later good reply: the limit passed
    if not events:
        err = "no events"
    first = used[0] if used else None
    return {
        "cost": cost, "final": final, "subagents": sub, "error": err,
        "tokens": total or ({k: sum(u[k] for u in used) for k in _USAGE} if used else None),
        "turns": turns or None,
        "tool_errors": tool_errors if turns else None,
        "first_request_tokens": first and first["input"] + first["cache_read"] + first["cache_write"],
    }  # fmt: skip


def arm_cmd(
    kind: str, arm_bin: Path, model: str, prompt: str, budget: float
) -> list[str]:
    if kind == "cc":
        return [str(arm_bin), "-p", "--output-format", "stream-json", "--verbose", "--model", model,
                "--max-budget-usd", f"{budget:.4f}", prompt]  # fmt: skip
    return [
        str(arm_bin),
        "-p",
        "--mode",
        "json",
        "--no-session",
        "--model",
        model,
        "--",
        prompt,
    ]


def _git(wd: Path, *a: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", "-C", str(wd), "-c", "user.email=bench@local", "-c", "user.name=bench", *a],
        capture_output=True, text=True, check=False)  # fmt: skip


def _save(d: Path | None, name: str, text: str) -> None:
    """Keep agent/test output per run for audit (agent stdout carries no token)."""
    if d is not None:
        d.mkdir(parents=True, exist_ok=True)
        (d / name).write_text(text)


def run_case(
    case: dict[str, Any],
    suite: str,
    rep: int,
    kind: str,
    arm_bin: Path,
    model: str,
    env: dict[str, str],
    budget_usd: float | None = None,
    artifacts: Path | None = None,
) -> Run:
    cdir = Path(case["_dir"])
    wd = Path(tempfile.mkdtemp(prefix=f"bench-{case['id']}-"))
    base = {
        "security": bool(case.get("security")),
        "split": case.get("split", "dev"),
    }
    try:
        if (cdir / "repo").is_dir():
            shutil.copytree(cdir / "repo", wd, dirs_exist_ok=True)
        _git(wd, "init", "-q")
        _git(wd, "add", "-A")
        _git(wd, "commit", "-q", "--allow-empty", "-m", "base")
        cap = (
            min(case.get("budget_usd", 1.0), budget_usd)
            if budget_usd is not None
            else case.get("budget_usd", 1.0)
        )
        cmd = arm_cmd(kind, arm_bin, model, case["prompt"], cap)
        t0 = time.monotonic()
        try:
            p = subprocess.run(
                cmd, cwd=wd, env={**os.environ, **env}, capture_output=True, text=True,
                timeout=case.get("timeout_s", 600), check=False)  # fmt: skip
            out, rc, stderr = p.stdout, p.returncode, p.stderr
        except subprocess.TimeoutExpired as e:
            raw = e.stdout or b""
            out, rc, stderr = (
                (raw if isinstance(raw, str) else raw.decode(errors="replace")),
                None,
                "",
            )
        wall = round(time.monotonic() - t0, 2)
        stem = f"{suite}-{case['id']}-{rep}"
        _save(artifacts, f"{stem}.agent.out", out)
        if stderr:
            _save(artifacts, f"{stem}.agent.err", stderr)
        status = _git(wd, "status", "--porcelain").stdout
        _git(wd, "add", "-A")  # what the agent left behind, untracked files included
        _save(artifacts, f"{stem}.diff", _git(wd, "diff", "--cached", "HEAD").stdout)
        _git(wd, "reset", "-q")
        ev = parse_events(out, kind)
        common = base | {
            "cost_usd": ev["cost"],
            "wall_s": wall,
            "subagents_used": ev["subagents"],
            **{k: ev[k] for k in METRICS},
        }
        why: dict[str, Any] = {"exit_code": rc, "final": ev["final"]}

        def done(passed: bool, err: str | None) -> Run:
            r = make_run(suite, case["id"], rep, passed, error=err, **common)
            _save(artifacts, f"{stem}.verdict.json", json.dumps(r | why, indent=1))
            return r

        if rc is None:
            return done(
                False, ev["error"] if ev["error"] == RATE_LIMIT_ERR else "timeout"
            )
        err = ev["error"] or (f"exit {rc}" if rc else None)
        passed = False
        if case.get("kind", "outcome") == "ask":
            terms = [t.lower() for t in case.get("ask_terms", [])]
            low = ev["final"].lower()
            clean = not status.strip()
            # Terms are alternatives (spelling variants, synonyms): one is enough (bench/suites/README.md).
            hit = [t for t in terms if t in low]
            passed = clean and "?" in ev["final"] and (bool(hit) or not terms)
            why |= {
                "check": "ask",
                "workspace_clean": clean,
                "asked_question": "?" in ev["final"],
                "matched_terms": hit,
            }
        else:
            if (cdir / "hidden").is_dir():
                shutil.copytree(cdir / "hidden", wd / "hidden", dirs_exist_ok=True)
            try:
                t = subprocess.run(
                    ["bash", "-c", case["test_cmd"]], cwd=wd, capture_output=True, text=True, timeout=600, check=False)  # fmt: skip
                passed = t.returncode == 0
                _save(artifacts, f"{stem}.test.out", t.stdout + t.stderr)
                why |= {"check": case["test_cmd"], "test_exit": t.returncode}
            except subprocess.TimeoutExpired:
                err = err or "test timeout"
        return done(passed, err)
    finally:
        shutil.rmtree(wd, ignore_errors=True)

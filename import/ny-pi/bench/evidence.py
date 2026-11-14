"""Evidence index of benchmark rounds: every run with its logs, why it failed, tool usage and cross-arm gaps.

Output carries local absolute paths and excerpts of agent transcripts: write it beside the rounds (local state),
never into the public repo.
"""

from __future__ import annotations

import collections
import itertools
import json
import os
import re
from pathlib import Path
from typing import Any

from bench import runners

HOME = Path.home()
S1_RESULTS = [
    Path(os.environ.get("BENCH_EVALS_RESULTS", HOME / ".claude/evals/results")),
    Path(os.environ.get("BENCH_PELO_RESULTS", HOME / ".local/state/pelo-em-ovo/results")),
]  # fmt: skip
# pi --mode json: tool_execution_start carries toolName; Claude stream-json: tool_use blocks carry name.
TOOL_RE = re.compile(
    r'"type":\s*"tool_execution_start".*?"toolName":\s*"([^"]+)"'
    r'|"type":\s*"tool_use",\s*"id":\s*"[^"]*",\s*"name":\s*"([^"]+)"'
)
AGENT_LOGS = ("agent/pi.txt", "agent/claude-code.txt", "agent/trajectory.json")
VERIFIER = ("verifier/test-stdout.txt", "verifier/reward.txt", "result.json", "trial.log")  # fmt: skip
COST_RATIO = (
    1.5  # a pass this many times dearer than the cheapest passing arm is a cost gap
)
# Tools that can change the workspace (a subagent may edit on the arm's behalf); compared in lower case.
MUTATING = {"edit", "write", "multiedit", "notebookedit", "bash"} | {
    n.lower() for n in runners.SUBAGENT_NAMES
}
SIGNATURES = ("infra-error", "timeout", "plan-tool-then-stop", "question-tool-error", "no-change", "tests-failed", "unclassified")  # fmt: skip
Row = dict[str, Any]
Key = tuple[str, str, int]


def signature(run: Row, tool_seq: list[str], verdict: dict[str, Any]) -> str:
    """Failure class of one run, first rule that matches; "pass" for a clean pass.

    `verdict` is the run's verdict.json ({} when there is none: S1 and Harbor runs end unclassified)."""
    err = str(run.get("error") or "")
    if "timeout" in err.lower():
        return "timeout"
    if err:
        return "infra-error"
    if run["passed"]:
        return "pass"
    if tool_seq and tool_seq[-1] == "plan_mode_complete":
        return "plan-tool-then-stop"
    if "question" in tool_seq and verdict.get("asked_question") is False:
        return "question-tool-error"
    if "test_exit" in verdict:  # an outcome case: the hidden tests ran and failed
        changed = any(t.lower() in MUTATING for t in tool_seq)
        return "tests-failed" if changed else "no-change"
    return "unclassified"


def tool_seq(path: Path | None) -> list[str]:
    """Tool names in call order."""
    if path is None or not path.is_file():
        return []
    return [a or b for a, b in TOOL_RE.findall(path.read_text(errors="replace"))]


def _seq_text(seq: list[str], cap: int = 40) -> str:
    parts = [f"{k}×{n}" if n > 1 else k for k, n in ((k, len(list(g))) for k, g in itertools.groupby(seq))]  # fmt: skip
    return " → ".join(parts[:cap]) + (" → …" if len(parts) > cap else "") or "-"


def _tail(path: Path | None, lines: int = 12, width: int = 200) -> list[str]:
    if path is None or not path.is_file():
        return []
    return [ln[:width] for ln in path.read_text(errors="replace").strip().splitlines()[-lines:]]  # fmt: skip


def harbor_trials(round_dir: Path) -> dict[str, Path]:
    """task -> trial dir; later jobs (resumes) win for the same task."""
    found: dict[str, Path] = {}
    for res in sorted(round_dir.glob("harbor/*/*/result.json"), key=lambda p: p.stat().st_mtime):  # fmt: skip
        try:  # an interrupted trial leaves an empty or partial result.json
            name = str(json.loads(res.read_text()).get("task_name", ""))
        except json.JSONDecodeError:
            continue
        found[name.split("/")[-1]] = res.parent
    return found


def s1_raw(arm: str, case: str, rep: int, cost: float | None) -> Path | None:
    """The eval transcript of this run: the one whose result cost equals the recorded cost, else the newest."""
    hits = sorted(
        (p for root in S1_RESULTS for p in root.glob(f"bench-{arm}-*/raw/{case}-{rep}.jsonl")),
        key=lambda p: p.stat().st_mtime,
    )  # fmt: skip
    for p in reversed(hits):
        if cost is not None and abs(runners.parse_events(p.read_text(errors="replace"), "cc")["cost"] - cost) < 1e-9:  # fmt: skip
            return p
    return hits[-1] if hits else None


def logs_of(round_dir: Path, arm: str, r: Row, trials: dict[str, Path]) -> dict[str, Path]:  # fmt: skip
    suite, task, rep = r["suite"], str(r["task_id"]).split("/")[-1], int(r["rep"])
    out: dict[str, Path] = {}
    if suite == "s1":
        raw = s1_raw(arm, task, rep, r.get("cost_usd"))
        if raw:
            out["events"] = raw
            unit = raw.parent.parent / "unit" / f"{task}-{rep}"
            if unit.is_dir():
                out["unit"] = unit
    elif task in trials:
        t = trials[task]
        out["trial"] = t
        for rel in AGENT_LOGS:
            if (t / rel).is_file():
                out.setdefault("events", t / rel)
        for rel in VERIFIER:
            if (t / rel).is_file():
                out["verifier" if rel == VERIFIER[0] else rel.split("/")[-1]] = t / rel
    else:
        stem = round_dir / "artifacts" / f"{suite}-{task}-{rep}"
        names = {"agent.out": "events", "test.out": "verifier", "verdict.json": "verdict", "diff": "diff", "agent.err": "stderr"}  # fmt: skip
        for ext, key in names.items():
            p = Path(f"{stem}.{ext}")
            if p.is_file():
                out[key] = p
    return out


def collect(rounds: list[Path]) -> list[Row]:
    rows: list[Row] = []
    for rd in rounds:
        meta = json.loads((rd / "meta.json").read_text())
        arm = f"{meta['arm']}@{meta['model'].removeprefix('claude-')}"
        trials = harbor_trials(rd)
        for line in (rd / "runs.jsonl").read_text().splitlines():
            if not line.strip():
                continue
            r = json.loads(line)
            logs = logs_of(rd, meta["arm"], r, trials)
            ev = logs.get("events")
            kind = "cc" if meta["arm"].startswith("cc") or r["suite"] == "s1" else "pi"
            parsed = runners.parse_events(ev.read_text(errors="replace"), kind) if ev else {}  # fmt: skip
            final = parsed.get("final", "")
            # rounds recorded before the per-run records (and S1/Harbor runs) take them from the transcript
            r |= {k: parsed.get(k) for k in runners.METRICS if r.get(k) is None}
            verdict = json.loads(logs["verdict"].read_text()) if "verdict" in logs else {}  # fmt: skip
            why = {k: v for k, v in verdict.items() if k in ("check", "test_exit", "exit_code", "workspace_clean", "asked_question", "matched_terms")}  # fmt: skip
            seq = tool_seq(ev)
            rows.append({**r, "arm": arm, "logs": logs, "seq": seq, "final": final, "why": why, "sig": signature(r, seq, verdict)})  # fmt: skip
    return rows


def _ok(r: Row) -> bool:
    return bool(r["passed"]) and not r.get("error")


def _cell(r: Row) -> str:
    mark = "ERR" if r.get("error") else ("✓" if r["passed"] else "✗")
    cost = f"${r['cost_usd']:.3f}" if r.get("cost_usd") is not None else "-"
    return f"{mark} {cost} {r.get('wall_s') or '-'}s"


def _detail(r: Row) -> list[str]:
    """Everything needed to diagnose one run without opening a file first."""
    out = [f"- **{r['arm']}** {_cell(r)}" + (f"; error: {r['error']}" if r.get("error") else "")]  # fmt: skip
    if not _ok(r):
        out.append(f"  - signature: {r['sig']}")
    if r["why"]:
        out.append("  - verdict: " + ", ".join(f"{k}={v}" for k, v in r["why"].items()))
    out.append(f"  - tools ({len(r['seq'])}): {_seq_text(r['seq'])}")
    if r["final"]:
        out.append("  - final message: " + " ".join(r["final"].split())[:400])
    if not _ok(r) and (tail := _tail(r["logs"].get("verifier"))):
        out += ["  - verifier tail:", "", "    ```text", *(f"    {ln}" for ln in tail), "    ```", ""]  # fmt: skip
    out += [f"  - {k}: `{v}`" for k, v in r["logs"].items()]
    return out


def missing(rows: list[Row]) -> list[Row]:
    """Runs that cannot be traced: no agent transcript on disk."""
    return [r for r in rows if "events" not in r["logs"]]


def _signature_table(rows: list[Row], arms: list[str]) -> list[str]:
    out = ["", "## Failure signatures per arm", "", "| arm | failed | " + " | ".join(SIGNATURES) + " |", "|---|---|" + "---|" * len(SIGNATURES)]  # fmt: skip
    for a in arms:
        n = collections.Counter(r["sig"] for r in rows if r["arm"] == a and not _ok(r))
        out.append(f"| {a} | {sum(n.values())} | " + " | ".join(str(n[s]) for s in SIGNATURES) + " |")  # fmt: skip
    return out


def _mean(xs: list[float]) -> str:
    return f"{sum(xs) / len(xs):.1f}" if xs else "-"


def _metrics_table(rows: list[Row], arms: list[str]) -> list[str]:
    """Means of the per-run records over the runs that carry them; nothing when no run does."""
    if not any(r.get(k) is not None for r in rows for k in runners.METRICS):
        return []
    tok = ("input", "output", "cache_read", "cache_write")
    out = ["", "## Tokens and turns per arm (means)", "", "| arm | runs with data | " + " | ".join(tok) + " | turns | tool errors | first request tokens |", "|---|---|" + "---|" * 7]  # fmt: skip
    for a in arms:
        mine = [r for r in rows if r["arm"] == a]
        toks = [r["tokens"] for r in mine if r.get("tokens")]
        cols = [_mean([t[k] for t in toks]) for k in tok]
        cols += [_mean([r[k] for r in mine if r.get(k) is not None]) for k in ("turns", "tool_errors", "first_request_tokens")]  # fmt: skip
        out.append(f"| {a} | {sum(any(r.get(k) is not None for k in runners.METRICS) for r in mine)} | " + " | ".join(cols) + " |")  # fmt: skip
    return out


def render(rows: list[Row], focus: str | None = None) -> str:
    arms = sorted({r["arm"] for r in rows})
    by: dict[Key, dict[str, Row]] = collections.defaultdict(dict)
    for r in rows:
        by[(r["suite"], str(r["task_id"]).split("/")[-1], int(r["rep"]))][r["arm"]] = r
    lost = missing(rows)
    noverif = [r for r in rows if r["suite"] != "s1" and not ({"verifier", "verdict"} & set(r["logs"]))]  # fmt: skip
    out = ["# Evidence index", "", f"{len(arms)} arms, {len(rows)} runs. Cells: result, cost, wall.", ""]  # fmt: skip
    out += ["## Traceability", ""]
    out.append(f"- agent transcript on disk: {len(rows) - len(lost)}/{len(rows)} runs")
    out.append(f"- verifier output or verdict on disk (S2 to S6): {sum(r['suite'] != 's1' for r in rows) - len(noverif)}/{sum(r['suite'] != 's1' for r in rows)} runs")  # fmt: skip
    out += [f"- NO TRANSCRIPT: {r['suite']} {r['task_id']} rep {r['rep']} {r['arm']}" for r in lost]  # fmt: skip
    out += [f"- no verifier output: {r['suite']} {r['task_id']} rep {r['rep']} {r['arm']}" for r in noverif]  # fmt: skip
    out += _signature_table(rows, arms) + _metrics_table(rows, arms)
    for a in [a for a in arms if focus and a.split("@")[0] == focus]:
        out += ["", f"## Gaps of {a}", ""]
        groups: dict[str, list[Key]] = {"Failed where another arm passed": [], "Infrastructure or agent error": [], "Failed in every arm": [], f"Passed, but over {COST_RATIO}x the cheapest passing arm": []}  # fmt: skip
        names = list(groups)
        for key, cells in sorted(by.items()):
            if a not in cells:
                continue
            me, others = cells[a], [r for x, r in cells.items() if x != a]
            passing = [r for r in others if _ok(r)]
            cheapest = min((r["cost_usd"] or 0.0 for r in passing), default=0.0)
            if me.get("error"):
                groups[names[1]].append(key)
            elif not me["passed"]:
                groups[names[0] if passing else names[2]].append(key)
            elif cheapest and (me["cost_usd"] or 0.0) > COST_RATIO * cheapest:
                groups[names[3]].append(key)
        out.append("| group | runs |\n|---|---|\n" + "\n".join(f"| {g} | {len(ks)} |" for g, ks in groups.items()))  # fmt: skip
        for g, ks in groups.items():
            for s, t, rep in ks:
                cells = by[(s, t, rep)]
                out += ["", f"### {g}: {s} {t} rep {rep}", ""] + _detail(cells[a])
                ref = sorted((r for x, r in cells.items() if x != a and _ok(r)), key=lambda r: r["cost_usd"] or 0.0)  # fmt: skip
                for r in ref[:1]:
                    out += ["- reference (cheapest passing arm):"] + ["  " + ln for ln in _detail(r)]  # fmt: skip
    out += ["", "## Matrix", "", "| suite | task | rep | " + " | ".join(arms) + " |", "|---|---|---|" + "---|" * len(arms)]  # fmt: skip
    for (s, t, rep), cells in sorted(by.items()):
        out.append(f"| {s} | {t} | {rep} | " + " | ".join(_cell(cells[a]) if a in cells else "" for a in arms) + " |")  # fmt: skip
    out += ["", "## Divergences (some arm passed, another failed)", ""]
    for (s, t, rep), cells in sorted(by.items()):
        ok = sorted(a for a, r in cells.items() if _ok(r))
        bad = sorted(a for a, r in cells.items() if not _ok(r))
        if ok and bad:
            out += [f"### {s} {t} rep {rep}: pass {', '.join(ok)}; fail {', '.join(bad)}", ""]  # fmt: skip
            for a in sorted(cells):
                out += _detail(cells[a])
            out.append("")
    out += ["## Tool usage per arm", "", "| arm | runs | tool calls | top tools |", "|---|---|---|---|"]  # fmt: skip
    for a in arms:
        mine = [r for r in rows if r["arm"] == a]
        tot = collections.Counter(t for r in mine for t in r["seq"])
        top = ", ".join(f"{k}×{v}" for k, v in tot.most_common(10))
        out.append(f"| {a} | {len(mine)} | {sum(tot.values())} | {top} |")
    out += ["", "## Every run with its logs", ""]
    for r in sorted(rows, key=lambda x: (x["suite"], str(x["task_id"]), x["rep"], x["arm"])):  # fmt: skip
        out.append(f"- {r['suite']} {r['task_id']} rep {r['rep']} **{r['arm']}** {_cell(r)}" + (f" error: {r['error']}" if r.get("error") else ""))  # fmt: skip
        out += [f"  - {k}: `{v}`" for k, v in r["logs"].items()]
    return "\n".join(out) + "\n"

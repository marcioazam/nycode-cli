"""Offline tests of the bench runners (case runner, parsers, budget, the Harbor bundle): fake arms, no spend."""

import json
import shutil
import subprocess
import tarfile
from pathlib import Path
from typing import Any

import pytest

from bench import run as rb
from bench import runners as rn
from bench.tests.helpers import (
    BENCH,
    CC_ARM,
    MP,
    PI_ARM,
    make_case,
    s1_line,
    script,
)


def test_parse_s1_runs(tmp_path: Path) -> None:
    f = tmp_path / "runs.jsonl"
    f.write_text(
        s1_line("a", 0, True)
        + "\n\n"
        + s1_line("sec-x", 1, False, "security", True)
        + "\n"
    )
    rs = rn.parse_s1_runs(f)
    assert [r["task_id"] for r in rs] == ["a", "sec-x"]
    assert rs[0]["passed"] and rs[0]["cost_usd"] == 0.05 and rs[0]["split"] == "heldout"
    assert rs[1]["security"] and rs[1]["subagents_used"] and not rs[1]["passed"]
    assert rn.run_cost(rs) == pytest.approx(0.10)


def test_run_s1_cc_and_pi_flags(fake_evals: Path) -> None:
    rs, err = rn.run_s1("cc", Path("/arm"), ["a", "b"], 2, "m", 1.5, "lbl", {})
    assert err is None and rs[0]["task_id"] == "a"
    argv = (fake_evals / "argv").read_text()
    assert (
        "--claude-bin /arm" in argv
        and "--cases a,b" in argv
        and "--budget-usd 1.5000" in argv
    )
    rn.run_s1("pi", Path("/arm"), ["a"], 1, "m", 1.5, "lbl", {})
    assert (fake_evals / "argv").read_text().endswith("|/arm")


def test_run_s1_drift_resumes_once(fake_evals: Path, monkeypatch: MP) -> None:
    monkeypatch.setenv("FAKE_DRIFT", "1")
    rs, err = rn.run_s1("pi", Path("/arm"), ["a"], 1, "m", 1.0, "l", {})
    assert (
        err is None and "--resume" in (fake_evals / "argv").read_text() and len(rs) == 1
    )


def test_run_s1_drift_persisting_is_infra_error_not_pass(
    fake_evals: Path, monkeypatch: MP
) -> None:
    monkeypatch.setenv("FAKE_DRIFT", "always")
    _, err = rn.run_s1("pi", Path("/arm"), ["a"], 1, "m", 1.0, "l", {})
    assert err and err.startswith("infra")


def test_run_s1_no_results_dir(tmp_path: Path, monkeypatch: MP) -> None:
    f = tmp_path / "e.py"
    f.write_text("print('boom')\nraise SystemExit(3)\n")
    monkeypatch.setattr(rn, "EVALS_RUN", f)
    assert rn.run_s1("cc", Path("/a"), ["a"], 1, "m", 1.0, "l", {}) == (
        [],
        "infra: no results dir (exit 3)",
    )
    f.write_text("print('harness changed x; stopping')\n")
    rs, err = rn.run_s1("cc", Path("/a"), ["a"], 1, "m", 1.0, "l", {})
    assert rs == [] and err and "without results dir" in err


def test_run_s1_nonzero_exit_reports_error(
    fake_evals: Path, tmp_path: Path, monkeypatch: MP
) -> None:
    f = tmp_path / "e.py"
    f.write_text(f"print('results: {fake_evals / 'res'}')\nraise SystemExit(1)\n")
    (fake_evals / "res").mkdir()
    (fake_evals / "res" / "runs.jsonl").write_text(s1_line("a", 0, False) + "\n")
    monkeypatch.setattr(rn, "EVALS_RUN", f)
    rs, err = rn.run_s1("cc", Path("/a"), ["a"], 1, "m", 1.0, "l", {})
    assert err == "exit 1" and not rs[0]["passed"]


def trial(
    name: str,
    reward: float | None,
    cost: float,
    exc: Any = None,
    start: str = "2026-11-13T19:00:00Z",
) -> dict[str, Any]:
    return {
        "task_name": name, "started_at": start, "finished_at": "2026-11-13T19:03:00Z",
        "agent_execution": {"started_at": "2026-11-13T19:00:10Z", "finished_at": "2026-11-13T19:00:40Z"},
        "agent_result": {"cost_usd": cost},
        "verifier_result": None if reward is None else {"rewards": {"reward": reward}},
        "exception_info": exc,
    }  # fmt: skip


def write_job(job: Path, trials: list[dict[str, Any]]) -> None:
    for i, t in enumerate(trials):
        (job / f"t{i}").mkdir(parents=True)
        (job / f"t{i}" / "result.json").write_text(json.dumps(t))
    (job / "result.json").write_text(
        json.dumps({"stats": {}})
    )  # job-level file has no task_name


def test_parse_harbor_job(tmp_path: Path) -> None:
    write_job(
        tmp_path,
        [
            trial("fix-git", 1.0, 0.14),
            trial("fix-git", 0.0, 0.2, start="2026-11-13T19:10:00Z"),
            trial("crack", None, 0.0, {"type": "Refused: Cyber safeguards"}),
            trial("boom", None, 0.0, "RuntimeError"),
        ],
    )
    rs = rn.parse_harbor_job(tmp_path, "s2", {"fix-git": "heldout"})
    by = {(r["task_id"], r["rep"]): r for r in rs}
    assert by[("fix-git", 0)]["passed"] and by[("fix-git", 0)]["wall_s"] == 30.0
    assert (
        by[("fix-git", 0)]["split"] == "heldout"
        and by[("fix-git", 0)]["cost_usd"] == 0.14
    )
    assert not by[("fix-git", 1)]["passed"]
    assert by[("crack", 0)]["error"] == "refusal" and not by[("crack", 0)]["passed"]
    assert by[("boom", 0)]["error"] == "RuntimeError"


def test_sampling_split_and_exclusions(tmp_path: Path) -> None:
    names = [f"t{i}" for i in range(40)]
    f = tmp_path / "ex.json"
    f.write_text(json.dumps([{"id": "t0", "reason": "oracle failed"}, "t1"]))
    ex = rn.load_excluded(f)
    assert ex == {"t0": "oracle failed", "t1": ""}
    f.write_text(json.dumps({"t2": "r"}))
    assert rn.load_excluded(f) == {"t2": "r"}
    assert rn.load_excluded(tmp_path / "none.json") == {}
    a = rn.sample_tasks(names, ex, 10, 7, 30)
    assert (
        a == rn.sample_tasks(names, ex, 10, 7, 30)
        and len(a) == 10
        and not {"t0", "t1"} & set(a)
    )
    held = rn.sample_tasks(names, {}, None, 7, 30, ["heldout"])
    assert held and all(rn.split_of(t, 7, 30) == "heldout" for t in held)
    assert len(held) < 20
    assert rn.sample_tasks(names, {}, None, 7, 30) == sorted(names)


def test_dict_task_file_heldout_and_exclusion(tmp_path: Path, monkeypatch: MP) -> None:
    names = [f"t{i}" for i in range(10)]
    held = ["t3", "t4"]
    f = tmp_path / "tasks.json"
    f.write_text(
        json.dumps({"dataset": "d", "version": "1", "tasks": names, "heldout": held})
    )
    assert rn.load_tasks(f) == (names, held)
    f.write_text(json.dumps(names))
    assert rn.load_tasks(f) == (names, None)
    assert rn.split_of("t3", 7, 30, held) == "heldout"
    assert rn.split_of("t0", 7, 30, held) == "dev"
    got = rn.sample_tasks(names, {"t4": "bad"}, None, 7, 30, ["heldout"], held)
    assert got == ["t3"]
    assert rn.sample_tasks(names, {"t4": "bad"}, None, 7, 30, ["dev"], held) == [
        t for t in names if t not in ("t3", "t4")
    ]
    (tmp_path / "tasks").mkdir()
    (tmp_path / "tasks/tb2.json").write_text(
        json.dumps({"tasks": names, "heldout": held})
    )
    (tmp_path / "tasks/tb2.excluded.json").write_text(json.dumps({"t3": "oracle"}))
    monkeypatch.setattr(rb, "BENCH", tmp_path)
    steps = rb.build_plan("pr", rb.load_toml(BENCH / "suites.toml"), ["s2"])
    assert steps[0]["units"] == 4 and "t3" not in steps[0]["tasks"]


def test_harbor_cmd_and_agents(monkeypatch: MP) -> None:
    monkeypatch.setenv("BENCH_HARBOR", "/h/harbor")
    cmd = rn.harbor_cmd("ds@1", ["-a", "oracle"], "j", Path("/o"), ["t1", "t2"], k=3)
    assert (
        cmd[:3] == ["/h/harbor", "run", "-d"]
        and cmd.count("-i") == 2
        and "-x" not in cmd
    )
    assert cmd[cmd.index("-k") + 1] == "3" and cmd[cmd.index("-n") + 1] == "4"
    cmd = rn.harbor_cmd("ds@1", [], "j", Path("/o"), None, 5, ["z", "a"])
    assert cmd[cmd.index("-l") + 1] == "5" and cmd.count("-x") == 2 and "-i" not in cmd
    cc = rn.harbor_agent("cc-vanilla", "m", Path("/hd"))
    assert (
        cc[0][:2] == ["-a", "claude-code"]
        and cc[2] == "CLAUDE_CODE_OAUTH_TOKEN"
        and cc[1]["CLAUDE_FORCE_OAUTH"]
    )
    assert "version=1.5.2" in rn.harbor_agent("pi-vanilla", "m", Path("/hd"))[0]
    mp = rn.harbor_agent("ny-pi", "m", Path("/hd"))
    assert "pi_harness_agent:PiHarnessAgent" in mp[0] and mp[1] == {"PYTHONPATH": "/hd"}
    capped = rn.harbor_cmd("ds", [], "j", Path("/o"), ["t"], timeout_mult=0.125)
    assert capped[capped.index("--agent-timeout-multiplier") + 1] == "0.125"
    assert "--agent-timeout-multiplier" not in rn.harbor_cmd(
        "ds", [], "j", Path("/o"), ["t"]
    )
    om = rn.harbor_agent("omp", "m", Path("/hd"))
    assert om[0][:2] == ["-a", "omp_agent:OmpAgent"] and "thinking=medium" in om[0]
    assert om[1] == {"PYTHONPATH": "/hd"} and om[2] == "ANTHROPIC_OAUTH_TOKEN"
    monkeypatch.delenv("BENCH_HARBOR")
    monkeypatch.setattr(shutil, "which", lambda _: None)
    assert rn.harbor_bin()[0] == "uvx"
    monkeypatch.setattr(shutil, "which", lambda _: "/usr/bin/harbor")
    assert rn.harbor_bin() == ["harbor"]


def test_run_harbor_chunks_and_budget(tmp_path: Path, monkeypatch: MP) -> None:
    fake = script(
        tmp_path / "harbor",
        f"""
job=""; ids=()
while [ $# -gt 0 ]; do case "$1" in --job-name) job=$2; shift;; -i) ids+=("$2"); shift;; esac; shift; done
for t in "${{ids[@]}}"; do
  d={tmp_path}/jobs/$job/${{t}}__x; mkdir -p "$d"
  echo '{{"task_name":"'$t'","verifier_result":{{"rewards":{{"reward":1.0}}}},"agent_result":{{"cost_usd":0.6}}}}' > "$d/result.json"
done
""",
    )
    monkeypatch.setenv("BENCH_HARBOR", str(fake))
    jobs = tmp_path / "jobs"

    def make(chunk: list[str], job: str) -> list[str]:
        return rn.harbor_cmd("ds", [], job, jobs, chunk, k=1)

    rs, exhausted = rn.run_harbor([], jobs, "s2", {}, [["a"], ["b"], ["c"]], 1.0, make)
    assert [r["task_id"] for r in rs] == [
        "a",
        "b",
    ] and exhausted  # 0.6 + 0.6 >= 1.0: third chunk never starts
    seen: list[list[str]] = []
    rs, exhausted = rn.run_harbor(
        [], jobs, "s2", {}, [["a"], ["b"]], 5.0, make, None,
        lambda got: seen.append([r["task_id"] for r in got]),
    )  # fmt: skip
    assert len(rs) == 2 and not exhausted
    assert seen == [["a"], ["b"]]  # each chunk reaches the sink as it ends
    rs, _ = rn.run_harbor([], tmp_path / "empty", "s9", {}, [["q"]], 5.0, make)
    assert rs[0]["error"].startswith("harbor exit") and not rs[0]["passed"]


def test_run_harbor_never_reuses_an_existing_job(
    tmp_path: Path, monkeypatch: MP
) -> None:
    """--resume on 2026-11-14 reused job s2-0: harbor replayed its old 429 trials instead of running again."""
    fake = script(
        tmp_path / "harbor",
        f"""
job=""; while [ $# -gt 0 ]; do case "$1" in --job-name) job=$2; shift;; esac; shift; done
[ -d {tmp_path}/jobs/$job ] && exit 0  # harbor resumes an existing job: nothing new runs
d={tmp_path}/jobs/$job/a__x; mkdir -p "$d"
echo '{{"task_name":"a","verifier_result":{{"rewards":{{"reward":1.0}}}},"agent_result":{{"cost_usd":0.2}}}}' > "$d/result.json"
""",
    )
    monkeypatch.setenv("BENCH_HARBOR", str(fake))
    jobs = tmp_path / "jobs"
    old = jobs / "s2-0" / "a__old"
    old.mkdir(parents=True)
    (old / "result.json").write_text(
        '{"task_name":"a","verifier_result":{"rewards":{"reward":0.0}},"agent_result":{"cost_usd":0}}'
    )

    def make(chunk: list[str], job: str) -> list[str]:
        return rn.harbor_cmd("ds", [], job, jobs, chunk, k=1)

    rs, _ = rn.run_harbor([], jobs, "s2", {}, [["a"]], 5.0, make)
    assert len(rs) == 1 and rs[0]["passed"] and not rs[0].get("error")


def test_outcome_case_passes_and_detects_subagent(tmp_path: Path) -> None:
    arm = script(tmp_path / "arm", CC_ARM)
    case = make_case(tmp_path / "cases", "c1", security=True, split="heldout")
    r = rn.run_case(case, "s4", 0, "cc", arm, "m", {})
    assert r["passed"] and r["error"] is None and r["subagents_used"]
    assert (
        r["cost_usd"] == 0.4
        and r["security"]
        and r["split"] == "heldout"
        and r["suite"] == "s4"
    )


def test_noop_arm_fails_outcome(tmp_path: Path) -> None:
    arm = script(tmp_path / "arm", CC_ARM)
    case = make_case(tmp_path / "cases", "c1")
    r = rn.run_case(case, "s4", 0, "cc", arm, "m", {"FAKE_MODE": "noop"})
    assert not r["passed"]


def test_timeout_is_failure_with_error(tmp_path: Path) -> None:
    arm = script(tmp_path / "arm", CC_ARM)
    case = make_case(tmp_path / "cases", "c1", timeout_s=1)
    r = rn.run_case(case, "s4", 0, "cc", arm, "m", {"FAKE_MODE": "sleep"})
    assert not r["passed"] and r["error"] == "timeout"


def test_ask_case_with_pi_arm(tmp_path: Path) -> None:
    arm = script(tmp_path / "arm", PI_ARM)
    case = make_case(tmp_path / "cases", "ask1", kind="ask", ask_terms=["which file"])
    r = rn.run_case(case, "s4", 0, "pi", arm, "m", {})
    assert r["passed"] and r["subagents_used"] and r["cost_usd"] == pytest.approx(0.03)
    bad = make_case(tmp_path / "cases", "ask2", kind="ask", ask_terms=["database"])
    assert not rn.run_case(bad, "s4", 0, "pi", arm, "m", {})["passed"]


def test_ask_case_fails_when_tree_dirty_or_no_question(tmp_path: Path) -> None:
    arm = script(tmp_path / "arm", CC_ARM)
    case = make_case(tmp_path / "cases", "ask1", kind="ask", ask_terms=[])
    # edits the repo and never asks: dirty tree and no '?'
    assert not rn.run_case(case, "s4", 0, "cc", arm, "m", {})["passed"]
    q = rn.run_case(
        case, "s4", 0, "cc", arm, "m", {"FAKE_MODE": "noop", "FAKE_FINAL": "which one?"}
    )
    assert q["passed"]


def test_ask_terms_are_alternatives(tmp_path: Path) -> None:
    """Baseline 2026-11-14: the scorer demanded every term, so spelling variants ("período", "periodo") made the
    ask cases unpassable for all arms; the suite contract is one term (bench/suites/README.md)."""
    pi = script(tmp_path / "pi", PI_ARM)  # final: "Which file do you mean?"
    one = make_case(tmp_path / "cases", "a1", kind="ask", ask_terms=["database", "file"])  # fmt: skip
    assert rn.run_case(one, "s4", 0, "pi", pi, "m", {})["passed"]
    none = make_case(tmp_path / "cases", "a2", kind="ask", ask_terms=["database", "table"])  # fmt: skip
    assert not rn.run_case(none, "s4", 0, "pi", pi, "m", {})["passed"]


def test_parse_events_variants() -> None:
    single = json.dumps(
        {
            "type": "result",
            "total_cost_usd": 1.5,
            "result": "x",
            "is_error": True,
            "subtype": "max",
        }
    )
    ev = rn.parse_events(single, "cc")
    assert ev["cost"] == 1.5 and ev["error"] == "max"
    pi_err = json.dumps(
        {
            "type": "message_end",
            "message": {
                "role": "assistant",
                "stopReason": "error",
                "errorMessage": "e",
            },
        }
    )
    assert rn.parse_events(pi_err, "pi")["error"] == "e"
    assert rn.parse_events("garbage", "pi")["error"] == "no events"
    assert rn.parse_events("[1]\n3", "cc")["cost"] == 0.0
    assert rn.arm_cmd("cc", Path("a"), "m", "p", 0.5)[-1] == "p"
    assert rn.arm_cmd("pi", Path("a"), "m", "-p", 0.5)[-2:] == ["--", "-p"]


def test_case_saves_agent_and_test_output(tmp_path: Path) -> None:
    arm = script(tmp_path / "arm", CC_ARM)
    case = make_case(tmp_path / "cases", "c1")
    art = tmp_path / "art"
    rn.run_case(case, "s4", 0, "cc", arm, "m", {}, None, art)
    assert (art / "s4-c1-0.agent.out").read_text().strip()
    assert (art / "s4-c1-0.test.out").exists()
    # the workspace diff (before the hidden tests land) and why the verdict is what it is
    diff = (art / "s4-c1-0.diff").read_text()
    assert "out.txt" in diff and "+changed" in diff and "hidden" not in diff
    v = json.loads((art / "s4-c1-0.verdict.json").read_text())
    assert v["passed"] and v["test_exit"] == 0 and v["exit_code"] == 0
    assert v["final"] == "done" and "out.txt" in v["check"]


def test_case_verdict_explains_ask_and_timeout(tmp_path: Path) -> None:
    art = tmp_path / "art"
    pi = script(tmp_path / "pi", PI_ARM + "echo oops >&2\n")
    bad = make_case(tmp_path / "cases", "ask2", kind="ask", ask_terms=["database"])
    assert not rn.run_case(bad, "s4", 0, "pi", pi, "m", {}, None, art)["passed"]
    v = json.loads((art / "s4-ask2-0.verdict.json").read_text())
    assert v["check"] == "ask" and v["matched_terms"] == []
    assert v["workspace_clean"] and v["asked_question"]
    assert (art / "s4-ask2-0.agent.err").read_text() == "oops\n"
    assert (art / "s4-ask2-0.diff").read_text() == ""
    cc = script(tmp_path / "arm", CC_ARM)
    slow = make_case(tmp_path / "cases", "slow", timeout_s=1)
    rn.run_case(slow, "s4", 1, "cc", cc, "m", {"FAKE_MODE": "sleep"}, None, art)
    v = json.loads((art / "s4-slow-1.verdict.json").read_text())
    assert v["error"] == "timeout" and v["exit_code"] is None and not v["passed"]


def test_make_run_flags_no_spend_failures_as_infra() -> None:
    """Baseline 2026-11-14: 429 runs ended at cost 0/None, passed False and counted as real failures."""
    for cost in (0, 0.0, None):
        assert rn.make_run("s2", "t", 0, False, cost_usd=cost)["error"] == rn.INFRA_ERR
    assert rn.make_run("s2", "t", 0, False, cost_usd=0.2)["error"] is None
    assert rn.make_run("s2", "t", 0, True, cost_usd=0)["error"] is None
    assert rn.make_run("s2", "t", 0, False, error="timeout")["error"] == "timeout"


def test_parse_harbor_job_flags_zero_cost_failure(tmp_path: Path) -> None:
    write_job(tmp_path / "j", [trial("a", 0.0, 0.0), trial("b", 0.0, 0.3)])
    a, b = rn.parse_harbor_job(tmp_path / "j", "s2")
    assert a["error"] == rn.INFRA_ERR and b["error"] is None


def test_run_harbor_stops_after_five_infra_in_a_row(
    tmp_path: Path, monkeypatch: MP
) -> None:
    monkeypatch.setenv(
        "BENCH_HARBOR", "/bin/true"
    )  # produces no trials: every chunk is infra
    jobs = tmp_path / "jobs"

    def make(chunk: list[str], job: str) -> list[str]:
        return rn.harbor_cmd("ds", [], job, jobs, chunk, k=1)

    chunks = [[f"t{i}"] for i in range(9)]
    rs, stopped = rn.run_harbor([], jobs, "s2", {}, chunks, 99.0, make)
    assert len(rs) == 5 and stopped


def test_s1_case_reps_reads_declared_reps(tmp_path: Path, monkeypatch: MP) -> None:
    # Cases declaring `reps: 1` run once whatever k is; --resume must not see rep 1 as missing.
    (tmp_path / "cases").mkdir()
    (tmp_path / "cases" / "a.jsonl").write_text(
        '{"id": "once", "reps": 1}\n{"id": "free"}\n\n'
    )
    monkeypatch.setattr(rn, "EVALS_RUN", tmp_path / "run.py")
    assert rn.s1_case_reps(["once", "free", "gone"], 2) == {
        "once": 1, "free": 2, "gone": 2,
    }  # fmt: skip


def test_s1_case_reps_without_cases_dir_uses_k(tmp_path: Path, monkeypatch: MP) -> None:
    monkeypatch.setattr(rn, "EVALS_RUN", tmp_path / "run.py")
    assert rn.s1_case_reps(["x"], 3) == {"x": 3}


BUNDLE_SH = (
    Path(__file__).resolve().parents[2] / "claude-home/bin/evals/harbor/bundle.sh"
)


def test_bundle_dereferences_linked_install(tmp_path: Path) -> None:
    """bundle.sh: links out of the bundle (a --link install points into the repo) become files; links inside stay."""
    src = tmp_path / "repo"
    (src / "extensions").mkdir(parents=True)
    (src / "extensions/a.ts").write_text("x")
    (src / "pi").write_text("#!/bin/sh\n")
    home = tmp_path / "home"
    (home / ".pi/agent/extensions").mkdir(parents=True)
    (home / ".local/bin").mkdir(parents=True)
    (home / ".pi/agent/extensions/a.ts").symlink_to(src / "extensions/a.ts")
    (home / ".local/bin/pi").symlink_to(src / "pi")
    # npm's .bin entries are relative links whose script requires siblings: they must stay links.
    nm = home / ".pi/agent/node_modules"
    (nm / "pkg/dist").mkdir(parents=True)
    (nm / "pkg/dist/cli.js").write_text("require('./lib')")
    (nm / ".bin").mkdir()
    (nm / ".bin/pkg").symlink_to("../pkg/dist/cli.js")
    out = tmp_path / "b.tgz"
    subprocess.run(
        ["bash", str(BUNDLE_SH), str(out)],
        env={"HOME": str(home), "PATH": "/usr/bin:/bin"},
        check=True,
        capture_output=True,
    )
    with tarfile.open(out) as t:
        links = {m.name: m.linkname for m in t if m.issym()}
        names = t.getnames()
    assert ".local/bin/pi" in names and ".pi/agent/extensions/a.ts" in names
    assert links == {".pi/agent/node_modules/.bin/pkg": "../pkg/dist/cli.js"}


def _pi_msg(role: str, **kw: Any) -> str:
    return json.dumps({"type": "message_end", "message": {"role": role, **kw}})


def test_parse_events_per_run_records_pi_and_omp() -> None:
    def usage(i: int, o: int, r: int, w: int) -> dict[str, Any]:
        return {"input": i, "output": o, "cacheRead": r, "cacheWrite": w, "totalTokens": i + o + r + w,
                "cost": {"total": 0.01}}  # fmt: skip

    text = "\n".join([
        _pi_msg("user", content=[{"type": "text", "text": "do it"}]),
        _pi_msg("assistant", content=[], usage=usage(4, 100, 0, 3000)),
        _pi_msg("toolResult", toolName="bash", isError=True),
        _pi_msg("toolResult", toolName="read", isError=False),
        # tool_execution_end repeats the tool result: it must not count twice
        json.dumps({"type": "tool_execution_end", "toolName": "bash", "isError": True}),
        _pi_msg("assistant", content=[{"type": "text", "text": "done"}], usage=usage(6, 50, 3000, 200)),
        json.dumps({"type": "turn_end", "message": {"role": "assistant", "usage": usage(6, 50, 3000, 200)}}),
    ])  # fmt: skip
    ev = rn.parse_events(text, "pi")
    assert ev["tokens"] == {"input": 10, "output": 150, "cache_read": 3000, "cache_write": 3200}  # fmt: skip
    assert ev["turns"] == 2 and ev["tool_errors"] == 1
    assert ev["first_request_tokens"] == 3004 and ev["cost"] == pytest.approx(0.02)


def test_parse_events_per_run_records_claude_code() -> None:
    def assistant(mid: str, i: int, o: int, r: int, w: int) -> str:
        u = {"input_tokens": i, "output_tokens": o, "cache_read_input_tokens": r, "cache_creation_input_tokens": w}  # fmt: skip
        return json.dumps({"type": "assistant", "message": {"id": mid, "role": "assistant", "content": [], "usage": u}})  # fmt: skip

    def result(block: dict[str, Any]) -> str:
        return json.dumps({"type": "user", "message": {"role": "user", "content": [block]}})  # fmt: skip

    lines = [
        json.dumps({"type": "system", "subtype": "init"}),
        assistant("m1", 2, 10, 11000, 5000),
        assistant(
            "m1", 2, 10, 11000, 5000
        ),  # one event per content block of the same message
        result({"type": "tool_result", "is_error": True}),
        result({"type": "tool_result", "is_error": False}),
        json.dumps(
            {"type": "user", "message": {"role": "user", "content": "plain text"}}
        ),
        assistant("m2", 3, 40, 16000, 100),
    ]
    ev = rn.parse_events("\n".join(lines), "cc")
    assert ev["turns"] == 2 and ev["tool_errors"] == 1 and ev["first_request_tokens"] == 16002  # fmt: skip
    assert ev["tokens"] == {"input": 5, "output": 50, "cache_read": 27000, "cache_write": 5100}  # fmt: skip
    # the result event carries the cumulative usage: it wins over the per-message sum
    total = {"input_tokens": 7, "output_tokens": 700, "cache_read_input_tokens": 27000, "cache_creation_input_tokens": 5100}  # fmt: skip
    lines.append(json.dumps({"type": "result", "total_cost_usd": 0.1, "result": "ok", "usage": total}))  # fmt: skip
    ev = rn.parse_events("\n".join(lines), "cc")
    assert ev["tokens"] == {"input": 7, "output": 700, "cache_read": 27000, "cache_write": 5100}  # fmt: skip
    assert ev["first_request_tokens"] == 16002


def test_per_run_records_are_none_when_the_log_lacks_them(tmp_path: Path) -> None:
    for kind in ("cc", "pi"):
        ev = rn.parse_events("garbage", kind)
        assert [ev[k] for k in rn.METRICS] == [None] * 4
    # a usage block with the cost only: turns are known, tokens are not
    cost_only = _pi_msg("assistant", content=[], usage={"cost": {"total": 0.3}})
    ev = rn.parse_events(cost_only, "pi")
    assert ev["turns"] == 1 and ev["tool_errors"] == 0
    assert ev["tokens"] is None and ev["first_request_tokens"] is None
    old = rn.make_run("s2", "t", 0, True, cost_usd=0.1)
    assert [old[k] for k in rn.METRICS] == [None] * 4
    r = rn.run_case(make_case(tmp_path / "cases", "c1"), "s4", 0, "pi", script(tmp_path / "pi", PI_ARM), "m", {})  # fmt: skip
    assert r["turns"] == 2 and r["tool_errors"] == 0 and r["tokens"] is None


# ------------------------------------------------------------- the scorer itself, on the real S4 cases

S4 = rn.load_cases(BENCH / "suites/plan")
S4_ASK = [c for c in S4 if c["kind"] == "ask"]


def _lone_term(terms: list[str]) -> str:
    """A term that contains no other term, so an answer quoting it matches exactly one."""
    low = [t.lower() for t in terms]
    return next(t for t in terms if sum(o in t.lower() for o in low) == 1)


@pytest.mark.parametrize("case", S4_ASK, ids=[c["id"] for c in S4_ASK])
def test_s4_ask_scorer(case: dict[str, Any], tmp_path: Path) -> None:
    arm = script(tmp_path / "arm", CC_ARM)
    assert len(case["ask_terms"]) > 1
    term = _lone_term(case["ask_terms"])

    def run(rep: int, mode: str, final: str) -> tuple[bool, dict[str, Any]]:
        env = {"FAKE_MODE": mode, "FAKE_FINAL": final}
        r = rn.run_case(case, "s4", rep, "cc", arm, "m", env, None, tmp_path / "art")
        return r["passed"], json.loads((tmp_path / f"art/s4-{case['id']}-{rep}.verdict.json").read_text())  # fmt: skip

    # a final answer that states the term but asks nothing fails
    passed, v = run(0, "noop", f"Vou assumir {term} e seguir.")
    assert not passed and v["asked_question"] is False and v["workspace_clean"]
    # a question quoting a single ask_term passes: the terms are alternatives
    passed, v = run(1, "noop", f"Antes de seguir: {term}?")
    assert passed and v["matched_terms"] == [term.lower()] and v["workspace_clean"]
    # the same question after touching the tree fails
    passed, v = run(2, "edit", f"Antes de seguir: {term}?")
    assert not passed and v["asked_question"] and v["workspace_clean"] is False
    # a question that quotes no term fails
    passed, v = run(3, "noop", "Posso seguir?")
    assert not passed and v["matched_terms"] == []


def test_s4_outcome_fails_for_an_arm_that_only_returns_a_plan(tmp_path: Path) -> None:
    """check_oracles.py proves the no-op fails for every outcome case; this is the same fact through the scorer."""
    arm = script(tmp_path / "arm", CC_ARM)
    case = next(c for c in S4 if c["kind"] == "outcome")
    env = {"FAKE_MODE": "noop", "FAKE_FINAL": "Plano: 1. ler o código; 2. editar; 3. rodar os testes."}  # fmt: skip
    r = rn.run_case(case, "s4", 0, "cc", arm, "m", env, None, tmp_path / "art")
    v = json.loads((tmp_path / f"art/s4-{case['id']}-0.verdict.json").read_text())
    assert not r["passed"] and r["error"] is None and v["test_exit"] != 0
    assert (tmp_path / f"art/s4-{case['id']}-0.diff").read_text() == ""

"""Offline tests of the bench runners (case runner, parsers, budget): fake arms, no spend."""

import json
import shutil
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
    mp = rn.harbor_agent("my-pi", "m", Path("/hd"))
    assert "pi_harness_agent:PiHarnessAgent" in mp[0] and mp[1] == {"PYTHONPATH": "/hd"}
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
    rs, exhausted = rn.run_harbor([], jobs, "s2", {}, [["a"]], 5.0, make)
    assert len(rs) == 1 and not exhausted
    rs, _ = rn.run_harbor([], tmp_path / "empty", "s9", {}, [["q"]], 5.0, make)
    assert rs[0]["error"].startswith("harbor exit") and not rs[0]["passed"]


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

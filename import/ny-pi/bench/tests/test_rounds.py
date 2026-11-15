"""Offline tests of what reads finished rounds: gate and PR status, report, scoreboard, evidence. No spend."""

import json
from pathlib import Path
from typing import Any

import pytest

from bench import evidence as ev
from bench import gate as bg
from bench import report as rp
from bench import run as rb
from bench import runners as rn
from bench.tests.helpers import BENCH, CF, MP

SONNET = BENCH.parent / "docs/bench/baseline-vanilla-2026-11/sonnet"


def mk(
    task: str,
    rep: int,
    passed: bool,
    cost: float | None = 1.0,
    wall: float = 10.0,
    **kw: Any,
) -> dict[str, Any]:
    return rn.make_run(
        kw.pop("suite", "s1"), task, rep, passed, cost_usd=cost, wall_s=wall, **kw
    )


def write_round(d: Path, runs: list[dict[str, Any]], **meta: Any) -> Path:
    d.mkdir(parents=True, exist_ok=True)
    (d / "runs.jsonl").write_text("".join(json.dumps(r) + "\n" for r in runs))
    m = {
        "arm": "ny-pi",
        "model": "m",
        "arm_version": "v",
        "overlay_sha": "o",
        "git_sha": "abc",
        "budget_usd": 12,
    } | meta
    (d / "meta.json").write_text(json.dumps(m))
    return d


def tasks(n: int, fail: set[int] = frozenset(), **kw: Any) -> list[dict[str, Any]]:  # type: ignore[assignment]
    return [mk(f"t{i}", r, i not in fail, **kw) for i in range(n) for r in range(2)]


def test_gate_pass_and_summary(tmp_path: Path, monkeypatch: MP) -> None:
    base = write_round(
        tmp_path / "b", tasks(10) + [mk("h", 0, True, suite="s4", split="heldout")]
    )
    cand = write_round(
        tmp_path / "c", tasks(10) + [mk("h", 0, True, suite="s4", split="heldout")]
    )
    summary = tmp_path / "sum.md"
    monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(summary))
    monkeypatch.setattr(bg, "changed_paths", lambda *_: [])
    assert rb.main(["gate", "--base", str(base), "--cand", str(cand)]) == 0
    text = summary.read_text()
    assert (
        "## bench-pr: PASS" in text
        and "Held-out (separado" in text
        and "Pontuação D7" in text
    )
    assert json.loads((cand / "verdict.json").read_text())["verdict"] == "PASS"


def test_gate_fail_on_security_regression(tmp_path: Path, monkeypatch: MP) -> None:
    monkeypatch.setattr(bg, "changed_paths", lambda *_: [])
    b = [mk("sec1", r, True, security=True, suite="s1") for r in range(2)] + tasks(8)
    c = [mk("sec1", r, False, security=True, suite="s1") for r in range(2)] + tasks(8)
    v, md, code = bg.gate(
        write_round(tmp_path / "b", b), write_round(tmp_path / "c", c)
    )
    assert v["verdict"] == "FAIL" and code == 1 and "REGRESSÃO em sec1" in md
    assert v["score"] == 0.0


def test_gate_inconclusive_extends_once_then_fails(
    tmp_path: Path, monkeypatch: MP
) -> None:
    monkeypatch.setattr(bg, "changed_paths", lambda *_: [])
    base = write_round(tmp_path / "b", tasks(10))
    cand = write_round(tmp_path / "c", tasks(10, fail={0}))
    v, md, code = bg.gate(base, cand)
    assert v["verdict"] == "INCONCLUSIVE" and code == 3 and "estendido" not in md
    cmd = 'echo "$BENCH_EXTEND_SIDE:$BENCH_EXTEND_REPS:$BENCH_EXTEND_TASKS" >> "$BENCH_EXTEND_DIR/ext.log"; : > "$BENCH_EXTEND_OUT"'
    v, md, code = bg.gate(base, cand, cmd)
    assert v["verdict"] == "FAIL" and code == 1
    assert "estendido +3 reps do candidato" in md
    # the single extension adds 3 candidate reps; the frozen base is never re-run
    assert (cand / "ext.log").read_text().strip() == "cand:3:t0"
    assert not (base / "ext.log").exists()


def test_gate_confirms_a_single_security_failure(tmp_path: Path, monkeypatch: MP) -> None:  # fmt: skip
    monkeypatch.setattr(bg, "changed_paths", lambda *_: [])
    rows = [mk(f"t{i}", r, True, security=i == 0) for i in range(40) for r in range(3)]  # fmt: skip
    base = write_round(tmp_path / "b", rows)
    one = [r | {"passed": not (r["task_id"] == "t0" and r["rep"] == 0)} for r in rows]
    cand = write_round(tmp_path / "c", one)
    v, md, code = bg.gate(base, cand)
    assert v["verdict"] == "INCONCLUSIVE" and "a confirmar em t0" in md
    line = json.dumps(mk("t0", 9, True) | {"security": True})
    cmd = f'echo "$BENCH_EXTEND_TASKS" > "$BENCH_EXTEND_DIR/ext.log"; for i in 1 2 3; do echo \'{line}\' >> "$BENCH_EXTEND_OUT"; done'
    v, md, code = bg.gate(base, cand, cmd)
    assert v["verdict"] == "PASS" and code == 0 and "sem regressão" in md
    assert (
        cand / "ext.log"
    ).read_text().strip() == "t0"  # only the security task is re-run


def test_gate_pairs_k12_base_with_k3_candidate(tmp_path: Path, monkeypatch: MP) -> None:
    """The "precise" rule: base k12 (tier baseline), candidate k3, −10 pp on a 90% interval."""
    monkeypatch.setattr(bg, "changed_paths", lambda *_: [])
    base = write_round(tmp_path / "b", [mk(f"t{i}", r, True) for i in range(40) for r in range(12)])  # fmt: skip
    same = [mk(f"t{i}", r, True) for i in range(40) for r in range(3)]
    v, md, code = bg.gate(base, write_round(tmp_path / "c", same))
    assert v["verdict"] == "PASS" and code == 0 and v["n"] == 40
    assert "IC90 da diferença" in md and "margem -10 pp" in md
    # two flaky reps in 120 (−1.7 pp) stay inside the margin; ten tasks lost (−25 pp) do not
    flaky = [r | {"passed": not (r["task_id"] in ("t0", "t1") and r["rep"] == 0)} for r in same]  # fmt: skip
    assert bg.gate(base, write_round(tmp_path / "c2", flaky))[0]["verdict"] == "PASS"
    lost = [r | {"passed": int(r["task_id"][1:]) >= 10} for r in same]
    assert bg.gate(base, write_round(tmp_path / "c3", lost))[0]["verdict"] == "FAIL"


def test_old_rounds_without_the_new_records_still_load(
    tmp_path: Path, monkeypatch: MP
) -> None:
    monkeypatch.setattr(bg, "changed_paths", lambda *_: [])
    monkeypatch.setattr(ev, "S1_RESULTS", [tmp_path / "none"])
    old = SONNET / "ny-pi"  # frozen round recorded before tokens/turns existed
    assert "tokens" not in bg.load_round(old)[0][0]
    assert bg.gate(old, old)[2] == 0
    main = BENCH.parent / "docs/bench/baseline-main"
    assert bg.gate(main, main)[2] == 0
    dirs = [SONNET / "ny-pi", SONNET / "pi-vanilla"]
    assert "| ny-pi |" in rp.render(dirs)
    text = ev.render(ev.collect(dirs), "ny-pi")
    assert "## Failure signatures per arm" in text and "## Tokens and turns" not in text


def test_gate_extension_adds_data(tmp_path: Path, monkeypatch: MP) -> None:
    monkeypatch.setattr(bg, "changed_paths", lambda *_: [])
    base = write_round(tmp_path / "b", tasks(10))
    cand = write_round(tmp_path / "c", tasks(10, fail={0}))
    line = json.dumps(mk("t0", 2, True))
    v, _, _ = bg.gate(base, cand, f"echo '{line}' >> \"$BENCH_EXTEND_OUT\"")
    assert sum(1 for _ in (cand / "runs.ext.jsonl").read_text().splitlines()) == 1
    assert v["verdict"] in {"PASS", "FAIL"}


def test_gate_not_comparable_and_not_verified_and_refusals(
    tmp_path: Path, monkeypatch: MP
) -> None:
    monkeypatch.setattr(bg, "changed_paths", lambda *_: [])
    base = write_round(tmp_path / "b", tasks(6))
    v, md, code = bg.gate(base, write_round(tmp_path / "c1", tasks(6), model="other"))
    assert v["verdict"] == "NOT_COMPARABLE" and code == 4 and "Metadados diferem" in md
    v, md, code = bg.gate(
        base, write_round(tmp_path / "c2", tasks(6), not_verified=True)
    )
    assert v["verdict"] == "NOT_VERIFIED" and code == 5 and "nunca aprovado" in md
    refused = tasks(6) + [mk("ref", 0, False, error="refusal")]
    v, md, _ = bg.gate(
        write_round(tmp_path / "b3", refused), write_round(tmp_path / "c3", refused)
    )
    assert v["n"] == 6 and "Excluídas por recusa do provedor: ref" in md


def test_suite_ratio_for_plan_and_multi() -> None:
    b = [mk("p", 0, True, suite="s4"), mk("q", 0, True, suite="s4")]
    c = [mk("p", 0, True, suite="s4"), mk("q", 0, False, suite="s4")]
    assert bg.suite_ratio(b, c, "s4") == 0.5
    assert bg.suite_ratio(b, c, "s5") == 1.0
    assert bg.suite_ratio(c, b, "s4") == 1.0


def test_coverage_map_suggestions_ac8() -> None:
    cmap = json.loads((BENCH.parent / "docs/bench/coverage-map.json").read_text())
    assert bg.suggestions(["claude-home/hooks/guard.py"], cmap) == [
        "sugestão: re-testar vanilla para hooks"
    ]
    assert bg.suggestions(["extensions/plan-gate.ts"], cmap) == [
        "sugestão: re-testar vanilla para extensions"
    ]  # plan_mode is covered by S4; the generic extensions glob still matches
    assert bg.suggestions(["README.md"], cmap) == []
    assert (
        bg.suggestions(["claude-home/agents/x.md"], cmap) == []
    )  # subagents covered by S5
    assert bg.suggestions([], {}) == []


def test_gate_appends_suggestion_from_diff(tmp_path: Path, monkeypatch: MP) -> None:
    monkeypatch.setattr(
        bg, "changed_paths", lambda *_: ["claude-home/skills/x/SKILL.md"]
    )
    cmap = json.loads((BENCH.parent / "docs/bench/coverage-map.json").read_text())
    base = write_round(tmp_path / "b", tasks(6))
    _, md, _ = bg.gate(base, write_round(tmp_path / "c", tasks(6)), cmap=cmap)
    assert "sugestão: re-testar vanilla para skills" in md


def test_changed_paths_uses_git(tmp_path: Path) -> None:
    import subprocess

    def g(*a: str) -> str:
        return subprocess.run(
            ["git", "-C", str(tmp_path), "-c", "user.email=a@b", "-c", "user.name=n", *a],
            capture_output=True, text=True, check=True,
        ).stdout.strip()  # fmt: skip

    g("init", "-q", "-b", "main")
    (tmp_path / "a").write_text("1")
    g("add", "-A")
    g("commit", "-qm", "1")
    base = g("rev-parse", "HEAD")
    (tmp_path / "b").write_text("2")
    g("add", "-A")
    g("commit", "-qm", "2")
    assert bg.changed_paths(base, tmp_path) == ["b"]
    assert bg.changed_paths(None, tmp_path) == []


def test_post_status_owner_only() -> None:
    calls: list[list[str]] = []

    def gh(owner: str) -> Any:
        def f(args: list[str]) -> str:
            calls.append(args)
            if args[:2] == ["repo", "view"]:
                return json.dumps(
                    {"nameWithOwner": "me/ny-pi", "owner": {"login": "me"}}
                )
            if args[:2] == ["pr", "view"]:
                return json.dumps({"author": {"login": owner}, "headRefOid": "a" * 40})
            return ""

        return f

    assert bg.post_status(7, "success", "ok " * 100, gh("me")) == 0
    api = calls[-1]
    assert api[1] == f"repos/me/ny-pi/statuses/{'a' * 40}" and "context=bench-pr" in api
    assert (
        len(next(a for a in api if a.startswith("description=")))
        == len("description=") + 140
    )
    calls.clear()
    assert bg.post_status(7, "success", "ok", gh("stranger")) == 3
    assert not any(c[0] == "api" for c in calls)


def test_evidence_index(tmp_path: Path, monkeypatch: MP) -> None:
    pi_ev = '{"type":"tool_execution_start","toolName":"bash"}\n'
    cc_ev = '{"type":"tool_use","id":"t1","name":"Bash","input":{}}\n'
    a = write_round(
        tmp_path / "a",
        [mk("x", 0, True, suite="s4"), mk("tb", 0, True, suite="s2"), mk("c", 0, True)],
        arm="cc-vanilla",
    )
    b = write_round(
        tmp_path / "b",
        [
            mk("x", 0, False, suite="s4"),
            mk("tb", 0, False, suite="s2", error="boom"),
            mk("c", 0, False, cost=None),
        ],
        arm="ny-pi",
    )
    (a / "artifacts").mkdir()
    (a / "artifacts/s4-x-0.agent.out").write_text(cc_ev * 2)
    (a / "artifacts/s4-x-0.test.out").write_text("ok")
    for d, ev_text, log in ((a, cc_ev, "claude-code.txt"), (b, pi_ev, "pi.txt")):
        t = d / "harbor/s2-0/tb__abc"
        (t / "agent").mkdir(parents=True)
        (t / "verifier").mkdir()
        (t / "agent" / log).write_text(ev_text)
        (t / "verifier/reward.txt").write_text("1")
        (t / "result.json").write_text(json.dumps({"task_name": "terminal-bench/tb"}))
    (a / "harbor/s2-0/broken__z").mkdir()
    (a / "harbor/s2-0/broken__z/result.json").write_text("")  # an interrupted trial
    s1 = tmp_path / "evals/bench-ny-pi-vanilla-1"
    (s1 / "raw").mkdir(parents=True)
    (s1 / "unit/c-0").mkdir(parents=True)
    (s1 / "raw/c-0.jsonl").write_text(pi_ev * 3)
    monkeypatch.setattr(ev, "S1_RESULTS", [tmp_path / "evals"])
    out = tmp_path / "ev.md"
    args = ["evidence", "--runs", str(tmp_path / "[ab]"), "--out", str(out)]
    assert rb.main(args) == 0
    text = out.read_text()
    assert "### s4 x rep 0: pass cc-vanilla@m; fail ny-pi@m" in text
    assert "tools (2): Bash×2" in text and "s4-x-0.test.out" in text
    assert "### s2 tb rep 0" in text and "ERR" in text and "error: boom" in text
    assert "tb__abc/agent/pi.txt" in text and "reward.txt" in text
    assert "raw/c-0.jsonl" in text and "unit/c-0" in text and "bash×3" in text
    assert "| ny-pi@m | 3 | 4 | bash×4 |" in text
    assert ev.tool_seq(None) == [] and ev.tool_seq(tmp_path / "nope") == []
    # traceability: runs without a transcript are listed, and --strict turns them into a failure
    assert "- agent transcript on disk: 4/6 runs" in text
    assert "- NO TRANSCRIPT: s4 x rep 0 ny-pi@m" in text
    assert "- NO TRANSCRIPT: s1 c rep 0 cc-vanilla@m" in text
    assert rb.main([*args, "--strict"]) == 1
    # gaps of the focus arm, with the reference arm that passed
    assert "## Gaps of ny-pi@m" in text
    assert "| Failed where another arm passed | 1 |" in text
    assert (
        "| Infrastructure or agent error | 2 |" in text
    )  # a failure with no spend is infra
    assert "### Infrastructure or agent error: s2 tb rep 0" in text
    assert "- reference (cheapest passing arm):" in text
    assert "## Gaps of" not in ev.render(ev.collect([a, b]), None)


def test_evidence_explains_a_failed_run(tmp_path: Path, monkeypatch: MP) -> None:
    monkeypatch.setattr(ev, "S1_RESULTS", [tmp_path / "evals"])
    pi_ev = '{"type":"tool_execution_start","toolName":"%s"}\n'
    fin = json.dumps({"type": "message_end", "message": {"role": "assistant", "content": [
        {"type": "text", "text": "Here is the plan."}], "usage": {"cost": {"total": 0.3}}}})  # fmt: skip
    a = write_round(tmp_path / "a", [mk("x", 0, True, cost=0.1, suite="s4"), mk("y", 0, True, cost=0.1, suite="s4"),
                                     mk("z", 0, False, suite="s4"), mk("c", 0, True, cost=0.05)], arm="pi-vanilla")  # fmt: skip
    b = write_round(tmp_path / "b", [mk("x", 0, False, cost=0.3, suite="s4"), mk("y", 0, True, cost=0.4, suite="s4"),
                                     mk("z", 0, False, suite="s4"), mk("c", 0, True, cost=0.05)], arm="ny-pi")  # fmt: skip
    art = b / "artifacts"
    art.mkdir()
    (art / "s4-x-0.agent.out").write_text(pi_ev % "bash" + pi_ev % "bash" + pi_ev % "plan_mode_complete" + fin)  # fmt: skip
    (art / "s4-x-0.test.out").write_text("FAILED test_x - assert 1 == 2\n")
    (art / "s4-x-0.verdict.json").write_text(json.dumps({"check": "pytest -q", "test_exit": 1, "exit_code": 0}))  # fmt: skip
    (art / "s4-x-0.diff").write_text("")
    # two eval rounds hold the same case: the recorded cost picks the right transcript
    for arm, cost in (("pi-vanilla", 0.01), ("ny-pi", 0.05)):
        for i, c in enumerate((cost, 0.05)):
            raw = tmp_path / f"evals/bench-{arm}-vanilla-{i}/raw"
            raw.mkdir(parents=True)
            (raw / "c-0.jsonl").write_text(json.dumps({"type": "result", "total_cost_usd": c, "result": "r"}))  # fmt: skip
    text = ev.render(ev.collect([a, b]), "ny-pi")
    assert "### Failed where another arm passed: s4 x rep 0" in text
    assert "verdict: check=pytest -q, test_exit=1, exit_code=0" in text
    assert "tools (3): bash×2 → plan_mode_complete" in text
    assert "  - signature: plan-tool-then-stop" in text
    assert "final message: Here is the plan." in text
    assert "FAILED test_x - assert 1 == 2" in text and "s4-x-0.diff" in text
    assert "### Failed in every arm: s4 z rep 0" in text
    assert "### Passed, but over 1.5x the cheapest passing arm: s4 y rep 0" in text
    assert "bench-pi-vanilla-vanilla-1/raw/c-0.jsonl" in text
    assert "bench-ny-pi-vanilla-1/raw/c-0.jsonl" in text
    assert "- no verifier output: s4 y rep 0 ny-pi@m" in text


def test_report_tables(tmp_path: Path, capsys: CF) -> None:
    a = write_round(
        tmp_path / "r1",
        tasks(4) + [mk("sec", 0, True, security=True, subagents_used=True)],
        arm="cc-vanilla",
    )
    b = write_round(
        tmp_path / "r2",
        tasks(4, fail={0}) + [mk("e", 0, False, error="boom", suite="s4")],
        arm="ny-pi",
        not_verified=True,
    )
    out = tmp_path / "rep.md"
    assert rb.main(["report", "--runs", str(tmp_path / "r*"), "--out", str(out)]) == 0
    text = out.read_text()
    assert (
        "## s1" in text and "## s4" in text and "cc-vanilla" in text and "ny-pi" in text
    )
    assert "| 1/1 |" in text  # security cell
    x = rp.suite_row([mk("t", 0, True)])
    assert x["rate"] == 1.0 and x["sec"] == "-" and x["errors"] == 0
    assert rp.suite_row([])["rate"] is None and rp._f(None, 2) == "n/a"
    assert a.exists() and b.exists()


def test_scoreboard_goal_met_by_accuracy_and_cost(tmp_path: Path, capsys: CF) -> None:
    def rnd(name: str, fail: set[int], cost: float, extra: list[dict[str, Any]] | None = None) -> Path:  # fmt: skip
        return write_round(tmp_path / name, tasks(6, fail, cost=cost) + (extra or []), arm=name)  # fmt: skip

    # the errored task and the one only ny ran are left out of every comparison
    ny = rnd("ny-pi", set(), 1.0, [mk("solo", 0, True), mk("bad", 0, False, error="boom")])  # fmt: skip
    pi = rnd("pi-vanilla", {0}, 0.2, [mk("bad", 0, True)])
    cc = rnd("cc-vanilla", {0}, 1.5, [mk("bad", 0, True)])
    data, md = rp.scoreboard(ny, [pi, cc])
    assert data["r1"] and data["r2"] and data["met"]
    assert data["exclusive"] == ["t0"] and data["inverse"] == []
    assert [x["n"] for x in data["rows"]] == [6, 6]
    assert data["rows"][0]["diff"] == pytest.approx(1 / 6)
    assert data["rows"][1]["cost_ratio"] == pytest.approx(1 / 1.5)
    assert "## R1 acerto: cumprida" in md and "## R2 teto de custo: cumprida" in md
    assert "| pi-vanilla | 6.0000 | 1.2000 | 5.00 | não (informativo) |" in md
    assert "- Só o ny-pi resolve: t0" in md and "OBJETIVO: cumprido\n" in md
    out = tmp_path / "placar.md"
    args = ["scoreboard", "--ny", str(ny), "--refs", str(pi), str(cc), "--out", str(out)]  # fmt: skip
    assert rb.main(args) == 0 and out.read_text() == md
    assert "OBJETIVO: cumprido" in capsys.readouterr().out


def test_scoreboard_rules_fail_one_by_one(tmp_path: Path) -> None:
    def rnd(name: str, fail: set[int], cost: float) -> Path:
        return write_round(tmp_path / name, tasks(6, fail, cost=cost), arm=name)

    # dearer than cc but one exclusive task: the exception rule (R3) stands in for the cost ceiling (R2)
    ny, pi = rnd("ny-pi", set(), 2.0), rnd("pi-vanilla", {0}, 0.2)
    data, md = rp.scoreboard(ny, [pi, rnd("cc-vanilla", {0}, 1.0)])
    assert data["r1"] and not data["r2"] and data["exclusive"] == ["t0"] and data["met"]
    # cc solves t0: no exclusive task left, so the dearer ny misses the goal on R2 and R3
    data, md = rp.scoreboard(ny, [pi, rnd("cc2", set(), 1.0)])
    assert data["r1"] and not data["met"] and "OBJETIVO: não cumprido (R2, R3)" in md
    # no round of the pi-vanilla arm: R1 cannot be evaluated and counts as not met
    data, md = rp.scoreboard(rnd("ny2", {1}, 0.1), [rnd("other", set(), 0.2)])
    assert data["r1"] is False and data["r2"] and "Sem rodada do pi-vanilla" in md
    # below pi-vanilla: R1 fails whatever the cost; the inverse list names the task only ny fails
    low = write_round(tmp_path / "low", tasks(6, {1}, cost=0.1), arm="ny-pi")
    data, md = rp.scoreboard(low, [write_round(tmp_path / "p", tasks(6, cost=0.2), arm="pi-vanilla")])  # fmt: skip
    assert not data["r1"] and not data["r2"] and data["inverse"] == ["t1"]
    assert "OBJETIVO: não cumprido (R1, R2, R3)" in md and "Sem outra referência" in md


def test_scoreboard_of_the_frozen_sonnet_baseline() -> None:
    """Today's state of the goal (rounds of 2026-11): below pi-vanilla, dearer than cc-vanilla, no exclusive task."""
    refs = [SONNET / a for a in ("pi-vanilla", "cc-vanilla", "omp")]
    data, md = rp.scoreboard(SONNET / "ny-pi", refs)
    assert not data["r1"] and not data["r2"] and data["exclusive"] == []
    assert not data["met"] and "OBJETIVO: não cumprido (R1, R2, R3)" in md
    by = {x["arm"]: x for x in data["rows"]}
    assert by["pi-vanilla"]["n"] == 42 and by["pi-vanilla"]["diff"] < 0
    assert by["cc-vanilla"]["cost_ratio"] > 1 > by["omp"]["cost_ratio"]


def test_signature_rules() -> None:
    def sig(seq: list[str], verdict: dict[str, Any], passed: bool = False, error: str | None = None) -> str:  # fmt: skip
        return ev.signature({"passed": passed, "error": error}, seq, verdict)

    failed_tests = {"check": "pytest", "test_exit": 1}
    assert sig([], {}, error="infra: no model spend") == "infra-error"
    assert sig(["bash"], failed_tests, error="exit 1") == "infra-error"
    assert sig(["bash"], {}, error="timeout") == "timeout"
    assert sig([], {}, error="AgentTimeoutError: 900 s") == "timeout"
    assert sig(["edit"], {"test_exit": 0}, passed=True) == "pass"
    assert sig(["read", "edit", "plan_mode_complete"], failed_tests) == "plan-tool-then-stop"  # fmt: skip
    assert sig(["plan_mode_complete", "edit"], failed_tests) == "tests-failed"
    ask = {"check": "ask", "asked_question": False, "workspace_clean": True}
    assert sig(["read", "question"], ask) == "question-tool-error"
    assert sig(["read", "question"], ask | {"asked_question": True}) == "unclassified"
    assert (
        sig(["read"], ask) == "unclassified"
    )  # no question tool: a plain missing question
    assert sig([], failed_tests) == "no-change"
    assert sig(["read", "grep", "Read"], failed_tests) == "no-change"
    for tool in ("edit", "Write", "bash", "Bash", "subagent", "Task"):
        assert sig(["read", tool], failed_tests) == "tests-failed", tool
    assert sig(["bash"], {}) == "unclassified"  # S1/Harbor: no verdict file
    assert set(ev.SIGNATURES) >= {sig([], failed_tests), sig([], {}), sig([], {}, error="x")}  # fmt: skip


def test_evidence_signatures_and_per_run_records(
    tmp_path: Path, monkeypatch: MP
) -> None:
    monkeypatch.setattr(ev, "S1_RESULTS", [tmp_path / "evals"])
    tok = {"input": 10, "output": 20, "cache_read": 30, "cache_write": 40}
    new: dict[str, Any] = {"tokens": tok, "turns": 4, "tool_errors": 1, "first_request_tokens": 80}  # fmt: skip
    a = write_round(tmp_path / "a", [mk("x", 0, True, suite="s4"), mk("y", 0, True, suite="s4")], arm="pi-vanilla")  # fmt: skip
    b = write_round(
        tmp_path / "b",
        [mk("x", 0, False, suite="s4", **new), mk("y", 0, False, suite="s4", error="timeout"),
         mk("z", 0, False, suite="s4", cost=None)],
        arm="ny-pi",
    )  # fmt: skip
    art = b / "artifacts"
    art.mkdir()
    (art / "s4-x-0.agent.out").write_text('{"type":"tool_execution_start","toolName":"read"}\n')  # fmt: skip
    (art / "s4-x-0.verdict.json").write_text(json.dumps({"check": "pytest", "test_exit": 1}))  # fmt: skip
    # a round recorded before the per-run records: they come from the transcript
    usage = {"input": 1, "output": 2, "cacheRead": 3, "cacheWrite": 4}
    msg = {"type": "message_end", "message": {"role": "assistant", "content": [], "usage": usage}}  # fmt: skip
    (a / "artifacts").mkdir()
    (a / "artifacts/s4-x-0.agent.out").write_text(json.dumps(msg) + "\n")
    rows = ev.collect([a, b])
    text = ev.render(rows, "ny-pi")
    assert {(r["arm"], r["task_id"]): r["sig"] for r in rows} == {
        ("pi-vanilla@m", "x"): "pass", ("pi-vanilla@m", "y"): "pass",
        ("ny-pi@m", "x"): "no-change", ("ny-pi@m", "y"): "timeout", ("ny-pi@m", "z"): "infra-error",
    }  # fmt: skip
    assert "| arm | failed | infra-error | timeout | plan-tool-then-stop |" in text
    assert "| ny-pi@m | 3 | 1 | 1 | 0 | 0 | 1 | 0 | 0 |" in text
    assert "| pi-vanilla@m | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |" in text
    gaps = text.split("## Gaps of ny-pi@m")[1].split("## Matrix")[0]
    assert gaps.count("  - signature: ") == 3 and "  - signature: no-change" in gaps
    assert "| ny-pi@m | 1 | 10.0 | 20.0 | 30.0 | 40.0 | 4.0 | 1.0 | 80.0 |" in text
    assert "| pi-vanilla@m | 1 | 1.0 | 2.0 | 3.0 | 4.0 | 1.0 | 0.0 | 8.0 |" in text

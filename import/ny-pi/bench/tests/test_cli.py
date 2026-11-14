"""Offline tests of the bench CLI (dry-run, gate, report, status, coverage map): no network, no spend."""

import json
import os
from pathlib import Path
from typing import Any

import pytest

from bench import report as rp
from bench import run as rb
from bench import runners as rn
from bench.tests.helpers import (
    BENCH,
    CC_ARM,
    CF,
    MP,
    RA,
    make_case,
    script,
)


def cfg_with(case_dir: Path) -> dict[str, Any]:
    cfg = rb.load_toml(BENCH / "suites.toml")
    cfg["suite"]["s4"]["dir"] = str(case_dir)
    return cfg


def test_dry_run_all_arms_and_tiers(capsys: CF) -> None:
    for arm in ("cc-vanilla", "pi-vanilla", "my-pi"):
        for tier in ("pr", "vanilla", "full"):
            assert rb.main(RA(arm, "--dry-run", tier=tier, budget="12")) == 0
    out = capsys.readouterr().out
    assert "estimated total" in out and "nothing was executed" in out
    assert (
        "WARNING: estimate exceeds the budget" in out
    )  # full tier is far above US$ 12


def test_dry_run_counts_cases_and_suite_filter(tmp_path: Path) -> None:
    make_case(tmp_path, "a")
    make_case(tmp_path, "b", split="heldout")
    steps = rb.build_plan("pr", cfg_with(tmp_path), ["s4", "s1"], k=2)
    assert {s["suite"]: s["units"] for s in steps} == {"s1": 16, "s4": 2}
    assert all(s["k"] == 2 for s in steps)
    assert "units=  2" in rb.render_plan("my-pi", "pr", "m", 12.0, steps)


def test_harbor_plan_uses_task_file(tmp_path: Path, monkeypatch: MP) -> None:
    cfg = rb.load_toml(BENCH / "suites.toml")
    (tmp_path / "tasks").mkdir()
    (tmp_path / "tasks/tb2.json").write_text(json.dumps([f"t{i}" for i in range(20)]))
    monkeypatch.setattr(rb, "BENCH", tmp_path)
    steps = rb.build_plan("pr", cfg, ["s2"])
    assert steps[0]["units"] == 4 and len(steps[0]["tasks"]) == 4


def make_arms(tmp_path: Path, body: str) -> dict[str, Any]:
    script(tmp_path / "farm", body)
    return {
        "fake": {"runner": "run.py", "bin": str(tmp_path / "farm"), "version": "v0"}
    }


def test_budget_stops_and_marks_not_verified(tmp_path: Path, monkeypatch: MP) -> None:
    """AC6: at 0.4 US$ per run and a 1.0 budget the run stops after the 3rd run, never completes."""
    make_case(tmp_path / "cases", "a")
    make_case(tmp_path / "cases", "b")
    cfg = cfg_with(tmp_path / "cases")
    steps = rb.build_plan("pr", cfg, ["s4"], k=3)
    out = tmp_path / "out"
    code = rb.execute("fake", "pr", "m", 1.0, steps, make_arms(tmp_path, CC_ARM), out)
    assert code == rb.NOT_VERIFIED_EXIT
    meta = json.loads((out / "meta.json").read_text())
    runs = [json.loads(x) for x in (out / "runs.jsonl").read_text().splitlines()]
    assert (
        meta["not_verified"]
        and len(runs) == 3
        and meta["cost_usd"] == pytest.approx(1.2)
    )
    assert meta["arm_version"] == "fake 1.0" and "overlay_sha" not in meta


def test_execute_completes_within_budget(tmp_path: Path) -> None:
    make_case(tmp_path / "cases", "a")
    steps = rb.build_plan("pr", cfg_with(tmp_path / "cases"), ["s4"], k=1)
    code = rb.execute(
        "fake", "pr", "m", 5.0, steps, make_arms(tmp_path, CC_ARM), tmp_path / "o"
    )
    assert code == 0
    assert json.loads((tmp_path / "o/meta.json").read_text())["not_verified"] is False


def test_execute_zero_budget_is_not_verified(tmp_path: Path) -> None:
    make_case(tmp_path / "cases", "a")
    steps = rb.build_plan("pr", cfg_with(tmp_path / "cases"), ["s4"], k=1)
    assert (
        rb.execute(
            "fake", "pr", "m", 0.0, steps, make_arms(tmp_path, CC_ARM), tmp_path / "o"
        )
        == 5
    )


def test_execute_s1_and_harbor_steps(
    tmp_path: Path, fake_evals: Path, monkeypatch: MP
) -> None:
    fake = script(
        tmp_path / "harbor",
        f"""
job=""; while [ $# -gt 0 ]; do case "$1" in --job-name) job=$2; shift;; esac; shift; done
d={tmp_path}/o/harbor/$job/t__x; mkdir -p "$d"
echo '{{"task_name":"tb","verifier_result":{{"rewards":{{"reward":1.0}}}},"agent_result":{{"cost_usd":0.3}}}}' > "$d/result.json"
""",
    )
    monkeypatch.setenv("BENCH_HARBOR", str(fake))
    monkeypatch.setattr(rb, "oauth_token", lambda: "tok")
    cfg = rb.load_toml(BENCH / "suites.toml")
    steps = rb.build_plan("pr", cfg, ["s1", "s2"], k=1)
    code = rb.execute(
        "fake", "pr", "m", 10.0, steps, make_arms(tmp_path, CC_ARM), tmp_path / "o"
    )
    assert code == 0
    suites = {
        json.loads(x)["suite"]
        for x in (tmp_path / "o/runs.jsonl").read_text().splitlines()
    }
    assert suites == {"s1", "s2"}


def test_main_run_requires_credentials(monkeypatch: MP) -> None:
    monkeypatch.delenv("BENCH_CC_CREDENTIALS", raising=False)
    with pytest.raises(SystemExit) as e:
        rb.main(RA("my-pi"))
    assert e.value.code == 2
    with pytest.raises(SystemExit):
        rb.main(RA("nope"))


def test_main_real_run_dispatches_execute(tmp_path: Path, monkeypatch: MP) -> None:
    monkeypatch.setenv("BENCH_CC_CREDENTIALS", "/x")
    seen: dict[str, Any] = {}
    monkeypatch.setattr(rb, "execute", lambda *a: seen.update(a=a) or 0)
    assert rb.main(RA("my-pi", "--out", str(tmp_path))) == 0
    assert seen["a"][0] == "my-pi" and seen["a"][6] == tmp_path
    rb.main(RA("my-pi"))
    assert str(seen["a"][6]).startswith("/tmp/bench-my-pi-pr-")


def test_arm_info_and_overlay_sha(tmp_path: Path, monkeypatch: MP) -> None:
    arms = rb.load_toml(BENCH / "arms.toml")
    assert (
        rb.arm_info("cc-vanilla", arms)[0] == "cc"
        and rb.arm_info("my-pi", arms)[0] == "pi"
    )
    stage = tmp_path / "bench-mypi-abc123-dirty"
    stage.mkdir()
    (stage / ".overlay-sha").write_text("deadbeef\n")
    monkeypatch.setenv("TMPDIR", str(tmp_path))
    assert rb.overlay_sha("abc123") == "deadbeef"
    assert rb.overlay_sha("zzz") is None
    monkeypatch.setenv("BENCH_STAGE", str(stage))
    assert rb.overlay_sha("zzz") == "deadbeef"
    sha = rb.arm_meta(
        "my-pi", {"my-pi": {"version": "v"}}, "pi", Path("/nonexistent/bin"), "m", 1.0
    )
    assert (
        sha["arm_version"] == "v"
        and sha["overlay_sha"] == "deadbeef"
        and sha["model"] == "m"
    )


def mk(
    task: str, rep: int, passed: bool, cost: float = 1.0, wall: float = 10.0, **kw: Any
) -> dict[str, Any]:
    return rn.make_run(
        kw.pop("suite", "s1"), task, rep, passed, cost_usd=cost, wall_s=wall, **kw
    )


def write_round(d: Path, runs: list[dict[str, Any]], **meta: Any) -> Path:
    d.mkdir(parents=True, exist_ok=True)
    (d / "runs.jsonl").write_text("".join(json.dumps(r) + "\n" for r in runs))
    m = {
        "arm": "my-pi",
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
    monkeypatch.setattr(rb, "changed_paths", lambda *_: [])
    assert rb.main(["gate", "--base", str(base), "--cand", str(cand)]) == 0
    text = summary.read_text()
    assert (
        "## bench-pr: PASS" in text
        and "Held-out (separado" in text
        and "Pontuação D7" in text
    )
    assert json.loads((cand / "verdict.json").read_text())["verdict"] == "PASS"


def test_gate_fail_on_security_regression(tmp_path: Path, monkeypatch: MP) -> None:
    monkeypatch.setattr(rb, "changed_paths", lambda *_: [])
    b = [mk("sec1", r, True, security=True, suite="s1") for r in range(2)] + tasks(8)
    c = [mk("sec1", r, False, security=True, suite="s1") for r in range(2)] + tasks(8)
    v, md, code = rb.gate(
        write_round(tmp_path / "b", b), write_round(tmp_path / "c", c)
    )
    assert v["verdict"] == "FAIL" and code == 1 and "REGRESSÃO em sec1" in md
    assert v["score"] == 0.0


def test_gate_inconclusive_extends_once_then_fails(
    tmp_path: Path, monkeypatch: MP
) -> None:
    monkeypatch.setattr(rb, "changed_paths", lambda *_: [])
    base = write_round(tmp_path / "b", tasks(10))
    cand = write_round(tmp_path / "c", tasks(10, fail={0}))
    v, md, code = rb.gate(base, cand)
    assert v["verdict"] == "INCONCLUSIVE" and code == 3 and "estendido" not in md
    cmd = 'echo "$BENCH_EXTEND_SIDE:$BENCH_EXTEND_REPS:$BENCH_EXTEND_TASKS" >> "$BENCH_EXTEND_DIR/ext.log"; : > "$BENCH_EXTEND_OUT"'
    v, md, code = rb.gate(base, cand, cmd)
    assert v["verdict"] == "FAIL" and code == 1 and "estendido +2 reps" in md
    assert (base / "ext.log").read_text().strip() == "base:2:t0"
    assert (cand / "ext.log").read_text().strip() == "cand:2:t0"


def test_gate_extension_adds_data(tmp_path: Path, monkeypatch: MP) -> None:
    monkeypatch.setattr(rb, "changed_paths", lambda *_: [])
    base = write_round(tmp_path / "b", tasks(10))
    cand = write_round(tmp_path / "c", tasks(10, fail={0}))
    line = json.dumps(mk("t0", 2, True))
    v, _, _ = rb.gate(base, cand, f"echo '{line}' >> \"$BENCH_EXTEND_OUT\"")
    assert sum(1 for _ in (cand / "runs.ext.jsonl").read_text().splitlines()) == 1
    assert v["verdict"] in {"PASS", "FAIL"}


def test_gate_not_comparable_and_not_verified_and_refusals(
    tmp_path: Path, monkeypatch: MP
) -> None:
    monkeypatch.setattr(rb, "changed_paths", lambda *_: [])
    base = write_round(tmp_path / "b", tasks(6))
    v, md, code = rb.gate(base, write_round(tmp_path / "c1", tasks(6), model="other"))
    assert v["verdict"] == "NOT_COMPARABLE" and code == 4 and "Metadados diferem" in md
    v, md, code = rb.gate(
        base, write_round(tmp_path / "c2", tasks(6), not_verified=True)
    )
    assert v["verdict"] == "NOT_VERIFIED" and code == 5 and "nunca aprovado" in md
    refused = tasks(6) + [mk("ref", 0, False, error="refusal")]
    v, md, _ = rb.gate(
        write_round(tmp_path / "b3", refused), write_round(tmp_path / "c3", refused)
    )
    assert v["n"] == 6 and "Excluídas por recusa do provedor: ref" in md


def test_suite_ratio_for_plan_and_multi() -> None:
    b = [mk("p", 0, True, suite="s4"), mk("q", 0, True, suite="s4")]
    c = [mk("p", 0, True, suite="s4"), mk("q", 0, False, suite="s4")]
    assert rb.suite_ratio(b, c, "s4") == 0.5
    assert rb.suite_ratio(b, c, "s5") == 1.0
    assert rb.suite_ratio(c, b, "s4") == 1.0


def test_coverage_map_suggestions_ac8() -> None:
    cmap = json.loads((BENCH.parent / "docs/bench/coverage-map.json").read_text())
    assert rb.suggestions(["claude-home/hooks/guard.py"], cmap) == [
        "sugestão: re-testar vanilla para hooks"
    ]
    assert rb.suggestions(["extensions/plan-gate.ts"], cmap) == [
        "sugestão: re-testar vanilla para extensions"
    ]  # plan_mode is covered by S4; the generic extensions glob still matches
    assert rb.suggestions(["README.md"], cmap) == []
    assert (
        rb.suggestions(["claude-home/agents/x.md"], cmap) == []
    )  # subagents covered by S5
    assert rb.suggestions([], {}) == []


def test_gate_appends_suggestion_from_diff(tmp_path: Path, monkeypatch: MP) -> None:
    monkeypatch.setattr(
        rb, "changed_paths", lambda *_: ["claude-home/skills/x/SKILL.md"]
    )
    cmap = json.loads((BENCH.parent / "docs/bench/coverage-map.json").read_text())
    base = write_round(tmp_path / "b", tasks(6))
    _, md, _ = rb.gate(base, write_round(tmp_path / "c", tasks(6)), cmap=cmap)
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
    assert rb.changed_paths(base, tmp_path) == ["b"]
    assert rb.changed_paths(None, tmp_path) == []


def test_post_status_owner_only() -> None:
    calls: list[list[str]] = []

    def gh(owner: str) -> Any:
        def f(args: list[str]) -> str:
            calls.append(args)
            if args[:2] == ["repo", "view"]:
                return json.dumps(
                    {"nameWithOwner": "me/pi-harness", "owner": {"login": "me"}}
                )
            if args[:2] == ["pr", "view"]:
                return json.dumps({"author": {"login": owner}, "headRefOid": "a" * 40})
            return ""

        return f

    assert rb.post_status(7, "success", "ok " * 100, gh("me")) == 0
    api = calls[-1]
    assert (
        api[1] == f"repos/me/pi-harness/statuses/{'a' * 40}"
        and "context=bench-pr" in api
    )
    assert (
        len(next(a for a in api if a.startswith("description=")))
        == len("description=") + 140
    )
    calls.clear()
    assert rb.post_status(7, "success", "ok", gh("stranger")) == 3
    assert not any(c[0] == "api" for c in calls)


def test_report_tables(tmp_path: Path, capsys: CF) -> None:
    a = write_round(
        tmp_path / "r1",
        tasks(4) + [mk("sec", 0, True, security=True, subagents_used=True)],
        arm="cc-vanilla",
    )
    b = write_round(
        tmp_path / "r2",
        tasks(4, fail={0}) + [mk("e", 0, False, error="boom", suite="s4")],
        arm="my-pi",
        not_verified=True,
    )
    out = tmp_path / "rep.md"
    assert rb.main(["report", "--runs", str(tmp_path / "r*"), "--out", str(out)]) == 0
    text = out.read_text()
    assert (
        "## s1" in text and "## s4" in text and "cc-vanilla" in text and "my-pi" in text
    )
    assert "| 1/1 |" in text  # security cell
    x = rp.suite_row([mk("t", 0, True)])
    assert x["rate"] == 1.0 and x["sec"] == "-" and x["errors"] == 0
    assert rp.suite_row([])["rate"] is None and rp._f(None, 2) == "n/a"
    assert a.exists() and b.exists()


def test_probe_flags(tmp_path: Path, capsys: CF) -> None:
    script(
        tmp_path / "cc",
        "echo '--output-format --max-budget-usd --resume --mcp-config'\n",
    )
    script(tmp_path / "pi", "echo '--mode --skill --resume'\n")
    arms = {
        "cc-vanilla": {"runner": "run.py", "bin": str(tmp_path / "cc")},
        "pi-vanilla": {"runner": "run_pi.py", "bin": str(tmp_path / "pi")},
    }
    caps = rb.load_toml(BENCH / "capabilities.toml")
    t = rb.probe(arms, caps)
    assert "sonda ok --output-format" in t and "sonda FALHOU --agents" in t
    arms["cc-vanilla"]["bin"] = "/nonexistent"
    assert "sonda: não executada" in rb.probe(arms, caps)
    assert rb.main(["probe"]) == 0
    assert "headless_json" in capsys.readouterr().out


def test_capabilities_schema_and_docs_urls() -> None:
    caps = rb.load_toml(BENCH / "capabilities.toml")
    assert len(caps) >= 16
    for name, row in caps.items():
        for arm in ("cc-vanilla", "pi-vanilla", "my-pi"):
            assert row[arm]["value"] and row[arm]["url"].startswith("https://"), (
                name,
                arm,
            )
        assert row["cc-vanilla"]["url"].startswith("https://code.claude.com/")


def test_suites_toml_tiers_are_consistent() -> None:
    cfg = rb.load_toml(BENCH / "suites.toml")
    s1 = cfg["suite"]["s1"]
    assert set(s1["pr_cases"]) <= set(s1["cases"]) and len(s1["cases"]) == 32
    assert sum(c.startswith("sec-") for c in s1["pr_cases"]) == sum(
        c.startswith("sec-") for c in s1["cases"]
    )
    assert set(cfg["tier"]) == {"pr", "full", "vanilla"}
    assert os.access(BENCH / "tools/micro.sh", os.X_OK)

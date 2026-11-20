"""Offline tests of the bench CLI (dry-run, run, probe, tiers): no network, no spend. Gate, report and evidence
are in test_rounds.py."""

import json
import os
import shutil
from pathlib import Path
from typing import Any

import pytest

from bench import gate as bg
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
    for arm in ("cc-vanilla", "pi-vanilla", "ny-pi"):
        for tier in ("pr", "baseline", "vanilla", "full"):
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
    assert "units=  2" in rb.render_plan("ny-pi", "pr", "m", 12.0, steps)


def test_tasks_filter_keeps_only_named_tasks(tmp_path: Path) -> None:
    make_case(tmp_path, "a")
    make_case(tmp_path, "b")
    steps = rb.build_plan("pr", cfg_with(tmp_path), k=3, tasks=["a", "sec-refuse-rm-rf"])  # fmt: skip
    assert {s["suite"]: s["units"] for s in steps} == {
        "s1": 1,
        "s4": 1,
    }  # s2, s5 dropped
    assert steps[0]["tasks"] == ["sec-refuse-rm-rf"]


def test_extension_runs_named_tasks_and_appends(tmp_path: Path, monkeypatch: MP) -> None:  # fmt: skip
    """`run --extension` is the gate's --extend-with-cmd hook (bench-pr.sh)."""
    seen: dict[str, Any] = {}

    def fake(arm: str, tier: str, model: str, budget: float, steps: list[Any], arms: Any, out: Path, *_: Any) -> int:  # fmt: skip
        seen.update(k=steps[0]["k"], tasks=steps[0]["tasks"], suites=[s["suite"] for s in steps])  # fmt: skip
        out.mkdir(parents=True)
        (out / "runs.jsonl").write_text('{"task_id": "sec-refuse-rm-rf"}\n')
        return 0

    monkeypatch.setattr(rb, "execute", fake)
    monkeypatch.setattr(rb, "oauth_token", lambda: "t")
    ext = tmp_path / "runs.ext.jsonl"
    ext.write_text('{"old": 1}\n')
    for k, v in {"BENCH_EXTEND_TASKS": "sec-refuse-rm-rf", "BENCH_EXTEND_REPS": "3", "BENCH_EXTEND_DIR": str(tmp_path),
                 "BENCH_EXTEND_OUT": str(ext), "BENCH_CC_CREDENTIALS": "x", "BENCH_MIN_FREE_GB": "0"}.items():  # fmt: skip
        monkeypatch.setenv(k, v)
    assert rb.main(RA("ny-pi", "--extension", tier="pr", budget="6")) == 0
    assert seen == {"k": 3, "tasks": ["sec-refuse-rm-rf"], "suites": ["s1"]}
    assert ext.read_text().splitlines() == ['{"old": 1}', '{"task_id": "sec-refuse-rm-rf"}']  # fmt: skip


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


def test_ny_pi_harbor_bundles_the_checkout_stage(
    tmp_path: Path, monkeypatch: MP
) -> None:
    """Harbor must ship the stage of this checkout, never the live ~/.pi (bug found 2026-11-14)."""
    stage = tmp_path / "stage"
    stage.mkdir()
    (stage / ".overlay-sha").write_text("abc")
    (stage / ".ready").touch()
    hd = tmp_path / "hd"
    hd.mkdir()
    script(hd / "bundle.sh", f'echo "$HOME" > {tmp_path}/bundled_home\n')
    harbor = script(tmp_path / "harbor", "exit 0\n")
    monkeypatch.setenv("BENCH_HARBOR", str(harbor))
    monkeypatch.setenv("BENCH_STAGE", str(stage))
    monkeypatch.setattr(rb, "HARBOR_DIR", hd)
    monkeypatch.setattr(rb, "oauth_token", lambda: "tok")
    steps = rb.build_plan("pr", rb.load_toml(BENCH / "suites.toml"), ["s2"], k=1)
    rb._harbor_step(steps[0], "ny-pi", "m", tmp_path / "o", 5.0)
    assert (tmp_path / "bundled_home").read_text().strip() == str(stage)


def test_ny_pi_harbor_bundle_is_per_round(tmp_path: Path, monkeypatch: MP) -> None:
    """Two arms at once must not share one bundle path: each round bundles into its own out dir."""
    stage = tmp_path / "stage"
    stage.mkdir()
    (stage / ".overlay-sha").write_text("abc")
    (stage / ".ready").touch()
    hd = tmp_path / "hd"
    hd.mkdir()
    script(hd / "bundle.sh", f'echo "$1" >> {tmp_path}/bundle_args\n')
    harbor = script(
        tmp_path / "harbor", f'echo "$PI_HARNESS_BUNDLE" >> {tmp_path}/env_seen\n'
    )
    monkeypatch.setenv("BENCH_HARBOR", str(harbor))
    monkeypatch.setenv("BENCH_STAGE", str(stage))
    monkeypatch.setattr(rb, "HARBOR_DIR", hd)
    monkeypatch.setattr(rb, "oauth_token", lambda: "tok")
    steps = rb.build_plan("pr", rb.load_toml(BENCH / "suites.toml"), ["s2"], k=1)
    outs = [tmp_path / "o1", tmp_path / "o2"]
    for o in outs:
        rb._harbor_step(steps[0], "ny-pi", "m", o, 5.0)
    want = [str(o / "pi-harness-bundle.tgz") for o in outs]
    assert (tmp_path / "bundle_args").read_text().split() == want
    assert set((tmp_path / "env_seen").read_text().split()) == set(want)


def test_ny_pi_harbor_refuses_without_stage(tmp_path: Path, monkeypatch: MP) -> None:
    monkeypatch.delenv("BENCH_STAGE", raising=False)
    monkeypatch.setenv("BENCH_STAGE_ROOT", str(tmp_path / "none"))
    monkeypatch.setattr(rb, "oauth_token", lambda: "tok")
    steps = rb.build_plan("pr", rb.load_toml(BENCH / "suites.toml"), ["s2"], k=1)
    with pytest.raises(RuntimeError, match="stage"):
        rb._harbor_step(steps[0], "ny-pi", "m", tmp_path / "o", 5.0)


def test_main_run_requires_credentials(monkeypatch: MP) -> None:
    monkeypatch.delenv("BENCH_CC_CREDENTIALS", raising=False)
    with pytest.raises(SystemExit) as e:
        rb.main(RA("ny-pi"))
    assert e.value.code == 2
    with pytest.raises(SystemExit):
        rb.main(RA("nope"))


def creds(tmp_path: Path, minutes: float) -> str:
    import time

    f = tmp_path / "creds.json"
    exp = (time.time() + minutes * 60) * 1000
    f.write_text(json.dumps({"claudeAiOauth": {"accessToken": "t", "expiresAt": exp}}))
    return str(f)


def test_main_run_refuses_expiring_token_before_any_run(
    tmp_path: Path, monkeypatch: MP
) -> None:
    """Baseline 2026-11-14: a token near expiry made every arm fail silently (cost 0, passed False)."""
    monkeypatch.setenv("BENCH_CC_CREDENTIALS", creds(tmp_path, 10))
    monkeypatch.setattr(rb, "execute", lambda *a: pytest.fail("ran with a dying token"))
    with pytest.raises(SystemExit) as e:
        rb.main(RA("ny-pi", "--out", str(tmp_path / "o")))
    assert e.value.code == 2


def test_execute_flags_all_zero_cost_step_as_infra(tmp_path: Path) -> None:
    """A step whose every run failed at cost 0 is an infra failure, never a measured score."""
    make_case(tmp_path / "cases", "a")
    make_case(tmp_path / "cases", "b")
    steps = rb.build_plan("pr", cfg_with(tmp_path / "cases"), ["s4"], k=1)
    dead = '[ "$1" = "--version" ] && { echo "fake 1.0"; exit 0; }\nexit 1\n'
    out = tmp_path / "o"
    code = rb.execute("fake", "pr", "m", 5.0, steps, make_arms(tmp_path, dead), out)
    meta = json.loads((out / "meta.json").read_text())
    assert code == rb.NOT_VERIFIED_EXIT and meta["not_verified"]
    assert any("infra" in e for e in meta["errors"])


def test_main_real_run_dispatches_execute(tmp_path: Path, monkeypatch: MP) -> None:
    monkeypatch.setenv("BENCH_CC_CREDENTIALS", creds(tmp_path, 120))
    seen: dict[str, Any] = {}
    monkeypatch.setattr(rb, "execute", lambda *a: seen.update(a=a) or 0)
    assert rb.main(RA("ny-pi", "--out", str(tmp_path))) == 0
    assert seen["a"][0] == "ny-pi" and seen["a"][6] == tmp_path
    rb.main(RA("ny-pi"))
    assert str(seen["a"][6]).startswith("/tmp/bench-ny-pi-pr-")


def test_arm_info_and_overlay_sha(tmp_path: Path, monkeypatch: MP) -> None:
    arms = rb.load_toml(BENCH / "arms.toml")
    assert (
        rb.arm_info("cc-vanilla", arms)[0] == "cc"
        and rb.arm_info("ny-pi", arms)[0] == "pi"
    )
    stage = tmp_path / "bench-nypi-abc123-dirty"
    stage.mkdir()
    (stage / ".overlay-sha").write_text("deadbeef\n")
    monkeypatch.setenv("BENCH_STAGE_ROOT", str(tmp_path))
    # A build that failed halfway leaves .overlay-sha but no .ready: not a stage, and the round stops before any
    # run (timer gate of 2026-11-15: 52 runs raced to rebuild it; NOT_VERIFIED came 20 minutes later).
    assert rb.overlay_sha("abc123") is None
    monkeypatch.setenv("BENCH_STAGE", str(stage))
    arm = script(tmp_path / "arm", "echo 'install: ERROR: npm ci failed' >&2\nexit 1\n")
    with pytest.raises(
        RuntimeError, match="stage not built: install: ERROR: npm ci failed"
    ):
        rb.arm_meta("ny-pi", {"ny-pi": {}}, "pi", arm, "m", 1.0)
    monkeypatch.delenv("BENCH_STAGE")
    (stage / ".ready").touch()
    assert rb.overlay_sha("abc123") == "deadbeef"
    assert rb.overlay_sha("zzz") is None
    monkeypatch.setenv("BENCH_STAGE", str(stage))
    assert rb.overlay_sha("zzz") == "deadbeef"
    sha = rb.arm_meta(
        "ny-pi", {"ny-pi": {"version": "v"}}, "pi", Path("/nonexistent/bin"), "m", 1.0
    )
    assert (
        sha["arm_version"] == "v"
        and sha["overlay_sha"] == "deadbeef"
        and sha["model"] == "m"
    )


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
        for arm in ("cc-vanilla", "pi-vanilla", "ny-pi"):
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
    assert set(cfg["tier"]) == {
        "pr",
        "smoke",
        "baseline",
        "full",
        "vanilla",
        "tb41",
        "hard",
    }

    def ks(tier: str) -> dict[str, int]:
        return {st["suite"]: st["k"] for st in cfg["tier"][tier]["steps"]}

    def units(tier: str) -> list[dict[str, Any]]:
        return [{k: v for k, v in st.items() if k not in ("k", "k_security")} for st in cfg["tier"][tier]["steps"]]  # fmt: skip

    # the sequential gate: look 1 at k1 (security k3) against a k12 base over the same units (bench/stats.py, MARGIN)
    assert ks("pr") == {"s1": 1, "s4": 1, "s5": 1, "s2": 1}
    assert ks("baseline") == {"s1": 12, "s4": 12, "s5": 12, "s2": 4}
    assert units("baseline") == units("pr")
    # the hard suite runs on demand only: PR gate time and cost must stay flat
    assert ks("hard") == {"s8": 3} and cfg["suite"]["s8"]["dir"] == "suites/hard"
    assert all("s8" not in ks(t) for t in ("pr", "baseline", "vanilla"))
    tb41 = json.loads((BENCH / cfg["suite"]["s6"]["tasks_file"]).read_text())
    assert len(tb41["tasks"]) == 6 and len(tb41["dropped"]) == 6
    assert all(t.startswith("terminal-bench/") for t in tb41["tasks"])
    assert not set(tb41["tasks"]) & set(tb41["dropped"])
    assert os.access(BENCH / "tools/micro.sh", os.X_OK)


def test_ny_pi_stage_default_is_outside_tmp() -> None:
    """The eval sandbox mounts a private tmpfs on /tmp: a stage there is invisible and is rebuilt per session."""
    arm = (BENCH / "arms/ny-pi").read_text()
    assert "/tmp" not in next(ln for ln in arm.splitlines() if ln.startswith("stage="))
    assert "BENCH_STAGE_ROOT" in arm
    # Version-manager shims resolve through $HOME; the arm pins them to the real HOME before staging one.
    assert arm.index("MISE_DATA_DIR") < arm.index('if [ ! -f "$stage/.ready" ]')


def two_suite_cfg(tmp_path: Path, n: int, k: int = 1) -> list[rb.Step]:
    for i in range(n):
        make_case(tmp_path / "s4", f"a{i}")
    make_case(tmp_path / "s5", "z")
    cfg = cfg_with(tmp_path / "s4")
    cfg["suite"]["s5"]["dir"] = str(tmp_path / "s5")
    return rb.build_plan("full", cfg, ["s4", "s5"], k=k)


DEAD = '[ "$1" = "--version" ] && { echo "fake 1.0"; exit 0; }\nexit 1\n'


def read_runs(out: Path) -> list[dict[str, Any]]:
    return [json.loads(x) for x in (out / "runs.jsonl").read_text().splitlines()]


def test_execute_stops_run_after_stage_over_ten_percent_errors(tmp_path: Path) -> None:
    steps = two_suite_cfg(tmp_path, 2)
    out = tmp_path / "o"
    code = rb.execute("fake", "full", "m", 9.0, steps, make_arms(tmp_path, DEAD), out)
    meta = json.loads((out / "meta.json").read_text())
    assert code == rb.NOT_VERIFIED_EXIT and meta["not_verified"]
    assert {r["suite"] for r in read_runs(out)} == {"s4"}  # s5 never started
    assert any("s4" in e and "error" in e for e in meta["errors"])


def test_execute_case_stage_stops_after_five_infra_in_a_row(tmp_path: Path) -> None:
    steps = two_suite_cfg(tmp_path, 8)
    out = tmp_path / "o"
    rb.execute("fake", "full", "m", 9.0, steps, make_arms(tmp_path, DEAD), out)
    assert len(read_runs(out)) == 5


def test_execute_resume_keeps_valid_runs_and_reruns_errors(tmp_path: Path) -> None:
    steps = two_suite_cfg(tmp_path, 2)
    out = tmp_path / "o"
    out.mkdir()
    ok = rn.make_run("s4", "a0", 0, True, cost_usd=0.4)
    bad = rn.make_run("s4", "a1", 0, False)
    (out / "runs.jsonl").write_text("".join(json.dumps(r) + "\n" for r in (ok, bad)))
    arms = make_arms(tmp_path, CC_ARM)
    code = rb.execute("fake", "full", "m", 9.0, steps, arms, out, resume=True)
    runs = read_runs(out)
    assert code == 0 and not any(r["error"] for r in runs)
    assert sorted((r["suite"], r["task_id"]) for r in runs) == [
        ("s4", "a0"), ("s4", "a1"), ("s5", "z"),
    ]  # fmt: skip
    assert json.loads((out / "meta.json").read_text())["cost_usd"] == pytest.approx(1.2)


def test_execute_without_resume_truncates(tmp_path: Path) -> None:
    steps = two_suite_cfg(tmp_path, 1)
    out = tmp_path / "o"
    out.mkdir()
    (out / "runs.jsonl").write_text(
        json.dumps(rn.make_run("s4", "old", 0, True)) + "\n"
    )
    rb.execute("fake", "full", "m", 9.0, steps, make_arms(tmp_path, CC_ARM), out)
    assert "old" not in {r["task_id"] for r in read_runs(out)}


def test_harbor_step_skips_done_units(tmp_path: Path, monkeypatch: MP) -> None:
    rec = tmp_path / "argv"
    monkeypatch.setenv(
        "BENCH_HARBOR", str(script(tmp_path / "h", f'echo "$@" >> {rec}\n'))
    )
    monkeypatch.setattr(rb, "oauth_token", lambda: "tok")
    s: rb.Step = {
        "suite": "s2", "k": 1, "st": {}, "tasks": ["a", "b"],
        "cfg": {"dataset": "ds", "seed": 1, "heldout_pct": 10},
    }  # fmt: skip
    rb._harbor_step(s, "pi-vanilla", "m", tmp_path / "o", 5.0, {("s2", "a", 0)})
    argv = rec.read_text()
    assert "-i b" in argv and "-i a" not in argv
    rec.unlink()
    assert rb._harbor_step(
        s, "pi-vanilla", "m", tmp_path / "o", 5.0, {("s2", "a", 0), ("s2", "b", 0)}
    ) == ([], False)
    assert not rec.exists()  # nothing left: no `harbor run` over the whole dataset


def test_harbor_step_omp_fetches_release_first(tmp_path: Path, monkeypatch: MP) -> None:
    rec = tmp_path / "argv"
    monkeypatch.setenv(
        "BENCH_HARBOR", str(script(tmp_path / "h", f'echo "$@" >> {rec}\n'))
    )
    monkeypatch.setattr(rb, "oauth_token", lambda: "tok")
    hd = tmp_path / "hd"
    hd.mkdir()
    (hd / "omp-release.sh").write_text(f"echo fetched >> {rec}\n")
    monkeypatch.setattr(rb, "HARBOR_DIR", hd)
    s: rb.Step = {
        "suite": "s2", "k": 1, "st": {}, "tasks": ["a"],
        "cfg": {"dataset": "ds", "seed": 1, "heldout_pct": 10},
    }  # fmt: skip
    s["cfg"]["agent_timeout_multiplier"] = 0.125
    rb._harbor_step(s, "omp", "m", tmp_path / "o", 5.0)
    lines = rec.read_text().splitlines()
    assert lines[0] == "fetched" and "omp_agent:OmpAgent" in lines[1]
    assert "--agent-timeout-multiplier 0.125" in lines[1]


def test_main_run_refuses_low_disk(monkeypatch: MP, capsys: CF) -> None:
    monkeypatch.setenv("BENCH_MIN_FREE_GB", "30")
    monkeypatch.setattr(
        shutil,
        "disk_usage",
        lambda p: shutil._ntuple_diskusage(100 * 2**30, 99 * 2**30, 5 * 2**30),
    )
    with pytest.raises(SystemExit) as e:
        rb.main(RA("ny-pi"))
    assert e.value.code == 2
    err = capsys.readouterr().err
    assert "BENCH_MIN_FREE_GB" in err and "5.0" in err
    rb.main(RA("ny-pi", "--dry-run"))  # dry-run never checks the disk


def test_main_run_passes_resume_flag(tmp_path: Path, monkeypatch: MP) -> None:
    monkeypatch.setenv("BENCH_CC_CREDENTIALS", creds(tmp_path, 120))
    seen: dict[str, Any] = {}
    monkeypatch.setattr(rb, "execute", lambda *a: seen.update(a=a) or 0)
    rb.main(RA("ny-pi", "--out", str(tmp_path), "--resume"))
    assert seen["a"][7] is True
    with pytest.raises(SystemExit):
        rb.main(RA("ny-pi", "--resume"))  # nothing to resume without --out


def test_execute_parallel_runs_suites_and_units_together(
    tmp_path: Path, monkeypatch: MP
) -> None:
    import threading

    for c in ("a", "b"):
        make_case(tmp_path / "cases", c)
    cfg = cfg_with(tmp_path / "cases")
    cfg["suite"]["s5"]["dir"] = str(tmp_path / "cases")
    steps = rb.build_plan("pr", cfg, ["s4", "s5"], k=1)
    gate = threading.Barrier(
        4, timeout=20
    )  # passes only when the 4 units of both suites are in flight at once

    def fake(case: dict[str, Any], suite: str, rep: int, *_: Any) -> dict[str, Any]:
        gate.wait()
        return dict(rn.make_run(suite, case["id"], rep, True, cost_usd=0.1, wall_s=1.0))

    monkeypatch.setattr(rn, "run_case", fake)
    out = tmp_path / "o"
    code = rb.execute(
        "fake", "pr", "m", 5.0, steps, make_arms(tmp_path, CC_ARM), out, jobs=2
    )
    runs, meta = bg.load_round(out)
    assert code == 0 and len(runs) == 4 and meta["jobs"] == 2
    assert meta["cost_usd"] == pytest.approx(0.4)
    monkeypatch.setattr(rb, "execute", lambda *a: a[8])
    monkeypatch.setenv("BENCH_CC_CREDENTIALS", creds(tmp_path, 120))
    assert rb.main(RA("ny-pi", "--out", str(out), "--jobs", "6")) == 6


def test_execute_stage_with_no_rows_is_not_verified(
    tmp_path: Path, monkeypatch: MP
) -> None:
    """D4: S1 returning ([], error) used to leave meta not_verified=False and exit 0."""
    monkeypatch.setattr(
        rn, "run_s1", lambda *a, **k: ([], "infra: no results dir (exit 1)")
    )
    monkeypatch.setattr(rn, "s1_case_reps", lambda cases, k: {c: k for c in cases})
    steps: list[rb.Step] = [
        {"suite": "s1", "kind": "internal", "k": 3, "tasks": ["a", "b"]}
    ]
    out = tmp_path / "o"
    code = rb.execute("fake", "pr", "m", 5.0, steps, make_arms(tmp_path, DEAD), out)
    meta = json.loads((out / "meta.json").read_text())
    assert code == rb.NOT_VERIFIED_EXIT and meta["not_verified"]

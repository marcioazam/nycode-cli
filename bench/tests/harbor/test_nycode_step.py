"""Harbor step for the nycode arm (S2): agent flags, per-round bundle of the checkout stage, no fall-through to ny-pi."""

from pathlib import Path

import pytest

from bench import run as rb
from bench import runners as rn
from bench.tests.helpers import BENCH, MP, script


def _stage(tmp_path: Path) -> Path:
    stage = tmp_path / "stage"
    stage.mkdir()
    (stage / ".overlay-sha").write_text("abc")
    (stage / ".ready").touch()
    return stage


def test_harbor_agent_flags_for_nycode() -> None:
    flags, env, tok = rn.harbor_agent("nycode", "claude-sonnet-5-5", Path("/hd"))
    assert flags == [
        "-a",
        "nycode_agent:NycodeAgent",
        "-m",
        "anthropic/claude-sonnet-5-5",
    ]
    assert env == {"PYTHONPATH": "/hd"} and tok == "ANTHROPIC_OAUTH_TOKEN"


def test_nycode_harbor_dir_is_bench_harbor_and_holds_the_agent() -> None:
    assert rb.NYCODE_HARBOR_DIR == BENCH / "harbor"
    assert (rb.NYCODE_HARBOR_DIR / "nycode_agent.py").is_file()
    assert (rb.NYCODE_HARBOR_DIR / "bundle.sh").stat().st_mode & 0o111


def test_nycode_step_bundles_the_stage_and_runs_the_nycode_agent(
    tmp_path: Path, monkeypatch: MP
) -> None:
    stage, hd = _stage(tmp_path), tmp_path / "hd"
    hd.mkdir()
    script(hd / "bundle.sh", f'echo "$HOME $1" > {tmp_path}/bundled\n')
    seen = tmp_path / "seen"
    seen.mkdir()
    # One file per call: _harbor_step runs one `harbor run` per task in parallel, and a shared file raced
    # (CI run 44842931760 read the tail of a longer argv line as the env line).
    harbor = script(
        tmp_path / "harbor",
        f'echo "$@" > {seen}/$$; echo "$NYCODE_HARNESS_BUNDLE|$PYTHONPATH|$ANTHROPIC_OAUTH_TOKEN|${{PI_HARNESS_BUNDLE:-}}" >> {seen}/$$\n',
    )
    monkeypatch.setenv("BENCH_HARBOR", str(harbor))
    monkeypatch.setenv("BENCH_STAGE", str(stage))
    monkeypatch.setattr(rb, "NYCODE_HARBOR_DIR", hd)
    monkeypatch.setattr(rb, "oauth_token", lambda: "tok")
    steps = rb.build_plan("pr", rb.load_toml(BENCH / "suites.toml"), ["s2"], k=1)
    out = tmp_path / "o"
    rb._harbor_step(steps[0], "nycode", "m", out, 5.0)
    bundle = out / "nycode-harness-bundle.tgz"
    assert (tmp_path / "bundled").read_text().split() == [str(stage), str(bundle)]
    calls = [f.read_text().splitlines() for f in seen.iterdir()]
    assert len(calls) == len(steps[0]["tasks"])  # one harbor run per task
    for argv, env in calls:
        assert "-a nycode_agent:NycodeAgent" in argv and "pi_harness_agent" not in argv
        assert env == f"{bundle}|{hd}|tok|"  # the ny-pi bundle variable stays unset


def test_nycode_step_refuses_without_stage(tmp_path: Path, monkeypatch: MP) -> None:
    monkeypatch.delenv("BENCH_STAGE", raising=False)
    monkeypatch.setenv("BENCH_STAGE_ROOT", str(tmp_path / "none"))
    monkeypatch.setenv("BENCH_STAGE_PREFIX", "bench-nycode")
    monkeypatch.setattr(rb, "oauth_token", lambda: "tok")
    steps = rb.build_plan("pr", rb.load_toml(BENCH / "suites.toml"), ["s2"], k=1)
    with pytest.raises(RuntimeError, match="nycode stage"):
        rb._harbor_step(steps[0], "nycode", "m", tmp_path / "o", 5.0)

"""BENCH_API_KEY_FILE: every arm bills an API key instead of the plan OAuth (arms in test_api_key_mode_arms)."""

from pathlib import Path

import pytest

from bench import run as rb
from bench.tests.helpers import BENCH, MP, RA, script


def _boom() -> str:
    raise AssertionError("oauth_token must not be called")


def _step(tmp_path: Path, monkeypatch: MP, arm: str) -> Path:
    """Run one harbor step with a fake harbor that dumps its env; return the dump."""
    stage = tmp_path / "stage"
    stage.mkdir()
    (stage / ".overlay-sha").write_text("abc")
    (stage / ".ready").touch()
    hd = tmp_path / "hd"
    hd.mkdir()
    script(hd / "bundle.sh", "exit 0\n")
    script(hd / "pi_bundle.sh", "exit 0\n")
    dump = tmp_path / "env_dump"
    harbor = script(tmp_path / "harbor", f"env > {dump}\n")
    monkeypatch.setenv("BENCH_HARBOR", str(harbor))
    monkeypatch.setenv("BENCH_STAGE", str(stage))
    monkeypatch.setattr(rb, "HARBOR_DIR", hd)
    steps = rb.build_plan("pr", rb.load_toml(BENCH / "suites.toml"), ["s2"], k=1)
    rb._harbor_step(steps[0], arm, "m", tmp_path / "o", 5.0)
    return dump


@pytest.fixture
def keyfile(tmp_path: Path, monkeypatch: MP) -> Path:
    f = tmp_path / "key"
    f.write_text("sk-ant-api-xyz\n")
    monkeypatch.setenv("BENCH_API_KEY_FILE", str(f))
    return f


def test_api_mode_env(tmp_path: Path, monkeypatch: MP, keyfile: Path) -> None:
    monkeypatch.setattr(rb, "oauth_token", _boom)
    monkeypatch.setenv("BENCH_ANTHROPIC_WORKSPACE_ID", "wrkspc_1")
    monkeypatch.setenv("ANTHROPIC_OAUTH_TOKEN", "leak")
    env = _step(tmp_path, monkeypatch, "ny-pi").read_text().splitlines()
    assert "ANTHROPIC_API_KEY=sk-ant-api-xyz" in env
    assert "ANTHROPIC_WORKSPACE_ID=wrkspc_1" in env
    assert not any(e.startswith("ANTHROPIC_OAUTH_TOKEN=") for e in env)


def test_without_variable_keeps_oauth(tmp_path: Path, monkeypatch: MP) -> None:
    monkeypatch.delenv("BENCH_API_KEY_FILE", raising=False)
    monkeypatch.setattr(rb, "oauth_token", lambda: "tok")
    env = _step(tmp_path, monkeypatch, "ny-pi").read_text().splitlines()
    assert "ANTHROPIC_OAUTH_TOKEN=tok" in env


@pytest.mark.parametrize("content", [None, "  \n"])
def test_missing_or_empty_key_file_is_explicit_error(tmp_path: Path, monkeypatch: MP, content: str | None) -> None:  # fmt: skip
    f = tmp_path / "k"
    if content is not None:
        f.write_text(content)
    monkeypatch.setenv("BENCH_API_KEY_FILE", str(f))
    with pytest.raises(RuntimeError, match="BENCH_API_KEY_FILE"):
        _step(tmp_path, monkeypatch, "ny-pi")


def _main(monkeypatch: MP, arm: str) -> int:
    monkeypatch.setattr(rb, "execute", lambda *a, **k: 0)
    monkeypatch.setattr(rb, "oauth_token", _boom)
    monkeypatch.delenv("BENCH_CC_CREDENTIALS", raising=False)
    monkeypatch.setenv("BENCH_MIN_FREE_GB", "0")
    return rb.main(RA(arm, tier="pr", budget="6"))


def test_preflight_accepts_api_mode_without_credentials(monkeypatch: MP, keyfile: Path) -> None:  # fmt: skip
    assert _main(monkeypatch, "ny-pi") == 0


def test_preflight_rejects_empty_key_file(monkeypatch: MP, keyfile: Path) -> None:
    keyfile.write_text("\n")
    with pytest.raises(SystemExit):
        _main(monkeypatch, "ny-pi")


@pytest.mark.parametrize("arm", ["cc-vanilla", "pi-vanilla"])
def test_preflight_accepts_api_mode_for_vanilla_arms(monkeypatch: MP, keyfile: Path, arm: str) -> None:  # fmt: skip
    assert _main(monkeypatch, arm) == 0

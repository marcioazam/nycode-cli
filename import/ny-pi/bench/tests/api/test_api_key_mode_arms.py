"""API-key mode covers every arm: cc-vanilla via ANTHROPIC_API_KEY + custom header, pi-vanilla via a header-merging agent."""

from pathlib import Path

from bench import run as rb
from bench import runners as rn
from bench.tests.api.test_api_key_mode import _boom, _step, keyfile  # noqa: F401
from bench.tests.helpers import MP

HD = Path("/hd")
HDR = "ANTHROPIC_CUSTOM_HEADERS=anthropic-workspace-id: wrkspc_1"


def test_cc_api_mode_agent_flags() -> None:
    args, extra, _ = rn.harbor_agent(
        "cc-vanilla", "m", HD, api=True, workspace="wrkspc_1"
    )
    assert args[:2] == ["-a", "claude-code"]
    assert args[args.index("--ae") + 1] == HDR
    assert "CLAUDE_FORCE_OAUTH" not in extra


def test_cc_api_mode_without_workspace_has_no_header() -> None:
    args, extra, _ = rn.harbor_agent("cc-vanilla", "m", HD, api=True)
    assert "--ae" not in args and "CLAUDE_FORCE_OAUTH" not in extra


def test_pi_vanilla_api_mode_uses_subclass() -> None:
    args, extra, _ = rn.harbor_agent("pi-vanilla", "m", HD, api=True)
    assert (
        "pi_vanilla_api_agent:PiVanillaApiAgent" in args
        and "version=1.5.2" in " ".join(args)
    )
    assert extra == {"PYTHONPATH": "/hd"}


def test_non_api_mode_unchanged() -> None:
    args, extra, tok = rn.harbor_agent("pi-vanilla", "m", HD)
    assert args[:2] == ["-a", "pi"] and extra == {} and tok == "ANTHROPIC_OAUTH_TOKEN"
    args, extra, tok = rn.harbor_agent("cc-vanilla", "m", HD)
    assert extra == {"CLAUDE_FORCE_OAUTH": "1"} and "--ae" not in args


def test_cc_step_env_in_api_mode(tmp_path: Path, monkeypatch: MP, keyfile: Path) -> None:  # fmt: skip # noqa: F811
    monkeypatch.setattr(rb, "oauth_token", _boom)
    monkeypatch.setenv("BENCH_ANTHROPIC_WORKSPACE_ID", "wrkspc_1")
    monkeypatch.setenv("CLAUDE_CODE_OAUTH_TOKEN", "leak")
    monkeypatch.setenv("ANTHROPIC_OAUTH_TOKEN", "leak")
    env = _step(tmp_path, monkeypatch, "cc-vanilla").read_text().splitlines()
    assert "ANTHROPIC_API_KEY=sk-ant-api-xyz" in env
    assert not any(e.startswith(("CLAUDE_FORCE_OAUTH=", "CLAUDE_CODE_OAUTH_TOKEN=", "ANTHROPIC_OAUTH_TOKEN=")) for e in env)  # fmt: skip


def test_pi_vanilla_step_runs_with_workspace(tmp_path: Path, monkeypatch: MP, keyfile: Path) -> None:  # fmt: skip # noqa: F811
    monkeypatch.setenv("BENCH_ANTHROPIC_WORKSPACE_ID", "wrkspc_1")
    env = _step(tmp_path, monkeypatch, "pi-vanilla").read_text().splitlines()
    assert "ANTHROPIC_WORKSPACE_ID=wrkspc_1" in env and "PYTHONPATH=" + str(tmp_path / "hd") in env  # fmt: skip

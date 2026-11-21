"""pi_vanilla_api_agent without Harbor: after the stock install it merges the workspace header into the default pi dir."""

import asyncio
import json
import shutil
import subprocess
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from bench.tests.harbor.stubs import import_agent


class _Pi:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

    async def install(self, environment: Any) -> None:
        self.calls.append(("base", "install"))

    async def exec_as_agent(self, environment: Any, command: str, env: Any = None, cwd: Any = None, timeout_sec: Any = None) -> None:  # fmt: skip
        self.calls.append(("agent", command))


pi_vanilla_api_agent: Any = (
    None  # set by the module fixture below, against stubbed harbor modules
)


@pytest.fixture(scope="module", autouse=True)
def _agent_module() -> Iterator[None]:
    global pi_vanilla_api_agent
    with import_agent(_Pi, "pi_harness_agent", "pi_vanilla_api_agent") as (
        _,
        pi_vanilla_api_agent,
    ):
        yield


def _install() -> list[tuple[str, str]]:
    agent = pi_vanilla_api_agent.PiVanillaApiAgent()
    asyncio.run(agent.install(object()))
    calls: list[tuple[str, str]] = agent.calls
    return calls


def test_install_runs_stock_install_then_merges(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ANTHROPIC_WORKSPACE_ID", "wrkspc_x'; rm -rf /")
    calls = _install()
    assert calls[0] == ("base", "install")
    cmd = calls[1][1]
    assert "anthropic-workspace-id" in cmd and "models.json" in cmd
    assert "'wrkspc_x'\"'\"'; rm -rf /'" in cmd  # shlex-quoted, never bare
    assert (
        '"$HOME/.pi/agent"' in cmd
    )  # pi's default dir: no PI_CODING_AGENT_DIR for plain -m anthropic/<model>


def test_no_workspace_skips_merge(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ANTHROPIC_WORKSPACE_ID", raising=False)
    assert _install() == [("base", "install")]


def test_merge_writes_header_under_home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:  # fmt: skip
    monkeypatch.setenv("ANTHROPIC_WORKSPACE_ID", "w1")
    cmd = _install()[1][1]
    assert subprocess.run(["bash", "-c", cmd], env={"HOME": str(tmp_path), "PATH": f"{Path(shutil.which('node') or '').parent}:/usr/bin:/bin"}, check=False).returncode == 0  # fmt: skip
    d = json.loads((tmp_path / ".pi/agent/models.json").read_text())
    assert d["providers"]["anthropic"]["headers"] == {"anthropic-workspace-id": "w1"}


def test_merge_has_no_python3(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANTHROPIC_WORKSPACE_ID", "w1")
    assert "python3" not in _install()[1][1]


def _print_cmd(instruction: str) -> str:
    import shlex

    return (
        ". ~/.nvm/nvm.sh; mkdir -p /l && pi --print --mode json --session-dir /l "
        f"--model m --thinking high {shlex.quote(instruction)} "
        "2>&1 </dev/null | grep -v x | stdbuf -oL tee /o"
    )


@pytest.mark.parametrize("instr", ["- You are given X", 'it\'s a "b" task', "plain"])
def test_print_command_gets_dashdash(instr: str) -> None:
    import shlex

    agent = pi_vanilla_api_agent.PiVanillaApiAgent()
    asyncio.run(agent.exec_as_agent(object(), command=_print_cmd(instr)))
    cmd = agent.calls[0][1]
    assert f"--thinking high -- {shlex.quote(instr)} 2>&1 </dev/null | grep" in cmd


def test_other_commands_untouched() -> None:
    agent = pi_vanilla_api_agent.PiVanillaApiAgent()
    asyncio.run(agent.exec_as_agent(object(), command="echo hi"))
    assert agent.calls[0][1] == "echo hi"

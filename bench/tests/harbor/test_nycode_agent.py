"""NycodeAgent (bench/harbor/nycode_agent.py) without Harbor or network: the generated install/run commands and env."""

import asyncio
import importlib
import json
import subprocess
import sys
import types
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from bench.tests.helpers import BENCH, MP

HOME = "/opt/nycode-home"
CLI = f"{HOME}/.local/lib/nycode/dist/bundle/cli.js"
HARBOR_NVM = (
    "curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.2/install.sh | env -u NODE_VERSION bash && "
    'export NVM_DIR="$HOME/.nvm" && \\. "$NVM_DIR/nvm.sh" || true && '
    "command -v nvm &>/dev/null || { echo 'Error: NVM failed to load' >&2; exit 1; } && "
    "nvm install 22 && nvm alias default 22 && npm -v"
)


class _Pi:
    """Stand-in for harbor's Pi: records exec calls; run() builds the command line the real base builds."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, str, dict[str, str] | None]] = []

    async def exec_as_agent(
        self,
        environment: Any,
        command: str,
        env: Any = None,
        cwd: Any = None,
        timeout_sec: Any = None,
    ) -> None:
        self.calls.append(("agent", command, env))

    async def exec_as_root(self, environment: Any, command: str) -> None:
        self.calls.append(("root", command, None))

    async def run(self, instruction: str, environment: Any, context: Any) -> None:
        import shlex

        await self.exec_as_agent(
            environment,
            command=(
                ". ~/.nvm/nvm.sh; mkdir -p /logs/pi/sessions && "
                "pi --print --mode json --session-dir /logs/pi/sessions "
                f"--provider anthropic --model m {shlex.quote(instruction)} "
                "2>&1 </dev/null | tee /logs/pi.txt"
            ),
            env={"ANTHROPIC_OAUTH_TOKEN": "tok"},
        )


class _Env:
    def __init__(self) -> None:
        self.uploads: list[tuple[Path, str]] = []

    async def upload_file(self, src: Path, dst: str) -> None:
        self.uploads.append((src, dst))


@pytest.fixture(scope="module")
def na() -> Iterator[Any]:
    """The module under test, imported against stubbed harbor modules; nothing leaks into sys.modules."""
    with pytest.MonkeyPatch.context() as mp:
        for n in (
            "harbor",
            "harbor.agents",
            "harbor.agents.installed",
            "harbor.environments",
        ):
            mp.setitem(sys.modules, n, types.ModuleType(n))
        stubs: dict[str, dict[str, Any]] = {
            "harbor.agents.installed.pi": {"Pi": _Pi},
            "harbor.agents.installed.node_install": {
                "nvm_node_install_snippet": lambda: "NVM"
            },
            "harbor.environments.base": {"BaseEnvironment": object},
        }
        for n, attrs in stubs.items():
            m = types.ModuleType(n)
            m.__dict__.update(attrs)
            mp.setitem(sys.modules, n, m)
        mp.syspath_prepend(str(BENCH / "harbor"))
        sys.modules.pop("nycode_agent", None)
        yield importlib.import_module("nycode_agent")
    sys.modules.pop("nycode_agent", None)


def _install(na: Any, tmp_path: Path, monkeypatch: MP, **env: str) -> tuple[Any, _Env]:
    bundle = tmp_path / "b.tgz"
    bundle.write_bytes(b"x")
    monkeypatch.setenv("NYCODE_HARNESS_BUNDLE", str(bundle))
    monkeypatch.delenv("ANTHROPIC_WORKSPACE_ID", raising=False)
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    agent, e = na.NycodeAgent(), _Env()
    asyncio.run(agent.install(e))
    return agent, e


def test_name_is_nycode(na: Any) -> None:
    assert (
        na.NycodeAgent.name() == "nycode"
        and na.NycodeAgent().get_version_command() is None
    )


def test_install_ships_the_bundle_to_opt_nycode_home(
    na: Any, tmp_path: Path, monkeypatch: MP
) -> None:
    agent, env = _install(na, tmp_path, monkeypatch)
    assert env.uploads == [(tmp_path / "b.tgz", "/tmp/nycode-harness-bundle.tgz")]
    kinds = [k for k, _, _ in agent.calls]
    assert kinds == ["root", "root", "agent"]  # deps, extract, then node as the agent
    deps, extract = agent.calls[0][1], agent.calls[1][1]
    assert "curl tar" in deps and "python3" not in deps and "patch" not in deps
    assert f"tar -xzf /tmp/nycode-harness-bundle.tgz -C {HOME}" in extract
    assert extract.endswith(f"chmod -R a+rwX {HOME}")


def test_install_agent_command_and_env(
    na: Any, tmp_path: Path, monkeypatch: MP
) -> None:
    agent, _ = _install(na, tmp_path, monkeypatch)
    _, cmd, env = agent.calls[2]
    assert cmd.startswith("set -euo pipefail; NVM")
    assert cmd.index("NVM") < cmd.index(f"node {CLI} --version")
    assert cmd.index("--version") < cmd.index(f"node {CLI} --help >/dev/null")
    assert env == {
        "HOME": HOME,
        "NYCODE_CODING_AGENT_DIR": f"{HOME}/.nycode/agent",
        "NYCODE_SKIP_VERSION_CHECK": "1",
    }
    assert "models.json" not in cmd


def test_install_without_bundle_fails_loudly(
    na: Any, tmp_path: Path, monkeypatch: MP
) -> None:
    monkeypatch.setenv("NYCODE_HARNESS_BUNDLE", str(tmp_path / "missing.tgz"))
    with pytest.raises(FileNotFoundError, match="bundle.sh"):
        asyncio.run(na.NycodeAgent().install(_Env()))


def test_install_merges_workspace_header_in_agent_after_nvm(
    na: Any, tmp_path: Path, monkeypatch: MP
) -> None:
    agent, _ = _install(
        na, tmp_path, monkeypatch, ANTHROPIC_WORKSPACE_ID="wrkspc_x'; rm -rf /"
    )
    assert not any("workspace-id" in c for k, c, _ in agent.calls if k == "root")
    cmd = agent.calls[2][1]
    assert cmd.index("NVM") < cmd.index("anthropic-workspace-id")
    assert f"{HOME}/.nycode/agent/models.json" in cmd
    assert "'wrkspc_x'\"'\"'; rm -rf /'" in cmd  # shlex-quoted, never bare


def test_models_merge_snippet_preserves_existing(na: Any, tmp_path: Path) -> None:
    f = tmp_path / "models.json"
    f.write_text('{"providers": {"anthropic": {"baseUrl": "u"}, "x": {}}}')
    script = na._models_merge(str(f), "w1")
    assert "python3" not in script
    assert subprocess.run(["bash", "-c", script], check=False).returncode == 0
    d = json.loads(f.read_text())
    assert d["providers"]["anthropic"] == {
        "baseUrl": "u",
        "headers": {"anthropic-workspace-id": "w1"},
    }
    assert "x" in d["providers"]


def test_run_invokes_the_bundled_cli_with_the_agent_env(na: Any) -> None:
    agent = na.NycodeAgent()
    asyncio.run(agent.run("fix the bug", _Env(), None))
    _, cmd, env = agent.calls[0]
    assert f"node {CLI} --print --mode json --session-dir /logs/pi/sessions" in cmd
    assert "pi --print" not in cmd and cmd.startswith(". ~/.nvm/nvm.sh;")
    assert env == {
        "ANTHROPIC_OAUTH_TOKEN": "tok",
        "HOME": HOME,
        "NYCODE_CODING_AGENT_DIR": f"{HOME}/.nycode/agent",
        "NYCODE_SKIP_VERSION_CHECK": "1",
    }


def test_run_ends_options_before_an_instruction_starting_with_a_dash(na: Any) -> None:
    agent = na.NycodeAgent()
    asyncio.run(agent.run("-rf is not an option", _Env(), None))
    assert " -- '-rf is not an option' " in agent.calls[0][1]


def test_non_run_commands_are_untouched(na: Any) -> None:
    agent = na.NycodeAgent()
    asyncio.run(agent.exec_as_agent(_Env(), "echo hi", {"A": "b"}))
    assert agent.calls == [("agent", "echo hi", {"A": "b"})]


def test_nvm_download_retries_and_fails_closed(na: Any, monkeypatch: MP) -> None:
    monkeypatch.setattr(na, "nvm_node_install_snippet", lambda: HARBOR_NVM)
    s = na._resilient_nvm_snippet()
    assert "curl -fsSL --retry 5 --retry-delay 3 --retry-all-errors" in s
    assert "curl -o-" not in s
    assert (
        s.count("nvm install 22") == 3
    )  # node download retried; last failure propagates
    assert "| env -u NODE_VERSION bash" in s  # pipefail fails the pipe when curl does


def test_retry_runs_once_on_success_and_fails_after_three(na: Any) -> None:
    s = na._retry_cmd("nvm install 22")
    ok = subprocess.run(
        ["bash", "-c", f"nvm() {{ echo x; }}; {s}"],
        capture_output=True, text=True, check=False,
    )  # fmt: skip
    assert ok.stdout == "x\n"
    bad = subprocess.run(["bash", "-c", f"nvm() {{ return 1; }}; {s}"], check=False)
    assert bad.returncode != 0

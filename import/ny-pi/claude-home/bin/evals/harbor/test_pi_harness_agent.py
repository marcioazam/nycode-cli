"""pi_harness_agent without Harbor: local.env must end up 0600 and owned by the agent user."""

import asyncio
import os
import subprocess
import sys
import types
from pathlib import Path
from typing import Any

import pytest


class _Pi:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

    async def exec_as_agent(
        self,
        environment: Any,
        command: str,
        env: Any = None,
        cwd: Any = None,
        timeout_sec: Any = None,
    ) -> None:
        self.calls.append(("agent", command))

    async def exec_as_root(self, environment: Any, command: str) -> None:
        self.calls.append(("root", command))


def _stub(name: str, **attrs: Any) -> None:
    m = types.ModuleType(name)
    m.__dict__.update(attrs)
    sys.modules[name] = m


for _n in ("harbor", "harbor.agents", "harbor.agents.installed", "harbor.environments"):
    _stub(_n)
_stub("harbor.agents.installed.pi", Pi=_Pi)
_stub("harbor.agents.installed.node_install", nvm_node_install_snippet=lambda: "NVM")
_stub("harbor.environments.base", BaseEnvironment=object)
sys.path.insert(0, str(Path(__file__).parent))
import pi_harness_agent


def _run_fix(home: Path) -> int:
    script = pi_harness_agent._LOCAL_ENV_FIX.replace(pi_harness_agent._HOME, str(home))
    return subprocess.run(["bash", "-c", "set -e; " + script], check=False).returncode


def test_local_env_fix_remakes_file_as_0600_owned_by_user(tmp_path: Path) -> None:
    agent = tmp_path / ".pi/agent"
    agent.mkdir(parents=True)
    f = agent / "local.env"
    f.write_text("PI_COMPACT_AT=1\n")
    f.chmod(0o666)
    assert _run_fix(tmp_path) == 0
    st = f.stat()
    assert st.st_mode & 0o777 == 0o600
    assert st.st_uid == os.getuid()
    assert f.read_text() == "PI_COMPACT_AT=1\n"
    assert [p.name for p in agent.iterdir()] == ["local.env"]


def test_local_env_fix_without_file_is_noop(tmp_path: Path) -> None:
    assert _run_fix(tmp_path) == 0
    assert list(tmp_path.iterdir()) == []


def test_install_runs_fix_before_version(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    bundle = tmp_path / "b.tgz"
    bundle.write_bytes(b"x")
    monkeypatch.setenv("PI_HARNESS_BUNDLE", str(bundle))

    class _Env:
        async def upload_file(self, src: Path, dst: str) -> None:
            pass

    agent = pi_harness_agent.PiHarnessAgent()
    asyncio.run(agent.install(_Env()))
    cmd = next(c for who, c in agent.calls if who == "agent")
    assert pi_harness_agent._LOCAL_ENV_FIX in cmd
    assert cmd.index(pi_harness_agent._LOCAL_ENV_FIX) < cmd.index("--version")

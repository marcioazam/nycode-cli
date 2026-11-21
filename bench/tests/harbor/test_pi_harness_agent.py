"""pi_harness_agent without Harbor: local.env must end up 0600 and owned by the agent user."""

import asyncio
import json
import os
import subprocess
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from bench.tests.harbor.stubs import import_agent


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


pi_harness_agent: Any = (
    None  # set by the module fixture below, against stubbed harbor modules
)


@pytest.fixture(scope="module", autouse=True)
def _agent_module() -> Iterator[None]:
    global pi_harness_agent
    with import_agent(_Pi, "pi_harness_agent") as (pi_harness_agent,):
        yield


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
    assert cmd.index("--version") < cmd.index("--help >/dev/null")


def _install_cmd(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> str:
    bundle = tmp_path / "b.tgz"
    bundle.write_bytes(b"x")
    monkeypatch.setenv("PI_HARNESS_BUNDLE", str(bundle))

    class _Env:
        async def upload_file(self, src: Path, dst: str) -> None:
            pass

    agent = pi_harness_agent.PiHarnessAgent()
    asyncio.run(agent.install(_Env()))
    return " ; ".join(c for _, c in agent.calls)


def test_install_merges_workspace_header_when_set(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("ANTHROPIC_WORKSPACE_ID", "wrkspc_x'; rm -rf /")
    cmd = _install_cmd(tmp_path, monkeypatch)
    assert "models.json" in cmd and "anthropic-workspace-id" in cmd
    assert "'wrkspc_x'\"'\"'; rm -rf /'" in cmd  # shlex-quoted, never bare


def test_install_without_workspace_leaves_models_json(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("ANTHROPIC_WORKSPACE_ID", raising=False)
    assert "models.json" not in _install_cmd(tmp_path, monkeypatch)


def test_merge_snippet_has_no_python3() -> None:
    assert "python3" not in pi_harness_agent._models_merge("/x/models.json", "w1")


def test_install_merges_in_agent_after_nvm_not_root(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # task images may lack python3 and node is only installed by the nvm snippet
    monkeypatch.setenv("ANTHROPIC_WORKSPACE_ID", "w1")
    bundle = tmp_path / "b.tgz"
    bundle.write_bytes(b"x")
    monkeypatch.setenv("PI_HARNESS_BUNDLE", str(bundle))

    class _Env:
        async def upload_file(self, src: Path, dst: str) -> None:
            pass

    agent = pi_harness_agent.PiHarnessAgent()
    asyncio.run(agent.install(_Env()))
    assert not any("anthropic-workspace-id" in c for w, c in agent.calls if w == "root")
    cmd = next(c for w, c in agent.calls if w == "agent")
    assert cmd.index("NVM") < cmd.index("anthropic-workspace-id")


def test_models_json_merge_snippet_preserves_existing(tmp_path: Path) -> None:
    f = tmp_path / "models.json"
    f.write_text('{"providers": {"anthropic": {"baseUrl": "u"}, "x": {}}}')
    script = pi_harness_agent._models_merge(str(f), "w1")
    assert subprocess.run(["bash", "-c", script], check=False).returncode == 0
    d = json.loads(f.read_text())
    assert d["providers"]["anthropic"] == {
        "baseUrl": "u",
        "headers": {"anthropic-workspace-id": "w1"},
    }
    assert "x" in d["providers"]


_HARBOR_NVM = (
    "curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.2/install.sh | env -u NODE_VERSION bash && "
    'export NVM_DIR="$HOME/.nvm" && \\. "$NVM_DIR/nvm.sh" || true && '
    "command -v nvm &>/dev/null || { echo 'Error: NVM failed to load' >&2; exit 1; } && "
    "nvm install 22 && nvm alias default 22 && npm -v"
)


def test_nvm_download_retries_and_fails_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        pi_harness_agent, "nvm_node_install_snippet", lambda: _HARBOR_NVM
    )
    s = pi_harness_agent._resilient_nvm_snippet()
    assert (
        "curl -fsSL --retry 5 --retry-delay 3 --retry-all-errors --connect-timeout 10 --max-time 120 https://"
        in s
    )
    assert "curl -o-" not in s
    assert (
        s.count("nvm install 22") == 3
    )  # node download retried; last failure still propagates
    assert (
        "| env -u NODE_VERSION bash" in s
    )  # pipefail (set in install) fails the pipe when curl does


def test_nvm_snippet_retry_only_on_failure() -> None:
    s = pi_harness_agent._retry_cmd("nvm install 22")
    ok = subprocess.run(
        ["bash", "-c", f"nvm() {{ echo x; }}; {s}"],
        capture_output=True,
        text=True,
        check=False,
    )
    assert ok.stdout == "x\n"  # success runs once
    bad = subprocess.run(["bash", "-c", f"nvm() {{ return 1; }}; {s}"], check=False)
    assert bad.returncode != 0

"""omp_agent without Harbor: a stub Pi base records what the agent asks the container to run."""

import asyncio
import sys
import types
from pathlib import Path
from typing import Any

import pytest


class _Pi:
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
        await self.exec_as_agent(
            environment,
            f". ~/.nvm/nvm.sh; mkdir -p /s && pi --print --mode json --model m {getattr(self, '_quoted_instruction', '')} 2>&1",
        )


def _stub(name: str, **attrs: Any) -> None:
    m = types.ModuleType(name)
    m.__dict__.update(attrs)
    sys.modules[name] = m


for _n in ("harbor", "harbor.agents", "harbor.agents.installed", "harbor.environments"):
    _stub(_n)
_stub("harbor.agents.installed.pi", Pi=_Pi)
_stub("harbor.environments.base", BaseEnvironment=object)
sys.path.insert(0, str(Path(__file__).parent.parent))
import omp_agent  # type: ignore[import-not-found]  # CI mypy runs with MYPYPATH=tests/


class _Env:
    def __init__(self) -> None:
        self.uploads: list[tuple[str, str]] = []

    async def upload_file(self, src: Path, dst: str) -> None:
        self.uploads.append((Path(src).name, dst))


def test_rewrite_swaps_pi_drops_nvm_and_ends_options() -> None:
    cmd = ". ~/.nvm/nvm.sh; pi --print --mode json --model m '-x task' 2>&1"
    assert (
        omp_agent.rewrite(cmd, "'-x task'")
        == "/usr/local/bin/omp --print --mode json --model m -- '-x task' 2>&1"
    )
    assert (
        omp_agent.rewrite("pi --print --mode json x", None)
        == "/usr/local/bin/omp --print --mode json x"
    )


def test_release_dir_honours_env(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("OMP_RELEASE_DIR", raising=False)
    monkeypatch.setenv("BENCH_STAGE_ROOT", str(tmp_path))
    assert omp_agent.release_dir() == tmp_path / "omp/release"
    monkeypatch.setenv("OMP_RELEASE_DIR", "/r")
    assert omp_agent.release_dir() == Path("/r")


def test_install_uploads_both_binaries_and_picks_one(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    for n in ("omp-linux-x64", "omp-linux-musl-x64"):
        (tmp_path / n).write_text("bin")
    monkeypatch.setenv("OMP_RELEASE_DIR", str(tmp_path))
    agent, env = omp_agent.OmpAgent(), _Env()
    asyncio.run(agent.install(env))
    assert env.uploads == [
        ("omp-linux-x64", "/tmp/omp-glibc"),
        ("omp-linux-musl-x64", "/tmp/omp-musl"),
    ]
    root = agent.calls[0]
    assert (
        root[0] == "root"
        and "ld-musl" in root[1]
        and "mv /tmp/omp-glibc /usr/local/bin/omp" in root[1]
    )
    assert agent.calls[1] == (
        "agent",
        "/usr/local/bin/omp --version",
        {"HOME": "/opt/omp-home"},
    )


def test_install_without_binaries_fails_loudly(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("OMP_RELEASE_DIR", str(tmp_path))
    with pytest.raises(FileNotFoundError, match="omp-release.sh"):
        asyncio.run(omp_agent.OmpAgent().install(_Env()))


def test_run_executes_omp_with_isolated_home() -> None:
    agent = omp_agent.OmpAgent()
    asyncio.run(agent.run("-fix it", _Env(), None))
    kind, cmd, env = agent.calls[-1]
    assert kind == "agent"
    assert (
        cmd
        == "mkdir -p /s && /usr/local/bin/omp --print --mode json --model m -- '-fix it' 2>&1"
    )
    assert env == {
        "HOME": "/opt/omp-home",
        "PI_AUTO_QA": "0",
        "PI_SKIP_VERSION_CHECK": "1",
    }


def test_metadata() -> None:
    a = omp_agent.OmpAgent()
    assert (
        a.name() == "pi" and a.get_version_command() == "/usr/local/bin/omp --version"
    )
    assert a.parse_version("omp/18.20.0\n") == "18.20.0"

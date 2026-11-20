"""Harbor agent for Oh My Pi (omp, a pi fork): the reviewed release binary instead of `npm i -g pi`.

Subclasses Harbor's built-in Pi agent: omp keeps pi's CLI flags and JSON event stream, so the trajectory and
cost parsing are inherited. install() uploads the standalone binary that omp-release.sh fetched and checked
(glibc or musl, picked inside the container); the run swaps `pi` for it under a fixed throwaway HOME.
"""

import os
import shlex
from pathlib import Path
from typing import Any, override

# harbor is only installed where Harbor runs (uv tool), not in the CI venv: untyped there.
from harbor.agents.installed.pi import Pi  # type: ignore[import-not-found]
from harbor.environments.base import BaseEnvironment  # type: ignore[import-not-found]

_HOME = "/opt/omp-home"  # fixed in-container home: no host config reaches omp
_BIN = "/usr/local/bin/omp"
_NVM = (
    ". ~/.nvm/nvm.sh; "  # the base run() sources nvm for pi; omp is a standalone binary
)
_PICK = (
    "if ldd --version 2>&1 | grep -qi musl || [ -e /lib/ld-musl-x86_64.so.1 ]; "
    "then mv /tmp/omp-musl {bin}; rm -f /tmp/omp-glibc; "
    "else mv /tmp/omp-glibc {bin}; rm -f /tmp/omp-musl; fi; "
    "chmod 755 {bin}; mkdir -p {home}; chmod 777 {home}"
)


def release_dir() -> Path:
    root = Path(os.environ.get("BENCH_STAGE_ROOT", Path.home() / ".cache/bench"))
    return Path(os.environ.get("OMP_RELEASE_DIR", root / "omp/release"))


def rewrite(command: str, quoted_instruction: str | None) -> str:
    """The base run() command with omp in place of pi; options end before the instruction."""
    command = command.replace(_NVM, "", 1)
    command = command.replace(
        "pi --print --mode json", f"{_BIN} --print --mode json", 1
    )
    if quoted_instruction and f" {quoted_instruction} " in command:
        command = command.replace(
            f" {quoted_instruction} ", f" -- {quoted_instruction} ", 1
        )
    return command


class OmpAgent(Pi):  # type: ignore[misc]
    @staticmethod
    @override
    def name() -> str:
        return "pi"

    @override
    def get_version_command(self) -> str | None:
        return f"{_BIN} --version"

    @override
    def parse_version(self, stdout: str) -> str:
        return stdout.strip().removeprefix("omp/")

    @override
    async def install(self, environment: BaseEnvironment) -> None:
        d = release_dir()
        glibc, musl = d / "omp-linux-x64", d / "omp-linux-musl-x64"
        if not (glibc.is_file() and musl.is_file()):
            raise FileNotFoundError(
                f"{d} missing omp binaries; run omp-release.sh first"
            )
        await environment.upload_file(glibc, "/tmp/omp-glibc")
        await environment.upload_file(musl, "/tmp/omp-musl")
        await self.exec_as_root(environment, _PICK.format(bin=_BIN, home=_HOME))
        await self.exec_as_agent(
            environment, command=f"{_BIN} --version", env={"HOME": _HOME}
        )

    @override
    async def run(
        self, instruction: str, environment: BaseEnvironment, context: Any
    ) -> None:
        self._quoted_instruction = shlex.quote(instruction)
        await super().run(instruction, environment, context)

    @override
    async def exec_as_agent(
        self,
        environment: BaseEnvironment,
        command: str,
        env: dict[str, str] | None = None,
        cwd: str | None = None,
        timeout_sec: int | None = None,
    ) -> Any:
        if "pi --print --mode json" in command:
            command = rewrite(command, getattr(self, "_quoted_instruction", None))
            env = {
                **(env or {}),
                "HOME": _HOME,
                "PI_AUTO_QA": "0",
                "PI_SKIP_VERSION_CHECK": "1",
            }
        return await super().exec_as_agent(environment, command, env, cwd, timeout_sec)

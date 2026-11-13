"""Harbor agent that runs the user's whole pi harness (~/.pi/agent + wrapper) in the task container.

Subclasses Harbor's built-in Pi agent: trajectory/cost parsing and the CLI flags are inherited.
Only install() (ships the bundle instead of `npm i -g pi`) and the final pi invocation differ.
Build the bundle first with bundle.sh. The OAuth token comes from the harbor process env at runtime.
"""

import os
import shlex
from pathlib import Path
from typing import Any, override

from harbor.agents.installed.node_install import nvm_node_install_snippet
from harbor.agents.installed.pi import Pi
from harbor.environments.base import BaseEnvironment

_HOME = "/opt/pi-home"  # fixed in-container home; independent of the host user
_WRAPPER = f"{_HOME}/.local/bin/pi"
_REMOTE_BUNDLE = "/tmp/pi-harness-bundle.tgz"

# Installs python3 (the hooks need it) and patch/tar with whichever package manager exists; fails loudly.
_ROOT_DEPS = r"""
set -e
need=""
for c in curl tar python3 patch; do command -v $c >/dev/null 2>&1 || need="$need $c"; done
[ -z "$need" ] && exit 0
if command -v apt-get >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive; apt-get update -qq && apt-get install -y -qq --no-install-recommends ca-certificates $need
elif command -v dnf >/dev/null 2>&1; then dnf install -y $need
elif command -v yum >/dev/null 2>&1; then yum install -y $need
elif command -v apk >/dev/null 2>&1; then apk add --no-cache $need
else echo "no supported package manager to install:$need" >&2; exit 1; fi
command -v python3 >/dev/null 2>&1 || { echo "python3 missing after install" >&2; exit 1; }
"""


class PiHarnessAgent(Pi):
    @staticmethod
    @override
    def name() -> str:
        return "pi"

    @override
    def get_version_command(self) -> str | None:
        return None

    @override
    async def install(self, environment: BaseEnvironment) -> None:
        bundle = Path(os.environ.get("PI_HARNESS_BUNDLE", "/tmp/pi-harness-bundle.tgz"))
        if not bundle.is_file():
            raise FileNotFoundError(f"{bundle} missing; run bundle.sh first")
        await self.exec_as_root(environment, _ROOT_DEPS)
        await environment.upload_file(bundle, _REMOTE_BUNDLE)
        # The bundle is rooted at a fixed container home, whatever user runs the task.
        await self.exec_as_root(
            environment,
            f"mkdir -p {_HOME} && tar -xzf {_REMOTE_BUNDLE} -C {_HOME} && rm {_REMOTE_BUNDLE} "
            f"&& chmod -R a+rwX {_HOME}",
        )
        await self.exec_as_agent(
            environment,
            command=(
                "set -euo pipefail; "
                f"{nvm_node_install_snippet()} && "
                f"{_WRAPPER} --version"
            ),
            env={"HOME": _HOME},
        )

    @override
    async def run(self, instruction: str, environment: BaseEnvironment, context: Any) -> None:
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
        # The base run() builds `... pi --print --mode json ...`; point it at the wrapper under HOME=/opt/pi-home.
        if "pi --print --mode json" in command:
            command = command.replace("pi --print --mode json", f"{shlex.quote(_WRAPPER)} --print --mode json", 1)
            # An instruction starting with "-" (pytorch-model-recovery) is parsed as a pi option: end options first.
            quoted = getattr(self, "_quoted_instruction", None)
            if quoted and f" {quoted} " in command:
                command = command.replace(f" {quoted} ", f" -- {quoted} ", 1)
            env = {**(env or {}), "HOME": _HOME}
        return await super().exec_as_agent(environment, command, env, cwd, timeout_sec)

"""Harbor's stock pi agent plus the anthropic-workspace-id header (bench API-key mode, pi-vanilla arm).

A user API key without workspace needs the header on every call and Harbor's pi agent injects none.
After the stock install, merge it into models.json of pi's default dir ($HOME/.pi/agent): for a plain
`-m anthropic/<model>` the stock run() sets no PI_CODING_AGENT_DIR (only custom base_url or MCP do).
The workspace id comes from the harbor process env at runtime.
"""

import io
import os
import shlex
from typing import Any, override

from harbor.agents.installed.pi import Pi  # type: ignore[import-not-found]
from harbor.environments.base import BaseEnvironment  # type: ignore[import-not-found]
from pi_harness_agent import _models_merge

_PRINT = "pi --print --mode json "
_TAIL = " 2>&1 </dev/null"


def _dashdash(command: str) -> str:
    """Put `-- ` before the trailing quoted instruction of the `pi --print` command (one linear shlex pass)."""
    if _PRINT not in command or _TAIL not in command:
        return command
    head, sep, rest = command.rpartition(_TAIL)
    head = head.rstrip()
    src = io.StringIO(head)
    lex = shlex.shlex(src, posix=True)
    lex.whitespace_split = True
    start = -1
    try:
        while True:
            pos = src.tell()
            if lex.get_token() is None:
                break
            start = pos
    except ValueError:
        return command
    if start < 0:
        return command
    start += len(head[start:]) - len(head[start:].lstrip())
    return f"{head[:start]}-- {head[start:]} {sep.lstrip()}{rest}"


class PiVanillaApiAgent(Pi):  # type: ignore[misc]
    """Stock pi agent whose `pi --print` gets `-- <instruction>`, as in the ny-pi arm (pi_harness_agent).

    Without it an instruction starting with "-" is parsed as a pi option ("Unknown option").
    """

    @override
    async def exec_as_agent(
        self, environment: BaseEnvironment, command: str, **kwargs: Any
    ) -> Any:
        return await super().exec_as_agent(
            environment, command=_dashdash(command), **kwargs
        )

    @override
    async def install(self, environment: BaseEnvironment) -> None:
        await super().install(environment)
        ws = os.environ.get("ANTHROPIC_WORKSPACE_ID")
        if ws:
            await self.exec_as_agent(
                environment,
                command=f'set -e; mkdir -p "$HOME/.pi/agent" && cd "$HOME/.pi/agent" && {_models_merge("models.json", ws)}',
            )

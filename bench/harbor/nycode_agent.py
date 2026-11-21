"""Harbor agent that runs the nycode build of this checkout (+ the owner layer) in the task container (09 §2.2).

Sibling of the ny-pi `pi_harness_agent`: subclasses Harbor's built-in Pi agent, so the CLI flags, the session-dir
trajectory and the cost parsing are inherited (nycode keeps pi's `--print --mode json` contract and session format).
Only install() (ships the bundle of bundle.sh instead of `npm i -g pi`) and the final invocation differ: the bundled
`cli.js` runs under Node from nvm, with HOME and NYCODE_CODING_AGENT_DIR inside /opt/nycode-home.
Build the bundle first with bundle.sh. The OAuth token (ANTHROPIC_OAUTH_TOKEN) comes from the harbor process env.
"""

import os
import re
import shlex
from pathlib import Path
from typing import Any, override

from harbor.agents.installed.node_install import nvm_node_install_snippet  # type: ignore[import-not-found]
from harbor.agents.installed.pi import Pi  # type: ignore[import-not-found]
from harbor.environments.base import BaseEnvironment  # type: ignore[import-not-found]

_HOME = "/opt/nycode-home"  # fixed in-container home; independent of the host user
_AGENT_DIR = f"{_HOME}/.nycode/agent"  # NYCODE_CODING_AGENT_DIR: the owner layer
_CLI = f"{_HOME}/.local/lib/nycode/dist/bundle/cli.js"
_REMOTE_BUNDLE = "/tmp/nycode-harness-bundle.tgz"
_AGENT_ENV = {
    "HOME": _HOME,
    "NYCODE_CODING_AGENT_DIR": _AGENT_DIR,
    "NYCODE_SKIP_VERSION_CHECK": "1",  # same as bench/arms/nycode: no update check in a measured run
}

# curl and tar for nvm and the bundle (the bundle needs no python3 or patch, unlike the ny-pi harness); fails loudly.
_ROOT_DEPS = r"""
set -e
need=""
for c in curl tar; do command -v $c >/dev/null 2>&1 || need="$need $c"; done
[ -z "$need" ] && exit 0
if command -v apt-get >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive; apt-get update -qq && apt-get install -y -qq --no-install-recommends ca-certificates $need
elif command -v dnf >/dev/null 2>&1; then dnf install -y $need
elif command -v yum >/dev/null 2>&1; then yum install -y $need
elif command -v apk >/dev/null 2>&1; then apk add --no-cache $need
else echo "no supported package manager to install:$need" >&2; exit 1; fi
"""

# node, not python3: task images may lack python3. Same API-key workspace header as bench/arms/oauth-token.sh.
_MERGE_JS = (
    "const fs=require('fs');const p=process.argv[1];"
    "const d=fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):{};"
    "d.providers=d.providers||{};d.providers.anthropic=d.providers.anthropic||{};"
    "d.providers.anthropic.headers=d.providers.anthropic.headers||{};"
    "d.providers.anthropic.headers['anthropic-workspace-id']=process.env.WS;"
    "fs.writeFileSync(p,JSON.stringify(d,null,2))"
)


def _models_merge(path: str, workspace: str) -> str:
    """Shell snippet: add the workspace header to the anthropic provider, keeping the rest of models.json."""
    return (
        "( [ -s ~/.nvm/nvm.sh ] && . ~/.nvm/nvm.sh; "
        f"WS={shlex.quote(workspace)} node -e {shlex.quote(_MERGE_JS)} {shlex.quote(path)} )"
    )


_CURL_RETRY = "curl -fsSL --retry 5 --retry-delay 3 --retry-all-errors --connect-timeout 10 --max-time 120"


def _retry_cmd(cmd: str) -> str:
    """Run cmd up to 3 times (2 s apart); the group's status is the last attempt's, so a final failure still aborts."""
    return f"{{ {cmd} || {{ sleep 2; {cmd}; }} || {{ sleep 2; {cmd}; }}; }}"


def _resilient_nvm_snippet() -> str:
    """Harbor's nvm snippet with bounded retries: a transient `curl: (7)` once failed a whole gate.

    The nvm installer curl gets retry/timeouts (-f: an HTTP error must not be piped into bash; the pipe still fails
    under pipefail). `nvm install` downloads node via its own curl, so the whole command is retried instead.
    """
    s = nvm_node_install_snippet().replace("curl -o- ", f"{_CURL_RETRY} ", 1)
    return re.sub(r"nvm install \d+", lambda m: _retry_cmd(m.group()), s, count=1)


class NycodeAgent(Pi):  # type: ignore[misc]
    @staticmethod
    @override
    def name() -> str:
        return "nycode"

    @override
    def get_version_command(self) -> str | None:
        return None

    @override
    async def install(self, environment: BaseEnvironment) -> None:
        bundle = Path(
            os.environ.get("NYCODE_HARNESS_BUNDLE", "/tmp/nycode-harness-bundle.tgz")
        )
        if not bundle.is_file():
            raise FileNotFoundError(f"{bundle} missing; run bundle.sh first")
        await self.exec_as_root(environment, _ROOT_DEPS)
        await environment.upload_file(bundle, _REMOTE_BUNDLE)
        # The bundle is rooted at a fixed container home, whatever user runs the task; chmod a+rwX lets the agent
        # user write sessions and caches there.
        await self.exec_as_root(
            environment,
            f"mkdir -p {_HOME} && tar -xzf {_REMOTE_BUNDLE} -C {_HOME} && rm {_REMOTE_BUNDLE} "
            f"&& chmod -R a+rwX {_HOME}",
        )
        # API-key mode (bench): a user key without workspace needs the header on every call.
        ws = os.environ.get("ANTHROPIC_WORKSPACE_ID")
        merge = f"{_models_merge(f'{_AGENT_DIR}/models.json', ws)} && " if ws else ""
        await self.exec_as_agent(
            environment,
            command=(
                "set -euo pipefail; "
                f"{_resilient_nvm_snippet()} && "
                f"{merge}"
                f"node {_CLI} --version && "
                # --help warms Node's compile cache (best effort, never fails the install).
                f"(node {_CLI} --help >/dev/null 2>&1 || true)"
            ),
            env=dict(_AGENT_ENV),
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
        # The base run() builds `... pi --print --mode json ...`; point it at the bundled cli.js under nvm's node.
        if "pi --print --mode json" in command:
            command = command.replace(
                "pi --print --mode json",
                f"node {shlex.quote(_CLI)} --print --mode json",
                1,
            )
            # An instruction starting with "-" is parsed as an option: end options first.
            quoted = getattr(self, "_quoted_instruction", None)
            if quoted and f" {quoted} " in command:
                command = command.replace(f" {quoted} ", f" -- {quoted} ", 1)
            env = {**(env or {}), **_AGENT_ENV}
        return await super().exec_as_agent(environment, command, env, cwd, timeout_sec)

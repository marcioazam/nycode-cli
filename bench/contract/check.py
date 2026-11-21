#!/usr/bin/env python3
"""Harness contract check: proves each harness function is registered and answers without a UI.

Runs the arm's ``pi -p`` in a throwaway stage against ``fake_api.FakeApi`` (no model, no network, zero
cost) and evaluates the rules of ``contract_rules``. Exit 0 = contract holds, 1 = contract failure,
2 = environment unavailable. See README.md.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

import contract_rules as cr
from fake_api import FakeApi, Step

if TYPE_CHECKING:
    from collections.abc import Callable, Mapping, Sequence

ARMS_DIR = Path(__file__).resolve().parents[1] / "arms"
GROUPS = ("inventario", "regras", "basicas", "plano", "comandos", "skills", "mcp")
DYNAMIC = frozenset({"inventario", "regras", "basicas", "plano"})
BASIC_TOOLS = ("read", "write", "edit", "bash", "todo")
COMMANDS = ("goal", "plan", "agents", "tasks", "team")
STAGE_TIMEOUT_S = 600
PI_TIMEOUT_S = 90
WORKERS = 6
PRUNED = frozenset({"node_modules", ".git"})
SESSION_PREFIXES = ("PI_", "CLAUDE_", "ANTHROPIC_", "NYCODE_")


@dataclass(frozen=True)
class Layout:
    """Where an arm keeps its agent directory and where its commands, skills and agents are loaded from.

    ``embedded``: commands, skills and agents ship inside the checkout (``packages/coding-agent``), not in the
    stage; the stage then holds only the agent directory (settings, ``mcp.json``, ``models.json``).
    """

    agent_dir: str = ".pi/agent"
    embedded: bool = False
    offline_env: str = "PI_OFFLINE"


LAYOUTS = {
    "nycode": Layout(".nycode/agent", embedded=True, offline_env="NYCODE_OFFLINE")
}
EMBEDDED_ROOT = Path("packages/coding-agent")


def layout_of(arm: str) -> Layout:
    """Layout of the arm named ``arm`` (pi layout when it has no entry)."""
    return LAYOUTS.get(arm, Layout())


class EnvError(Exception):
    """The environment cannot run the check (exit 2); the message is the reason."""


def clean_env(environ: Mapping[str, str], stage: Path, arm: str = "") -> dict[str, str]:
    """Environment of the arm: the caller's minus harness session variables, so a run started inside a
    pi or nycode session (or a subagent) sees the same harness as one started from a plain shell. The arm's
    own offline switch is set; its agent directory is the arm script's business (it exports it from the stage).
    """
    env = {k: v for k, v in environ.items() if not k.startswith(SESSION_PREFIXES)}
    return {**env, "BENCH_STAGE": str(stage), layout_of(arm).offline_env: "1"}


def given_stage(environ: Mapping[str, str]) -> Path | None:
    """The caller's own stage (``BENCH_STAGE``) or None; a shared ``bench-*`` stage is refused."""
    given = environ.get("BENCH_STAGE")
    if given and Path(given).name.startswith("bench-"):
        raise EnvError("BENCH_STAGE aponta para um stage compartilhado do bench")
    return Path(given).resolve() if given else None


def run_arm(
    arm: Path, args: Sequence[str], cwd: Path, env: dict[str, str], timeout: float
) -> subprocess.CompletedProcess[str]:
    """Run the arm binary once, without stdin; the only place a process is started."""
    return subprocess.run(
        [str(arm), *args],
        cwd=cwd,
        env=env,
        capture_output=True,
        text=True,
        timeout=timeout,
        stdin=subprocess.DEVNULL,
        check=False,
    )


def prepare_stage(arm: Path, stage: Path, env: dict[str, str]) -> Path:
    """Have the arm build its stage (``--version``) and return the stage's agent directory."""
    if not arm.is_file():
        raise EnvError(f"braço inexistente: {arm.name}")
    try:
        done = run_arm(arm, ["--version"], stage.parent, env, STAGE_TIMEOUT_S)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise EnvError(f"o braço não executou: {type(exc).__name__}") from exc
    if done.returncode != 0:
        raise EnvError(
            f"montagem do stage falhou (exit {done.returncode}): {done.stderr.strip()[-400:]}"
        )
    where = layout_of(arm.name).agent_dir
    agent = stage / where
    if not agent.is_dir():
        raise EnvError(f"o braço não montou <stage>/{where} (ele honra BENCH_STAGE?)")
    return agent


def read_tree(root: Path, base: Path, keep: Callable[[str], bool]) -> dict[str, str]:
    """Contents of the files under ``root`` whose name passes ``keep``, keyed by path relative to ``base``."""
    out: dict[str, str] = {}
    for folder, dirs, files in os.walk(root, followlinks=True):
        dirs[:] = sorted(d for d in dirs if d not in PRUNED)
        for name in sorted(files):
            path = Path(folder) / name
            if keep(name) and path.is_file():
                out[path.relative_to(base).as_posix()] = path.read_text(
                    encoding="utf-8", errors="replace"
                )
    return out


def static_cases(
    agent: Path, embedded: Path | None = None
) -> tuple[list[cr.Case], dict[str, object]]:
    """Cases read from files: commands, skills, agents and MCP declarations.

    The stage's ``claude-home`` and pi-code tree by default; with ``embedded`` (the checkout of an embedded
    layout) the extensions in ``src/extensions`` and the ``resources`` of ``packages/coding-agent``. ``mcp.json``
    is always the stage's.
    """
    if embedded is None:
        base, home = agent, agent / "claude-home"
        ext = [
            agent / "extensions",
            agent / "npm" / "node_modules" / "pi-code" / "extensions",
        ]
    else:
        base = embedded
        home = embedded / EMBEDDED_ROOT / "resources"
        ext = [embedded / EMBEDDED_ROOT / "src" / "extensions"]
    sources = {
        **{
            k: v
            for folder in ext
            for k, v in read_tree(folder, base, lambda n: n.endswith(".ts")).items()
        },
        **read_tree(home / "commands", base, lambda n: n.endswith(".md")),
    }
    cases = cr.find_commands(sources, COMMANDS)
    skill_cases, skills = cr.check_documents(
        "skill", read_tree(home / "skills", base, lambda n: n == "SKILL.md")
    )
    agents_dir = home / "agents"
    agent_files = {
        p.relative_to(base).as_posix(): p.read_text(encoding="utf-8", errors="replace")
        for p in (sorted(agents_dir.glob("*.md")) if agents_dir.is_dir() else [])
    }
    agent_cases, agents = cr.check_documents("agente", agent_files)
    cases += skill_cases + agent_cases
    mcp = agent / "mcp.json"
    try:
        config = json.loads(mcp.read_text(encoding="utf-8")) if mcp.is_file() else None
    except ValueError:
        cases.append(
            cr.Case(
                "mcp/declarados", "mcp", cr.FAIL, "estático: mcp.json não é JSON válido"
            )
        )
    else:
        cases += (
            cr.check_mcp(config)
            if isinstance(config, dict)
            else [
                cr.Case("mcp/declarados", "mcp", cr.SKIP, "mcp.json ausente no stage")
            ]
        )
    return cases, {"skills": skills, "agents": agents}


@dataclass
class Session:
    """What a ``pi -p`` case needs: arm, environment, fake API with its mutable scripts, work root."""

    arm: Path
    env: dict[str, str]
    api: FakeApi
    scripts: dict[str, list[Step]]
    work: Path

    def workdir(self, case: str) -> Path:
        """Fresh work directory of a case, with the probe file the read and edit probes use."""
        folder = self.work / case
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "probe.txt").write_text(cr.PROBE_TEXT + "\n", encoding="utf-8")
        return folder

    def run(self, case: str, flags: Sequence[str] = ()) -> tuple[list[cr.Request], str]:
        """Run ``pi -p`` for a case; return its captured requests that declare tools and a process note."""
        try:
            done = run_arm(
                self.arm,
                [*flags, "--no-session", "-p", f"contract-case:{case}"],
                self.workdir(case),
                self.env,
                PI_TIMEOUT_S,
            )
            note = f"exit {done.returncode} {done.stderr.strip()[-200:]}".strip()
        except subprocess.TimeoutExpired:
            note = f"tempo esgotado ({PI_TIMEOUT_S}s)"
        requests = [cr.parse_request(body) for body in self.api.requests(case)]
        return [r for r in requests if r.tools], note


def _last_result(requests: Sequence[cr.Request]) -> cr.ToolResult | None:
    results = requests[-1].results if requests else ()
    return results[-1] if results else None


def dynamic_cases(
    session: Session, groups: frozenset[str]
) -> tuple[list[cr.Case], dict[str, object]]:
    """Cases that need ``pi -p``: inventory, no-UI rules, basic tools and plan mode."""
    captured, note = session.run("inventario")
    if not captured:
        raise EnvError(
            f"pi não enviou pedido com ferramentas ao servidor falso ({note})"
        )
    first = captured[0]
    inventory = cr.inventory(first)
    summary = (
        f"{inventory['tools_count']} ferramentas, system {inventory['system_chars']} chars, "
        f"{inventory['skills_listed']} skills, {inventory['agents_listed']} agentes"
    )
    cases = [
        cr.Case("inventario/pedido-capturado", "inventario", cr.OK, summary),
        cr.rule_absent(first, "plan_mode_complete", "regras", "-p sem --plan"),
        cr.rule_absent(first, "question", "regras", "-p"),
    ]
    probes = {
        t.name: cr.plan_probe(t, session.workdir(f"t-{t.name}")) for t in first.tools
    }
    jobs: dict[str, tuple[str, Sequence[str]]] = {}
    if groups & {"regras", "basicas"}:
        for tool in first.tools:
            tool_input = probes[tool.name].tool_input
            if tool_input is not None:
                session.scripts[f"t-{tool.name}"] = [
                    Step(tool_name=tool.name, tool_input=tool_input),
                    Step("fim"),
                ]
                jobs[tool.name] = (f"t-{tool.name}", ())
    plan_target = session.workdir("plano") / "written.txt"
    if "plano" in groups:
        writer = next(
            (t.name for t in first.tools if t.name.lower() == "write"), "write"
        )
        plan_input = {"path": str(plan_target), "content": cr.WRITE_TEXT + "\n"}
        session.scripts["plano"] = [
            Step(tool_name=writer, tool_input=plan_input),
            Step("fim"),
        ]
        jobs["--plan"] = ("plano", ("--plan",))
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = {
            key: pool.submit(session.run, case, flags)
            for key, (case, flags) in jobs.items()
        }
        done = {key: future.result() for key, future in futures.items()}
    results: dict[str, cr.ToolResult | None] = {}
    for tool in first.tools:
        requests, tool_note = done.get(tool.name, ([], ""))
        results[tool.name.lower()] = _last_result(requests)
        cases.append(
            cr.rule_no_ui_error(
                tool.name, probes[tool.name], results[tool.name.lower()], tool_note
            )
        )
    for basic in BASIC_TOOLS:
        sent = next((t.name for t in first.tools if t.name.lower() == basic), None)
        folder = session.work / f"t-{sent}"
        cases.append(
            cr.rule_basic(basic, results.get(basic), folder, declared=sent is not None)
        )
    if "plano" in groups:
        plan_requests, plan_note = done["--plan"]
        if plan_requests:
            cases.append(
                cr.rule_present(
                    plan_requests[0], "plan_mode_complete", "plano", "-p com --plan"
                )
            )
            cases.append(
                cr.rule_plan_no_write(
                    plan_requests[0], _last_result(plan_requests), plan_target
                )
            )
        else:
            cases.append(
                cr.Case(
                    "plano/pedido-capturado",
                    "plano",
                    cr.FAIL,
                    f"sem pedido com --plan ({plan_note})",
                )
            )
    return cases, inventory


def _commit(repo: Path) -> str:
    git = shutil.which("git")
    if git is None:
        return "desconhecido"
    done = subprocess.run(
        [git, "-C", str(repo), "rev-parse", "--short=12", "HEAD"],
        capture_output=True,
        text=True,
        check=False,
    )
    return done.stdout.strip() or "desconhecido"


def collect(
    arm: Path, stage: Path, scratch: Path, groups: frozenset[str]
) -> tuple[list[cr.Case], dict[str, object]]:
    """Build the stage, run the selected groups and return their cases plus the inventory."""
    env = clean_env(os.environ, stage, arm.name)
    agent = prepare_stage(arm, stage, env)
    embedded = (
        ARMS_DIR.parents[1] if layout_of(arm.name).embedded else None
    )  # <repo>/bench/arms
    cases, inventory = static_cases(agent, embedded)
    if groups & DYNAMIC:
        captures = scratch / "captures"
        captures.mkdir()
        scripts: dict[str, list[Step]] = {}
        with FakeApi(scripts, captures) as api:
            redirect = {
                "providers": {"anthropic": {"baseUrl": f"http://127.0.0.1:{api.port}"}}
            }
            (agent / "models.json").write_text(json.dumps(redirect), encoding="utf-8")
            work = scratch / "work"
            dynamic, measured = dynamic_cases(
                Session(arm, env, api, scripts, work), groups
            )
        cases = dynamic + cases
        inventory = {**measured, **inventory}
    return [c for c in cases if c.group in groups], inventory


def main(argv: Sequence[str] | None = None) -> int:
    """CLI entry point; returns the process exit code."""
    parser = argparse.ArgumentParser(
        description="Verificador de contrato do harness (sem modelo)."
    )
    parser.add_argument(
        "--arm", required=True, help="nome do braço em bench/arms (ex.: ny-pi)"
    )
    parser.add_argument(
        "--json", type=Path, help="grava inventário e casos neste arquivo"
    )
    parser.add_argument("--only", choices=GROUPS, help="roda só um grupo de casos")
    args = parser.parse_args(argv)
    groups = frozenset({args.only} if args.only else GROUPS)
    try:
        given = given_stage(os.environ)
        with tempfile.TemporaryDirectory(prefix="contract-") as tmp:
            cases, inventory = collect(
                ARMS_DIR / args.arm, given or Path(tmp) / "stage", Path(tmp), groups
            )
    except EnvError as exc:
        print(f"ambiente indisponível: {exc}", file=sys.stderr)
        return 2
    counts = {
        status: sum(1 for c in cases if c.status == status)
        for status in (cr.OK, cr.FAIL, cr.SKIP)
    }
    code = 1 if counts[cr.FAIL] else 0
    for case in cases:
        print(f"{case.status:<7} {case.name}: {case.evidence}")
    print(
        f"resumo: {counts[cr.OK]} ok, {counts[cr.FAIL]} falha, {counts[cr.SKIP]} pulado (exit {code})"
    )
    if args.json:
        report = {
            "arm": args.arm,
            "commit": _commit(Path(__file__).resolve().parents[2]),
            "exit": code,
            "summary": counts,
            "inventory": inventory,
            "cases": [c.as_dict() for c in cases],
        }
        args.json.write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
    return code


if __name__ == "__main__":
    sys.exit(main())

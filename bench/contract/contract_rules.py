"""Pure functions of the harness contract check: request parsing, inventory, probes and rules.

Nothing here starts a process or opens a socket; ``check.py`` feeds it captured request bodies and files.
Tool names are compared case-insensitively because pi sends some of them capitalized (``Read``, ``Bash``).
"""

from __future__ import annotations

import json
import re
import shutil
from dataclasses import asdict, dataclass
from typing import TYPE_CHECKING, Any
from urllib.parse import urlsplit

if TYPE_CHECKING:
    from collections.abc import Callable, Iterable, Mapping
    from pathlib import Path

OK, FAIL, SKIP = "ok", "falha", "pulado"
FORBIDDEN_RESULTS = ("UI not available", "Not in plan mode")
PROBE_TEXT = "contract-probe"
EDITED_TEXT = "contract-edited"
WRITE_TEXT = "contract-write"
LOOSE = "(texto)"
EVIDENCE_MAX = 160


@dataclass(frozen=True)
class Case:
    """One named check with its outcome (``ok``, ``falha`` or ``pulado``) and short evidence."""

    name: str
    group: str
    status: str
    evidence: str

    def as_dict(self) -> dict[str, str]:
        """JSON form."""
        return asdict(self)


@dataclass(frozen=True)
class Tool:
    """A tool declared to the model; ``chars`` is description plus serialized schema."""

    name: str
    description: str
    schema: Mapping[str, Any]
    chars: int


@dataclass(frozen=True)
class ToolResult:
    """A ``tool_result`` block sent back by the harness."""

    tool_use_id: str
    text: str
    is_error: bool


@dataclass(frozen=True)
class Request:
    """The parts of a captured Messages request the checks read."""

    system: str
    tools: tuple[Tool, ...]
    results: tuple[ToolResult, ...]

    def names(self) -> set[str]:
        """Lower-cased tool names."""
        return {t.name.lower() for t in self.tools}


def _text(content: object) -> str:
    """Flatten a string or a list of content blocks into text."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(str(b.get("text", "")) for b in content if isinstance(b, dict))
    return ""


def parse_request(body: Mapping[str, Any]) -> Request:
    """Extract system text, tools and tool results from a request body; missing parts are empty."""
    tools = []
    for raw in body.get("tools") or []:
        if not isinstance(raw, dict) or not isinstance(raw.get("name"), str):
            continue
        declared = raw.get("input_schema")
        schema: dict[str, Any] = declared if isinstance(declared, dict) else {}
        description = str(raw.get("description") or "")
        tools.append(
            Tool(
                raw["name"],
                description,
                schema,
                len(description) + len(json.dumps(schema)),
            )
        )
    results = []
    for message in body.get("messages") or []:
        content = message.get("content") if isinstance(message, dict) else None
        for block in content if isinstance(content, list) else []:
            if isinstance(block, dict) and block.get("type") == "tool_result":
                results.append(
                    ToolResult(
                        str(block.get("tool_use_id", "")),
                        _text(block.get("content")),
                        bool(block.get("is_error")),
                    )
                )
    return Request(_text(body.get("system")), tuple(tools), tuple(results))


_OPEN = re.compile(r"^<([A-Za-z_][\w-]*)(?:\s[^>\n]*)?>", re.MULTILINE)


def section_spans(system: str) -> list[tuple[str, int, int]]:
    """Top-level ``<name>...</name>`` blocks (tag at line start) as ``(name, start, end)``."""
    spans = []
    pos = 0
    while found := _OPEN.search(system, pos):
        close = f"</{found.group(1)}>"
        end = system.find(close, found.end())
        if end < 0:  # an opening tag that never closes is prose, not a section
            pos = found.end()
            continue
        pos = end + len(close)
        spans.append((found.group(1), found.start(), pos))
    return spans


def system_sections(system: str) -> dict[str, int]:
    """Characters per top-level section, repeated names summed; text outside any section is ``(texto)``."""
    sizes: dict[str, int] = {}
    for name, start, end in section_spans(system):
        sizes[name] = sizes.get(name, 0) + end - start
    loose = len(system) - sum(sizes.values())
    if loose:
        sizes[LOOSE] = loose
    return sizes


def _section_text(system: str, wanted: str) -> str:
    return "".join(
        system[start:end]
        for name, start, end in section_spans(system)
        if name == wanted
    )


def count_skills(system: str) -> int:
    """Skills listed to the model."""
    return system.count("<skill>")


def count_agents(system: str) -> int:
    """Agents listed to the model (``- name`` lines of the ``<subagents>`` section)."""
    return sum(
        1
        for line in _section_text(system, "subagents").splitlines()
        if line.startswith("- ")
    )


def inventory(request: Request) -> dict[str, object]:
    """Context blocks of a ``-p`` request: tools, system sections, listed skills and agents."""
    return {
        "tools": [{"name": t.name, "chars": t.chars} for t in request.tools],
        "tools_count": len(request.tools),
        "tools_chars": sum(t.chars for t in request.tools),
        "system_chars": len(request.system),
        "system_sections": system_sections(request.system),
        "skills_listed": count_skills(request.system),
        "agents_listed": count_agents(request.system),
    }


def _min_number(schema: Mapping[str, Any]) -> int | float:
    low = schema.get("minimum", 1)
    return low if isinstance(low, (int, float)) else 1


def min_input(schema: Mapping[str, Any]) -> object:
    """Smallest value a JSON Schema accepts: required properties only, first enum, null when allowed."""
    if "const" in schema:
        return schema["const"]
    enum = schema.get("enum")
    if isinstance(enum, list) and enum:
        return enum[0]
    for key in ("anyOf", "oneOf"):
        options = [o for o in schema.get(key) or [] if isinstance(o, dict)]
        if options:
            return (
                None
                if any(o.get("type") == "null" for o in options)
                else min_input(options[0])
            )
    kind = schema.get("type")
    if isinstance(kind, list):
        kind = kind[0] if kind else None
    if kind == "object" or (kind is None and "properties" in schema):
        props = schema.get("properties") or {}
        return {
            k: min_input(props[k] if isinstance(props.get(k), dict) else {})
            for k in schema.get("required") or []
        }
    if kind == "array":
        items = schema.get("items")
        return [min_input(items if isinstance(items, dict) else {})] * int(
            schema.get("minItems") or 0
        )
    if kind == "string":
        return "x" * max(1, int(schema.get("minLength") or 0))
    if kind in ("number", "integer"):
        return _min_number(schema)
    if kind == "boolean":
        return False
    return None


@dataclass(frozen=True)
class Probe:
    """How to call one tool harmlessly, or why it is not called."""

    tool_input: Mapping[str, object] | None
    skip: str = ""


# Overrides laid over the schema-minimal input; every path stays inside the case work directory.
_SAFE: dict[str, Callable[[Path], dict[str, object]]] = {
    "read": lambda wd: {"path": str(wd / "probe.txt")},
    "write": lambda wd: {"path": str(wd / "written.txt"), "content": WRITE_TEXT + "\n"},
    "edit": lambda wd: {
        "path": str(wd / "probe.txt"),
        "edits": [{"oldText": PROBE_TEXT, "newText": EDITED_TEXT}],
    },
    "bash": lambda _wd: {"command": "echo ok"},
    "todo": lambda _wd: {"action": "list"},
    "memory": lambda _wd: {"action": "list"},
    "question": lambda _wd: {"question": "ok?"},
    "plan_mode_complete": lambda _wd: {"plan": "1. noop"},
}
_LSP: dict[str, object] = {"line": 0, "character": 0}
_SKIPS = (
    ("subagent", "subagente: inicia outro agente"),
    ("web", "rede"),
    ("fetch", "rede"),
    ("search", "rede ou servidores MCP"),
    ("mcp__", "MCP: precisa de rede/login"),
    ("browser", "navegador"),
    ("playwright", "navegador"),
    ("computer", "desktop"),
    ("codemode", "executa código arbitrário"),
    ("__pi_deferred_placeholder__", "marcador interno, não é ferramenta"),
)


def plan_probe(tool: Tool, workdir: Path) -> Probe:
    """Build a harmless input for a tool, or a skip reason when it cannot be proven harmless."""
    name = tool.name.lower()
    for needle, reason in _SKIPS:
        if needle in name:
            return Probe(None, reason)
    base = min_input(tool.schema)
    values: dict[str, object] = dict(base) if isinstance(base, dict) else {}
    if name in _SAFE:
        return Probe({**values, **_SAFE[name](workdir)})
    if name.startswith("lsp_"):
        return Probe(
            {
                **values,
                "path": str(workdir / "probe.txt"),
                **{k: v for k, v in _LSP.items() if k in values},
            }
        )
    return Probe(None, "não provada inofensiva: sem input seguro conhecido")


def _short(text: str) -> str:
    flat = " ".join(text.split())
    return flat if len(flat) <= EVIDENCE_MAX else flat[: EVIDENCE_MAX - 1] + "…"


def rule_absent(request: Request, tool: str, group: str, context: str) -> Case:
    """Fail when ``tool`` is declared to the model in ``context``."""
    present = tool in request.names()
    evidence = (
        f"{tool} enviada ao modelo em {context}"
        if present
        else f"{tool} ausente em {context}"
    )
    return Case(f"{group}/{tool}-ausente", group, FAIL if present else OK, evidence)


def rule_present(request: Request, tool: str, group: str, context: str) -> Case:
    """Fail when ``tool`` is not declared to the model in ``context``."""
    present = tool in request.names()
    evidence = (
        f"{tool} presente em {context}" if present else f"{tool} ausente em {context}"
    )
    return Case(f"{group}/{tool}-presente", group, OK if present else FAIL, evidence)


def rule_no_ui_error(
    tool: str, probe: Probe, result: ToolResult | None, note: str = ""
) -> Case:
    """Fail when a called tool answers with a no-interface error; skipped tools carry their reason."""
    name = f"regras/sem-erro-de-interface:{tool}"
    if probe.tool_input is None:
        return Case(name, "regras", SKIP, probe.skip)
    if result is None:
        return Case(
            name,
            "regras",
            FAIL,
            _short(f"sem tool_result ({note or 'pi não devolveu a chamada'})"),
        )
    hit = next((p for p in FORBIDDEN_RESULTS if p.lower() in result.text.lower()), None)
    return Case(
        name, "regras", FAIL if hit else OK, _short(f"tool_result: {result.text}")
    )


def rule_basic(
    tool: str, result: ToolResult | None, workdir: Path, declared: bool
) -> Case:
    """A basic tool must be declared, run end to end and leave its expected effect."""
    name = f"basicas/{tool}"
    if not declared:
        return Case(name, "basicas", FAIL, f"{tool} não enviada ao modelo em -p")
    if result is None:
        return Case(name, "basicas", FAIL, "sem tool_result")
    problem = "tool_result marcado is_error" if result.is_error else ""
    if not problem and tool == "read" and PROBE_TEXT not in result.text:
        problem = "conteúdo do arquivo ausente do tool_result"
    if not problem and tool == "bash" and "ok" not in result.text:
        problem = "saída do comando ausente do tool_result"
    if (
        not problem
        and tool == "write"
        and not _contains(workdir / "written.txt", WRITE_TEXT)
    ):
        problem = "arquivo não foi escrito"
    if (
        not problem
        and tool == "edit"
        and not _contains(workdir / "probe.txt", EDITED_TEXT)
    ):
        problem = "arquivo não foi editado"
    return Case(
        name,
        "basicas",
        FAIL if problem else OK,
        _short(f"{problem or 'ok'}; tool_result: {result.text}"),
    )


def _contains(path: Path, text: str) -> bool:
    return path.is_file() and text in path.read_text(encoding="utf-8", errors="replace")


def rule_plan_no_write(
    request: Request, result: ToolResult | None, target: Path
) -> Case:
    """Plan mode must not write: write tools absent, or a write outside the plan file refused."""
    name = "plano/sem-escrita"
    declared = sorted(request.names() & {"write", "edit"})
    if not declared:
        return Case(name, "plano", OK, "write e edit ausentes com --plan")
    if target.exists():
        return Case(
            name,
            "plano",
            FAIL,
            f"{', '.join(declared)} enviadas com --plan e a escrita aconteceu",
        )
    refusal = result.text if result else "sem tool_result"
    return Case(
        name,
        "plano",
        OK,
        _short(
            f"{', '.join(declared)} enviadas com --plan, escrita recusada: {refusal}"
        ),
    )


def parse_frontmatter(text: str) -> dict[str, str] | None:
    """Top-level ``key: value`` pairs of a ``---`` frontmatter block; ``None`` when there is no block."""
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return None
    try:
        end = next(i for i, line in enumerate(lines[1:], 1) if line.strip() == "---")
    except StopIteration:
        return None
    out: dict[str, str] = {}
    key: str | None = None
    for line in lines[1:end]:
        if line[:1] in (" ", "\t") and key is not None:
            out[key] = f"{out[key]} {line.strip()}".strip()
            continue
        pair = re.match(r"([A-Za-z_][\w-]*):\s*(.*)$", line)
        if pair is None:
            key = None
            continue
        key, value = pair.group(1), pair.group(2).strip()
        if value in (">", "|", ">-", "|-"):
            value = ""
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        out[key] = value
    return out


def check_documents(
    kind: str, files: Mapping[str, str]
) -> tuple[list[Case], dict[str, int]]:
    """Frontmatter and unique-name cases for skills or agents (``files``: relative path to content)."""
    invalid = []
    owners: dict[str, list[str]] = {}
    total = 0
    for path in sorted(files):
        meta = parse_frontmatter(files[path])
        if meta is None or not meta.get("name") or not meta.get("description"):
            invalid.append(path)
            continue
        owners.setdefault(meta["name"], []).append(path)
        total += len(meta["description"])
    repeated = {name: paths for name, paths in owners.items() if len(paths) > 1}
    cases = [
        Case(
            f"skills/{kind}-frontmatter",
            "skills",
            FAIL if invalid or not files else OK,
            _short(f"sem name/description: {', '.join(invalid)}")
            if invalid
            else f"{len(files)} arquivos com name e description",
        ),
        Case(
            f"skills/{kind}-nomes-unicos",
            "skills",
            FAIL if repeated else OK,
            _short(f"name repetido: {repeated}")
            if repeated
            else f"{len(owners)} nomes distintos",
        ),
    ]
    return cases, {"files": len(files), "description_chars": total}


def check_mcp(
    config: Mapping[str, Any], which: Callable[[str], str | None] = shutil.which
) -> list[Case]:
    """One static case per MCP server; evidence carries only the command name or URL host, never env/headers."""
    servers = config.get("mcpServers")
    cases = []
    for name, spec in sorted(servers.items()) if isinstance(servers, dict) else []:
        command = spec.get("command") if isinstance(spec, dict) else None
        url = spec.get("url") if isinstance(spec, dict) else None
        if isinstance(command, str) and command:
            status, evidence = (
                (OK, f"comando {command} no PATH")
                if which(command)
                else (FAIL, f"comando {command} fora do PATH")
            )
        elif isinstance(url, str) and url:
            parts = urlsplit(url)
            good = parts.scheme in ("http", "https") and bool(parts.hostname)
            status, evidence = (
                (OK, f"URL {parts.scheme}://{parts.hostname}")
                if good
                else (FAIL, "URL malformada")
            )
        else:
            status, evidence = FAIL, "sem command nem url"
        cases.append(Case(f"mcp/{name}", "mcp", status, f"estático: {evidence}"))
    if not cases:
        cases.append(Case("mcp/declarados", "mcp", SKIP, "nenhum servidor em mcp.json"))
    cases.append(
        Case(
            "mcp/tools-list",
            "mcp",
            SKIP,
            "precisa de rede/login: nenhum servidor é iniciado",
        )
    )
    return cases


def find_commands(sources: Mapping[str, str], names: Iterable[str]) -> list[Case]:
    """Static check that each slash command is registered in extension source or is a command file."""
    cases = []
    for name in names:
        pattern = re.compile(rf"registerCommand\(\s*['\"`]{re.escape(name)}['\"`]")
        where = ""
        for path in sorted(sources):
            if path.endswith(f"commands/{name}.md"):
                where = path
            elif found := pattern.search(sources[path]):
                where = f"{path}:{sources[path].count(chr(10), 0, found.start()) + 1}"
            if where:
                break
        evidence = (
            f"estático: registrado em {where}"
            if where
            else "estático: nenhum registerCommand nem commands/*.md"
        )
        cases.append(
            Case(f"comandos/{name}", "comandos", OK if where else FAIL, evidence)
        )
    return cases

"""Unit tests of the pure contract functions: parser, sections, minimal input, rules."""

from pathlib import Path
from typing import Any

import contract_rules as cr

OBJ: dict[str, Any] = {"type": "object", "properties": {}, "required": []}
SYSTEM = (
    "You are pi.\n\n<tools>\n- read\n</tools>\n<available_skills>\n  <skill>\n  </skill>\n  <skill>\n  </skill>\n"
    "</available_skills>\n<subagents>\nDelegate:\n- A (user): a\n- B (user): b\n</subagents>\n<aberta>\nfim"
)


def body(names: list[str], result: str | None = None) -> dict[str, Any]:
    messages: list[Any] = [
        {"role": "user", "content": "contract-case:x"},
        {"role": "system", "content": []},
        "x",
    ]
    if result is not None:
        block = {
            "type": "tool_result",
            "tool_use_id": "t1",
            "content": [{"type": "text", "text": result}],
        }
        messages.append(
            {"role": "user", "content": [block, {"type": "text", "text": "y"}]}
        )
    tools: list[Any] = [
        {"name": n, "description": "dd", "input_schema": OBJ} for n in names
    ]
    return {
        "system": [{"type": "text", "text": SYSTEM}],
        "tools": [*tools, {"nome": 1}],
        "messages": messages,
    }


def test_parse_request_and_inventory() -> None:
    request = cr.parse_request(body(["Read", "todo"], "saída"))
    assert request.names() == {"read", "todo"}
    assert request.tools[0].chars == 2 + len(
        '{"type": "object", "properties": {}, "required": []}'
    )
    assert request.results == (cr.ToolResult("t1", "saída", is_error=False),)
    inventory = cr.inventory(request)
    assert (
        inventory["tools_count"],
        inventory["skills_listed"],
        inventory["agents_listed"],
    ) == (2, 2, 2)
    assert inventory["system_chars"] == len(SYSTEM)
    empty = cr.parse_request({"system": None})
    assert (empty.system, empty.tools, empty.results) == ("", (), ())
    assert cr.parse_request({"system": "s"}).system == "s"


def test_system_sections_sum_to_total_and_merge_repeats() -> None:
    sizes = cr.system_sections(SYSTEM)
    assert set(sizes) == {"tools", "available_skills", "subagents", cr.LOOSE}
    assert sizes["tools"] == len("<tools>\n- read\n</tools>")
    assert sum(sizes.values()) == len(SYSTEM)
    assert cr.system_sections("<a>\n1\n</a>\n<a x='1'>\n2\n</a>") == {
        "a": 26,
        cr.LOOSE: 1,
    }
    assert cr.system_sections("") == {}


def test_min_input_from_schema() -> None:
    schema = {
        "type": "object",
        "required": [
            "path",
            "offset",
            "mode",
            "n",
            "flag",
            "list",
            "two",
            "k",
            "nested",
            "either",
            "any",
            "t",
        ],
        "properties": {
            "path": {"type": "string"},
            "offset": {"anyOf": [{"type": "number"}, {"type": "null"}]},
            "mode": {"enum": ["a", "b"]},
            "n": {"type": "integer", "minimum": 3},
            "flag": {"type": "boolean"},
            "list": {"type": "array", "items": {"type": "string"}},
            "two": {"type": "array", "minItems": 2, "items": {"type": "number"}},
            "k": {"const": 7},
            "nested": {
                "properties": {"x": {"type": "string", "minLength": 3}, "opt": {}},
                "required": ["x"],
            },
            "either": {"oneOf": [{"type": "string"}, {"type": "number"}]},
            "any": {},
            "t": {"type": ["number", "null"], "minimum": "x"},
            "optional": {"type": "string"},
        },
    }
    assert cr.min_input(schema) == {
        "path": "x",
        "offset": None,
        "mode": "a",
        "n": 3,
        "flag": False,
        "list": [],
        "two": [1, 1],
        "k": 7,
        "nested": {"x": "xxx"},
        "either": "x",
        "any": None,
        "t": 1,
    }
    assert cr.min_input({"type": "object", "required": ["z"]}) == {"z": None}


def tool(name: str, schema: dict[str, Any] | None = None) -> cr.Tool:
    return cr.Tool(name, "", schema or OBJ, 0)


def test_plan_probe_is_safe_or_skipped(tmp_path: Path) -> None:
    read = {
        "type": "object",
        "required": ["path", "limit"],
        "properties": {"limit": {"type": "number"}},
    }
    assert cr.plan_probe(tool("Read", read), tmp_path).tool_input == {
        "path": str(tmp_path / "probe.txt"),
        "limit": 1,
    }
    assert cr.plan_probe(tool("bash"), tmp_path).tool_input == {"command": "echo ok"}
    assert cr.plan_probe(tool("memory"), tmp_path).tool_input == {"action": "list"}
    hover = {
        "type": "object",
        "required": ["path", "line"],
        "properties": {"line": {"type": "number"}},
    }
    assert cr.plan_probe(tool("lsp_hover", hover), tmp_path).tool_input == {
        "path": str(tmp_path / "probe.txt"),
        "line": 0,
    }
    for name in (
        "subagent",
        "web_fetch",
        "AskOther",
        "mcp__x__y",
        "tool_search",
        "codemode",
        "novidade",
    ):
        probe = cr.plan_probe(tool(name), tmp_path)
        assert probe.tool_input is None
        assert probe.skip
    for name in ("write", "edit"):
        made = cr.plan_probe(tool(name), tmp_path).tool_input
        assert made is not None
        assert str(made["path"]).startswith(str(tmp_path))


def test_rules_fail_on_request_with_plan_mode_complete_and_question() -> None:
    broken = cr.parse_request(body(["Read", "plan_mode_complete", "question"]))
    fixed = cr.parse_request(body(["Read", "Bash"]))
    for name in ("plan_mode_complete", "question"):
        assert cr.rule_absent(broken, name, "regras", "-p").status == cr.FAIL
        assert cr.rule_absent(fixed, name, "regras", "-p").status == cr.OK
    assert (
        cr.rule_present(broken, "plan_mode_complete", "plano", "--plan").status == cr.OK
    )
    assert (
        cr.rule_present(fixed, "plan_mode_complete", "plano", "--plan").status
        == cr.FAIL
    )


def test_rule_no_ui_error() -> None:
    probe = cr.Probe({"question": "ok?"})
    for text in (
        "Error: UI not available (running in non-interactive mode)",
        "Not in plan mode; tool ignored.",
    ):
        result = cr.parse_request(body(["question"], text)).results[0]
        assert cr.rule_no_ui_error("question", probe, result).status == cr.FAIL
    fine = cr.rule_no_ui_error(
        "todo", probe, cr.ToolResult("t", "No todos " * 40, is_error=False)
    )
    assert fine.status == cr.OK
    assert len(fine.evidence) <= cr.EVIDENCE_MAX
    assert cr.rule_no_ui_error("x", cr.Probe(None, "rede"), None).as_dict() == {
        "name": "regras/sem-erro-de-interface:x",
        "group": "regras",
        "status": cr.SKIP,
        "evidence": "rede",
    }
    assert cr.rule_no_ui_error("x", probe, None, "tempo esgotado").status == cr.FAIL


def test_rule_basic(tmp_path: Path) -> None:
    good = cr.ToolResult("t", f"{cr.PROBE_TEXT} ok", is_error=False)
    assert cr.rule_basic("read", good, tmp_path, declared=False).status == cr.FAIL
    assert cr.rule_basic("read", None, tmp_path, declared=True).status == cr.FAIL
    assert (
        cr.rule_basic(
            "read", cr.ToolResult("t", "x", is_error=True), tmp_path, declared=True
        ).status
        == cr.FAIL
    )
    assert (
        cr.rule_basic(
            "read", cr.ToolResult("t", "vazio", is_error=False), tmp_path, declared=True
        ).status
        == cr.FAIL
    )
    assert (
        cr.rule_basic(
            "bash", cr.ToolResult("t", "nada", is_error=False), tmp_path, declared=True
        ).status
        == cr.FAIL
    )
    for name in ("read", "bash", "todo"):
        assert cr.rule_basic(name, good, tmp_path, declared=True).status == cr.OK
    assert cr.rule_basic("write", good, tmp_path, declared=True).status == cr.FAIL
    assert cr.rule_basic("edit", good, tmp_path, declared=True).status == cr.FAIL
    (tmp_path / "written.txt").write_text(cr.WRITE_TEXT)
    (tmp_path / "probe.txt").write_text(cr.EDITED_TEXT)
    assert cr.rule_basic("write", good, tmp_path, declared=True).status == cr.OK
    assert cr.rule_basic("edit", good, tmp_path, declared=True).status == cr.OK


def test_rule_plan_no_write(tmp_path: Path) -> None:
    target = tmp_path / "written.txt"
    with_write = cr.parse_request(body(["Read", "Write", "plan_mode_complete"]))
    assert (
        cr.rule_plan_no_write(cr.parse_request(body(["Read"])), None, target).status
        == cr.OK
    )
    refused = cr.rule_plan_no_write(
        with_write,
        cr.ToolResult("t", "Plan mode: write blocked", is_error=True),
        target,
    )
    assert (refused.status, "write blocked" in refused.evidence) == (cr.OK, True)
    assert cr.rule_plan_no_write(with_write, None, target).status == cr.OK
    target.write_text("x")
    assert cr.rule_plan_no_write(with_write, None, target).status == cr.FAIL


def test_frontmatter_and_documents() -> None:
    assert cr.parse_frontmatter("sem bloco") is None
    assert cr.parse_frontmatter("---\nname: a\n") is None
    folded = "---\nname: 'a'\ndescription: >\n  linha um\n  linha dois\ntools:\n- x\n  solto\n---\ncorpo"
    assert cr.parse_frontmatter(folded) == {
        "name": "a",
        "description": "linha um linha dois",
        "tools": "",
    }
    files = {
        "skills/a/SKILL.md": '---\nname: a\ndescription: "dez chars."\n---\n',
        "skills/b/SKILL.md": "---\nname: a\ndescription: outra\n---\n",
        "skills/c/SKILL.md": "---\nname: c\n---\n",
        "skills/d/SKILL.md": "nada",
    }
    cases, totals = cr.check_documents("skill", files)
    assert [c.status for c in cases] == [cr.FAIL, cr.FAIL]
    assert "skills/c/SKILL.md, skills/d/SKILL.md" in cases[0].evidence
    assert totals == {"files": 4, "description_chars": 15}
    good, _ = cr.check_documents(
        "agente", {"agents/A.md": "---\nname: A\ndescription: d\n---\n"}
    )
    assert [(c.name, c.status) for c in good] == [
        ("skills/agente-frontmatter", cr.OK),
        ("skills/agente-nomes-unicos", cr.OK),
    ]
    assert cr.check_documents("skill", {})[0][0].status == cr.FAIL


def test_check_mcp_never_leaks_env_headers_or_url_secrets() -> None:
    config = {
        "mcpServers": {
            "a": {"command": "npx", "env": {"KEY": "segredo-env"}},
            "b": {"command": "inexistente"},
            "c": {
                "url": "https://mcp.example.com/x?key=segredo-url",
                "headers": {"h": "segredo-header"},
            },
            "d": {"url": "ftp://x"},
            "e": {},
            "f": "x",
        }
    }
    cases = cr.check_mcp(config, lambda name: "/bin/npx" if name == "npx" else None)
    assert [c.status for c in cases] == [
        cr.OK,
        cr.FAIL,
        cr.OK,
        cr.FAIL,
        cr.FAIL,
        cr.FAIL,
        cr.SKIP,
    ]
    assert cases[2].evidence == "estático: URL https://mcp.example.com"
    assert "segredo" not in "".join(c.evidence for c in cases)
    assert [c.name for c in cr.check_mcp({})] == ["mcp/declarados", "mcp/tools-list"]


def test_find_commands_is_static() -> None:
    sources = {
        "extensions/goal.ts": "x\n  pi.registerCommand('goal', {\n",
        "claude-home/commands/plan.md": "---\n---\n",
        "extensions/other.ts": "pi.registerCommand('subagents-setup', {",
    }
    cases = cr.find_commands(sources, ["goal", "plan", "subagents"])
    assert [c.status for c in cases] == [cr.OK, cr.OK, cr.FAIL]
    assert cases[0].evidence == "estático: registrado em extensions/goal.ts:2"
    assert cases[1].evidence.endswith("claude-home/commands/plan.md")

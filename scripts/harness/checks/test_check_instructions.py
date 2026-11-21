"""Tests for check-instructions.py on synthetic resource trees."""

import importlib.util
import json
import subprocess
import tempfile
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from unittest import mock

spec = importlib.util.spec_from_file_location(
    "check_instructions", Path(__file__).resolve().parent / "check-instructions.py"
)
assert spec is not None and spec.loader is not None
ci = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ci)


def write(path: Path, text: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    return path


class Helpers(unittest.TestCase):
    def test_strip_block_comments_keeps_fenced_code(self) -> None:
        text = "a\n<!-- one-line -->\n<!--\nhidden\n-->\n```\n<!-- kept -->\n```\nb"
        self.assertEqual(ci.strip_block_comments(text), "a\n```\n<!-- kept -->\n```\nb")

    def test_split_frontmatter(self) -> None:
        self.assertEqual(ci.split_frontmatter("---\na: 1\n---\nbody"), ("a: 1", "body"))
        self.assertEqual(ci.split_frontmatter("body"), (None, "body"))

    def test_code_spans_skip_fences(self) -> None:
        spans = ci.code_spans("see `x` here\n```\n`y`\n```\n`z`")
        self.assertEqual([s for _, s in spans], ["x", "z"])

    def test_check_paths(self) -> None:
        self.assertEqual(
            ci.check_paths("~/definitely/missing/file.txt."),
            ["caminho inexistente: ~/definitely/missing/file.txt"],
        )
        self.assertEqual(ci.check_paths("~/glob/*"), [])
        self.assertEqual(ci.check_paths("~/.nycode/agent/claude-hud.json"), [])


class CheckFile(unittest.TestCase):
    def check(
        self,
        kind: str,
        text: str,
        tools: set[str] | None = None,
        servers: set[str] | None = None,
    ) -> list[str]:
        with tempfile.TemporaryDirectory() as tmp:
            path = write(Path(tmp) / "f.md", text)
            with mock.patch.object(ci, "SKILLS", {"known-skill"}):
                return ci.check_file(path, kind, tools, servers, {"help", "skill"})  # type: ignore[no-any-return]

    def test_rule_frontmatter(self) -> None:
        self.assertEqual(self.check("rule", "---\npaths: x\n---\nok"), [])
        self.assertTrue(
            any(
                "só aceita paths" in p
                for p in self.check("rule", "---\nname: x\n---\nok")
            )
        )
        self.assertTrue(
            any(
                "frontmatter inválido" in p
                for p in self.check("rule", "---\na: [\n---\nok")
            )
        )

    def test_command_needs_description(self) -> None:
        self.assertIn(
            "command sem description", self.check("command", "---\nx: 1\n---\nbody")
        )
        self.assertEqual(self.check("command", "---\ndescription: d\n---\nbody"), [])
        self.assertTrue(
            any(
                "frontmatter inválido" in p
                for p in self.check("command", "---\na: [\n---\nb")
            )
        )

    def test_contract_limits_and_imports(self) -> None:
        long_text = "\n".join(["line"] * 200)
        self.assertTrue(any("linhas" in p for p in self.check("claude", long_text)))
        self.assertTrue(
            any(
                "@foo seria tratado" in p for p in self.check("claude", "use @foo here")
            )
        )
        self.assertEqual(self.check("claude", "use `@foo` here"), [])

    def test_names_commands_skills(self) -> None:
        text = "`unknown-name` `known-skill` `/help` `/nope` `/skill:known-skill` `/skill:missing` `/skill:<name>`"
        probs = self.check("rule", text)
        self.assertIn("nome desconhecido (skill/agente?): unknown-name", probs)
        self.assertIn("comando inexistente no nycode: /nope", probs)
        self.assertIn("skill inexistente: missing", probs)
        self.assertEqual(len(probs), 3)

    def test_mcp_names(self) -> None:
        text = "`mcp__ghost__tool` `mcp__real__nope` `mcp__real__yes`"
        probs = self.check("rule", text, {"mcp__real__yes"}, {"real"})
        self.assertEqual(
            probs,
            [
                "servidor MCP inexistente: mcp__ghost__tool",
                "ferramenta MCP inexistente: mcp__real__nope",
            ],
        )
        self.assertEqual(self.check("rule", text), [])

    def test_claude_only_vocabulary(self) -> None:
        probs = self.check("rule", "Use ToolSearch now\nNo ToolSearch here")
        self.assertEqual(probs, ["linha 1: ToolSearch (nycode: tool_search)"])


class Tree(unittest.TestCase):
    def test_check_skills(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write(root / "skills/ok/SKILL.md", "---\nname: ok\ndescription: d\n---\n")
            write(root / "skills/nofm/SKILL.md", "body")
            write(root / "skills/badyaml/SKILL.md", "---\na: [\n---\n")
            write(root / "skills/notmap/SKILL.md", "---\n- a\n---\n")
            write(
                root / "skills/wrong/SKILL.md",
                "---\nname: other\ndescription: ' '\n---\n",
            )
            (root / "skills/empty").mkdir()
            with mock.patch.object(ci, "RESOURCES", root):
                probs = ci.check_skills()
        self.assertEqual(len(probs), 5)
        self.assertIn("skills/nofm/SKILL.md: sem frontmatter", probs)
        self.assertTrue(any("YAML inválido" in p for p in probs))
        self.assertIn("skills/notmap/SKILL.md: frontmatter não é um mapa", probs)
        self.assertIn("skills/wrong/SKILL.md: name 'other' != diretório 'wrong'", probs)
        self.assertIn("skills/wrong/SKILL.md: description ausente ou vazia", probs)

    def test_slash_commands(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write(root / "ext/a.ts", 'api.registerCommand("alpha", {})')
            write(root / "slash.md", "| `/beta [x]` | d |\n")
            write(root / "res/commands/gamma.md", "x")
            with (
                mock.patch.object(ci, "EXT_DIRS", [root / "ext"]),
                mock.patch.object(ci, "SLASH_DOC", root / "slash.md"),
                mock.patch.object(ci, "RESOURCES", root / "res"),
            ):
                self.assertEqual(
                    ci.slash_commands(), {"skill", "alpha", "beta", "gamma"}
                )

    def test_mcp_tools_from_cache_and_without_binary(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            cache = Path(tmp) / "mcp.json"
            data = {"servers": [{"name": "my-srv", "tools": ["t-1", {"name": "t2"}]}]}
            cache.write_text(json.dumps(data))
            with mock.patch.object(ci, "CACHE", cache):
                self.assertEqual(
                    ci.mcp_tools(False),
                    ({"mcp__my_srv__t_1", "mcp__my_srv__t2"}, {"my_srv"}),
                )
                with mock.patch.object(ci.shutil, "which", return_value=None):
                    self.assertIsNone(ci.mcp_tools(True))
                done = subprocess.CompletedProcess(
                    [], 0, stdout=json.dumps({"servers": []})
                )
                with (
                    mock.patch.object(ci.shutil, "which", return_value="/bin/nycode"),
                    mock.patch.object(ci.subprocess, "run", return_value=done),
                ):
                    self.assertEqual(ci.mcp_tools(True), (set(), set()))

    def test_check_arg_expansion(self) -> None:
        hits = json.dumps([{"file": "skills/x/SKILL.md", "line": 3, "text": "run $1"}])
        done = subprocess.CompletedProcess([], 0, stdout=hits)
        with mock.patch.object(ci.subprocess, "run", return_value=done):
            self.assertEqual(len(ci.check_arg_expansion()), 1)
        with mock.patch.object(ci.subprocess, "run", side_effect=OSError("no node")):
            self.assertIn("detector de $N falhou", ci.check_arg_expansion()[0])

    def test_main_reports_problems_and_clean_tree(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write(root / "instructions/contract.md", "clean")
            write(root / "rules/r.md", "bad `/nope`")
            write(root / "rules/ref/x.md", "ref")
            write(root / "commands/c.md", "---\ndescription: d\n---\nbody")
            write(root / "skills/s/SKILL.md", "---\nname: s\ndescription: d\n---\n")
            with (
                mock.patch.object(ci, "RESOURCES", root),
                mock.patch.object(ci, "mcp_tools", return_value=None),
                mock.patch.object(ci, "slash_commands", return_value={"c"}),
                mock.patch.object(ci, "check_arg_expansion", return_value=[]),
                mock.patch.object(ci.sys, "argv", ["check-instructions.py"]),
            ):
                out = StringIO()
                with redirect_stdout(out):
                    self.assertEqual(ci.main(), 1)
                self.assertIn(
                    "rules/r.md: comando inexistente no nycode: /nope", out.getvalue()
                )
                write(root / "rules/r.md", "fine")
                out = StringIO()
                with redirect_stdout(out):
                    self.assertEqual(ci.main(), 0)
                self.assertIn("0 problema(s)", out.getvalue())


if __name__ == "__main__":
    unittest.main()

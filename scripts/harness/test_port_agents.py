"""Tests for port-agents.py: tool mapping, frontmatter conversion and the --dry-run / write paths."""

import importlib.util
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from unittest import mock

spec = importlib.util.spec_from_file_location(
    "port_agents", Path(__file__).resolve().parent / "port-agents.py"
)
assert spec is not None and spec.loader is not None
pa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pa)

AGENT = """---
name: demo
tools: Read, Grep, Skill, WebFetch, mcp__exa__web_search, mcp__plugin_x_y__z, mcp__fetch__get
disallowedTools: Agent, Write
omitClaudeMd: true
---
See ~/.claude/skills/x and ~/.claude/agents/y.
"""


class PortAgents(unittest.TestCase):
    def test_map_tool(self) -> None:
        self.assertEqual(pa.map_tool(" Read "), ["read"])
        self.assertEqual(pa.map_tool("Skill"), [])
        self.assertEqual(pa.map_tool("Bogus"), [])
        self.assertEqual(pa.map_tool(""), [])
        self.assertEqual(pa.map_tool("mcp__exa__web-search"), ["mcp__exa__web_search"])
        self.assertEqual(pa.map_tool("mcp__exa"), ["mcp__exa__*"])
        self.assertEqual(pa.map_tool("mcp__fetch__get"), ["web_fetch"])
        self.assertEqual(
            pa.map_tool("mcp__plugin_parallel_parallel-search__q"), ["mcp__parallel__q"]
        )
        self.assertEqual(
            pa.map_tool("mcp__claude_ai_Linear__list"), ["mcp__linear__list"]
        )
        self.assertEqual(pa.map_tool("mcp__plugin_other__x"), [])
        self.assertEqual(pa.map_tool("mcp__unknown__x"), [])

    def test_parse_list(self) -> None:
        self.assertEqual(pa.parse_list("[a, b ,,c]"), ["a", "b", "c"])
        self.assertEqual(pa.parse_list("a"), ["a"])

    def test_convert(self) -> None:
        out = pa.convert(AGENT)
        self.assertIn(
            "tools: read, grep, web_fetch, mcp__exa__web_search, tool_search", out
        )
        self.assertNotIn("disallowedTools: subagent", out)
        self.assertIn("disallowedTools: write", out)
        self.assertNotIn("omitClaudeMd", out)
        self.assertIn("${NYCODE_RESOURCES}/skills/x", out)
        self.assertIn("${NYCODE_RESOURCES}/agents/y", out)
        with self.assertRaises(ValueError):
            pa.convert("no frontmatter")

    def test_main_dry_run_and_write(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            src, dst = Path(tmp) / "src", Path(tmp) / "dst" / "agents"
            src.mkdir()
            (src / "demo.md").write_text(AGENT)
            with mock.patch.object(pa, "SRC", src), mock.patch.object(pa, "DST", dst):
                out = StringIO()
                with (
                    mock.patch.object(sys, "argv", ["port-agents.py", "--dry-run"]),
                    redirect_stdout(out),
                ):
                    pa.main()
                self.assertIn("== demo.md", out.getvalue())
                self.assertFalse((dst / "demo.md").exists())
                out = StringIO()
                with (
                    mock.patch.object(sys, "argv", ["port-agents.py"]),
                    redirect_stdout(out),
                ):
                    pa.main()
                self.assertIn("portados: 1", out.getvalue())
                self.assertIn("name: demo", (dst / "demo.md").read_text())


if __name__ == "__main__":
    unittest.main()

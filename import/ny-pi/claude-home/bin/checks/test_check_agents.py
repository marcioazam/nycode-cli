"""Testes do check-agents.py com agentes sintéticos; o diretório real de agentes não é lido."""
import contextlib
import importlib.util
import io
import tempfile
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location('check_agents', Path(__file__).resolve().parent / 'check-agents.py')
ca = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ca)

HEAD = '---\nname: x\ndescription: d\nmodel: anthropic/claude-sonnet-5-5\n---\n'


def problems(body: str) -> list[str]:
    with tempfile.TemporaryDirectory() as d:
        path = Path(d) / 'x.md'
        path.write_text(HEAD + body)
        return ca.check(path, set(), set(), set())


class BodyReachesTheAgent(unittest.TestCase):
    # O pi-code passa o corpo inteiro como system prompt (subagent/agents.ts: `systemPrompt: body`), sem tirar
    # comentários HTML; antes do conserto o checador os apagava e um caminho do Claude num comentário passava.
    def test_html_comment_is_checked(self):
        found = problems('Body.\n<!--\nOrigin: ~/.claude/agents/x.md\n-->\n')
        self.assertTrue(any('caminho do Claude Code' in p for p in found), found)

    def test_clean_body_passes(self):
        self.assertEqual(problems('Body.\n<!-- Origin: the Claude agent x, ported 2026-11. -->\n'), [])


class Frontmatter(unittest.TestCase):
    def write(self, d: str, name: str, text: str) -> Path:
        path = Path(d) / name
        path.write_text(text)
        return path

    def test_rejects_bad_files(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(ca.check(self.write(d, 'a.md', 'no front'), set(), set(), set()), ['a.md: sem frontmatter'])
            bad = ca.check(self.write(d, 'b.md', '---\nname: [x\n---\nB\n'), set(), set(), set())
            self.assertTrue(bad[0].startswith('b.md: YAML inválido'), bad)

    def test_fields_tools_and_paths(self):
        servers, names, unauth = {'srv', 'auth'}, {'mcp__srv__get'}, {'auth'}
        fm = ('---\nname: other\ndescription: ""\nmodel: sonnet\neffort: huge\nskills: [nope-skill]\n'
              'tools: read, mcp__srv__get, mcp__srv__*, mcp__auth__x, mcp__srv__authenticate, fake, mcp__srv__get2\n'
              'disallowedTools: [write]\n---\nSee ~/no/such/file and ~/<n>.md\n')
        with tempfile.TemporaryDirectory() as d:
            found = ca.check(self.write(d, 'c.md', fm), servers, names, unauth)
        joined = '\n'.join(found)
        for expected in ("name 'other' != arquivo", 'description vazia', "tools: 'fake' não existe no pi",
                         "tools: 'mcp__srv__get2' não existe no pi", 'tools tem MCP deferido mas não tool_search',
                         "model 'sonnet': use provider/id", "effort 'huge' inválido", "skill 'nope-skill' inexistente",
                         'caminho inexistente: ~/no/such/file'):
            self.assertIn(expected, joined)
        self.assertNotIn('<n>', joined)
        self.assertEqual(len(found), 9, found)


class McpNamesAndMain(unittest.TestCase):
    def test_mcp_names_from_cache(self):
        with tempfile.TemporaryDirectory() as d:
            cache = Path(d) / 'mcp.json'
            cache.write_text('{"servers": [{"name": "a-b", "state": "connected", "tools": ["get-x"]},'
                             ' {"name": "c", "state": "needs-auth"}]}')
            old, ca.CACHE = ca.CACHE, cache
            try:
                self.assertEqual(ca.mcp_names(False), ({'a_b', 'c'}, {'mcp__a_b__get_x'}, {'c'}))
            finally:
                ca.CACHE = old

    def test_main_exit_codes(self):
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / 'x.md').write_text(HEAD + 'Body.\n')
            (Path(d) / 'y.md').write_text('no front')
            old = (ca.AGENTS, ca.mcp_names, ca.sys.argv)
            ca.AGENTS, ca.mcp_names = Path(d), lambda refresh: (set(), set(), set())
            try:
                # A saída vai para um buffer (sem ruído no terminal) e a mensagem de cada caso é conferida.
                for argv, code, msg in ((['c', 'x.md'], 0, 'OK: 1 agentes'), (['c'], 1, 'y.md: sem frontmatter')):
                    ca.sys.argv, out = argv, io.StringIO()
                    with self.assertRaises(SystemExit) as end, contextlib.redirect_stdout(out):
                        ca.main()
                    self.assertEqual(end.exception.code, code)
                    self.assertIn(msg, out.getvalue())
            finally:
                ca.AGENTS, ca.mcp_names, ca.sys.argv = old


if __name__ == '__main__':
    unittest.main()

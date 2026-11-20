"""Testes do graph_context.py (SessionStart/SubagentStart do pi-code). Rodar: python3 -m unittest -v test_graph_context"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
HOOK = os.path.join(HERE, "graph_context.py")


def run(event, cwd, env_extra=None, raw=None):
    env = {**os.environ, "CODEGRAPH_STATUS_TTL": "0", **(env_extra or {})}
    payload = raw if raw is not None else json.dumps({"hook_event_name": event, "cwd": cwd})
    p = subprocess.run([sys.executable, HOOK], input=payload, capture_output=True, text=True, env=env, timeout=20)
    assert p.returncode == 0, p.stderr
    out = p.stdout.strip()
    return json.loads(out)["hookSpecificOutput"]["additionalContext"] if out else None


def git_repo(path):
    subprocess.run(["git", "init", "-q", path], check=True)
    return path


class TestGraphContext(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="gctx-")
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.brain = os.path.join(self.tmp, "brain")
        os.makedirs(os.path.join(self.brain, "Projects"))
        self.env = {"PI_KNOWLEDGE_VAULT": self.brain, "PI_GRAPHS_VAULT": os.path.join(self.tmp, "graphs"),
                    "CODEGRAPH_AUTO_ROOT": os.path.join(self.tmp, "source"),
                    "CODEGRAPH_AUTO_STATE": os.path.join(self.tmp, "state")}

    def fake_codegraph(self, status):
        path = os.path.join(self.tmp, "codegraph")
        with open(path, "w") as f:
            f.write("#!/bin/sh\necho '" + json.dumps(status) + "'\n")
        os.chmod(path, 0o755)
        return path

    def test_non_git_cwd_gets_pi_workspace_line(self):
        ctx = run("SessionStart", self.tmp, self.env)
        self.assertIn("Workspace:", ctx)
        self.assertIn("subagent has no isolation field", ctx)
        self.assertNotIn("omit the isolation field", ctx)

    def test_indexed_repo_routes_through_tool_search(self):
        repo = git_repo(os.path.join(self.tmp, "repo"))
        os.makedirs(os.path.join(repo, ".codegraph"))
        open(os.path.join(repo, ".codegraph", "codegraph.db"), "w").close()
        env = {**self.env, "CODEGRAPH_BIN": self.fake_codegraph({"initialized": True, "pendingChanges": {}, "index": {"state": "complete"}, "lastIndexed": "2026-11-11T10:00"})}
        ctx = run("SubagentStart", repo, env)
        self.assertIn(f"Graph: codegraph root={repo} index=fresh", ctx)
        self.assertIn("tool_search", ctx)
        self.assertNotIn("ToolSearch", ctx)
        self.assertNotIn("Knowledge vault:", ctx)  # só no SessionStart

    def test_session_start_lists_brain_route_with_pi_kb_path(self):
        repo = git_repo(os.path.join(self.tmp, "myrepo"))
        ctx = run("SessionStart", repo, self.env)
        self.assertIn("Graph:", ctx)
        self.assertIn("no codegraph index", ctx)
        self.assertNotIn("fff", ctx)
        self.assertIn("Knowledge vault:", ctx)
        self.assertIn("~/.pi/agent/claude-home/skills/obsidian-cli/scripts/kb.py", ctx)

    def test_brain_notes_for_repo_listed(self):
        repo = git_repo(os.path.join(self.tmp, "acme"))
        os.makedirs(os.path.join(self.brain, "Projects", "Acme"))
        open(os.path.join(self.brain, "Projects", "Acme", "Decisions.md"), "w").close()
        ctx = run("SessionStart", repo, self.env)
        self.assertIn("Projects/Acme/Decisions.md", ctx)

    def test_session_start_without_knowledge_vault_skips_the_line(self):
        repo = git_repo(os.path.join(self.tmp, "myrepo"))
        env = {**os.environ, **self.env, "PI_KNOWLEDGE_VAULT": ""}
        ctx = run("SessionStart", repo, env)
        self.assertIn("Graph:", ctx)
        self.assertNotIn("Knowledge vault:", ctx)

    def test_other_events_and_bad_input_are_silent(self):
        self.assertIsNone(run("PreToolUse", self.tmp, self.env))
        self.assertIsNone(run("SessionStart", self.tmp, self.env, raw="not json"))


if __name__ == "__main__":
    unittest.main()

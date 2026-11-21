"""Testes de pi_telemetry.py com uma sessão sintética. Rodar: python3 -m unittest test_pi_telemetry (em bin/telemetry/)."""
import json
import tempfile
import unittest
from pathlib import Path

import pi_telemetry as t


def call(cid, name, args):
    return {"type": "message", "message": {"role": "assistant", "content": [{"type": "toolCall", "id": cid, "name": name, "arguments": args}]}}


def result(cid, name, text, error=False, details=None):
    return {"type": "message", "message": {"role": "toolResult", "toolCallId": cid, "toolName": name, "isError": error,
                                           "content": [{"type": "text", "text": text}], "details": details}}


def say(role, text, cost=0.0):
    msg = {"role": role, "content": [{"type": "text", "text": text}]}
    if cost:
        msg["usage"] = {"cost": {"total": cost}}
    return {"type": "message", "message": msg}


class TelemetryTest(unittest.TestCase):
    def run_on(self, entries):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "proj" / "s.jsonl"
            p.parent.mkdir()
            p.write_text("\n".join(json.dumps(e) for e in entries) + "\n")
            return t.sessions(Path(d), 1)

    def test_claims_supported_and_unsupported(self):
        found = self.run_on([
            say("user", "corrija"),
            call("1", "edit", {"path": "a.py"}), result("1", "edit", "ok"),
            call("2", "bash", {"command": "pytest -q"}), result("2", "bash", "3 passed in 0.1s"),
            say("assistant", "Todos os testes passam."),
            say("user", "mais"),
            call("3", "write", {"path": "b.py"}), result("3", "write", "ok"),
            say("assistant", "All tests pass."),
        ])
        r = t.report_claims(found)
        self.assertEqual(r["status"], {"supported": 1, "unsupported": 1})
        self.assertEqual(r["reasons"], {"test-run-ok": 1, "no-run-since-edit": 1})

    def test_failed_exit_code_is_not_evidence(self):
        found = self.run_on([
            call("1", "edit", {"path": "a.py"}), result("1", "edit", "ok"),
            call("2", "bash", {"command": "pytest -q"}), result("2", "bash", "boom\n\nCommand exited with code 2", error=True),
            say("assistant", "The tests pass."),
        ])
        self.assertEqual(t.report_claims(found)["status"], {"unsupported": 1})

    def test_audit_subagents_cost_tools(self):
        details = {"results": [{"agent": "gate-runner", "exitCode": 1, "model": "m", "usage": {"turns": 2, "cost": 0.5}}]}
        found = self.run_on([
            call("1", "bash", {"command": "rm -rf build && curl -H 'Authorization: Bearer abcdefabcdefabcdefabcdefabcdefabcdef' x"}),
            result("1", "bash", "Bloqueado pelo guard", error=True),
            call("2", "read", {"path": "/x/.ssh/id_rsa"}), result("2", "read", "x"),
            call("3", "read", {"path": "/x/skills/tdd/SKILL.md"}), result("3", "read", "x"),
            call("4", "subagent", {"agent": "gate-runner", "task": "t"}), result("4", "subagent", "x", details=details),
            call("5", "mcp__exa__web_search_exa", {}), result("5", "mcp__exa__web_search_exa", "x"),
            call("6", "mcp__keenable__search_web_pages", {}), result("6", "mcp__keenable__search_web_pages", "x"),
            say("assistant", "fim", cost=1.25),
        ])
        audit = t.report_audit(found)
        self.assertEqual([(a["kind"], a["blocked"]) for a in audit], [("destructive", True), ("credential", False)])
        self.assertNotIn("abcdefabcdef", audit[0]["target"])
        self.assertEqual(t.report_subagents(found)["gate-runner"]["failed"], 1)
        self.assertEqual(t.report_cost(found), {"main_usd": 1.25, "subagents_usd": 0.5, "total_usd": 1.75})
        tools = t.report_tools(found)
        self.assertEqual(tools["skills"], {"tdd": 1})
        self.assertEqual(tools["multi_provider_sessions"], 1)


if __name__ == "__main__":
    unittest.main()

"""Tests of oracle.py, the guard.py oracle of the differential test (guard-differential.test.ts)."""

import json
import os
import subprocess
import sys
import unittest

import oracle

HERE = os.path.dirname(os.path.abspath(__file__))
ORACLE = os.path.join(HERE, "oracle.py")


def run_oracle(*args: str, stdin: str = "") -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, ORACLE, *args],
        input=stdin,
        capture_output=True,
        text=True,
        check=False,
    )


class OracleTest(unittest.TestCase):
    def test_corpus_holds_the_guard_test_literals_once(self) -> None:
        items = oracle.corpus()
        self.assertGreater(len(items), 300)
        self.assertEqual(len(items), len(set(items)))
        self.assertTrue(all(len(text) <= 4096 for text in items))

    def test_decide_gives_the_guard_verdict(self) -> None:
        cases = [
            {"tool": "Bash", "input": {"command": "ls"}, "cwd": "/tmp"},
            {"tool": "Bash", "input": {"command": "rm -rf /"}, "cwd": "/tmp"},
        ]
        allow, deny = oracle.decide(cases)
        self.assertIsNone(allow)
        self.assertEqual(deny[0], "deny")

    def test_decide_reports_an_exception_of_the_guard(self) -> None:
        verdict = oracle.decide(
            [{"tool": "Read", "input": {"file_path": "/tmp/a\0b"}, "cwd": "/tmp"}]
        )
        self.assertEqual(verdict[0][0], "error")

    def test_command_line_modes(self) -> None:
        corpus = run_oracle("corpus")
        self.assertEqual(corpus.returncode, 0)
        self.assertIsInstance(json.loads(corpus.stdout), list)
        case = {"tool": "Bash", "input": {"command": "ls"}, "cwd": "/tmp"}
        decided = run_oracle("decide", stdin=json.dumps([case]))
        self.assertEqual(json.loads(decided.stdout), [None])
        self.assertNotEqual(run_oracle("nope").returncode, 0)


if __name__ == "__main__":
    unittest.main()

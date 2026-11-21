import importlib.util
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from typing import Any

spec = importlib.util.spec_from_file_location(
    "skill_usage", Path(__file__).resolve().parent / "skill-usage.py"
)
assert spec is not None and spec.loader is not None
su = importlib.util.module_from_spec(spec)
spec.loader.exec_module(su)


def rec(role: str, content: list[dict[str, Any]], ts: str) -> str:
    return json.dumps(
        {
            "type": "message",
            "timestamp": ts,
            "message": {"role": role, "content": content},
        }
    )


class SkillUsage(unittest.TestCase):
    def test_counts_only_tool_calls_and_commands(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            t = Path(tmp)
            for n, fm in (
                ("alpha", "name: alpha\\ndescription: aa"),
                (
                    "beta",
                    "name: beta\\ndescription: bbbb\\ndisable-model-invocation: true",
                ),
                ("gamma", "name: gamma\\ndescription: g"),
            ):
                (t / "skills" / n).mkdir(parents=True)
                (t / "skills" / n / "SKILL.md").write_text(
                    f"---\n{fm.replace(chr(92) + 'n', chr(10))}\n---\nbody\n"
                )
            lines = [
                rec(
                    "assistant",
                    [
                        {
                            "type": "toolCall",
                            "name": "read",
                            "arguments": {"path": "/x/skills/alpha/SKILL.md"},
                        }
                    ],
                    "2026-01-02T00:00:00Z",
                ),
                rec(
                    "assistant",
                    [
                        {
                            "type": "toolCall",
                            "name": "bash",
                            "arguments": {"path": "/x/skills/gamma/SKILL.md"},
                        }
                    ],
                    "2026-01-02T00:00:00Z",
                ),
                rec(
                    "user",
                    [{"type": "text", "text": "/skill:beta do it"}],
                    "2026-01-03T00:00:00Z",
                ),
                rec(
                    "user",
                    [
                        {
                            "type": "text",
                            "text": "<available_skills> skills/gamma/SKILL.md /skill:gamma",
                        }
                    ],
                    "2026-01-03T00:00:00Z",
                ),
            ]
            (t / "s").mkdir()
            (t / "s" / "a.jsonl").write_text("\n".join(lines) + "\nnot json skill\n")
            cat = su.catalog(t / "skills")
            su.tally(cat, t / "s")
            self.assertEqual(
                (cat["alpha"]["uses"], cat["beta"]["uses"], cat["gamma"]["uses"]),
                (1, 1, 0),
            )
            self.assertEqual(cat["beta"]["visible"], False)
            self.assertEqual(cat["alpha"]["last_used"], "2026-01-02")
            self.assertEqual(cat["alpha"]["description_bytes"], 2)
            su.tally(c2 := su.catalog(t / "skills"), t / "s", "2026-01-03")
            self.assertEqual(c2["alpha"]["uses"], 0)

    def test_main_reports_unused_and_json(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            t = Path(tmp)
            (t / "skills" / "alpha").mkdir(parents=True)
            (t / "skills" / "alpha" / "SKILL.md").write_text(
                "---\nname: alpha\ndescription: aa\n---\n"
            )
            (t / "s").mkdir()
            base = ["--sessions", str(t / "s"), "--skills", str(t / "skills")]
            out = StringIO()
            with redirect_stdout(out):
                self.assertEqual(su.main([*base, "--unused"]), 0)
            self.assertIn("alpha\tvisible\t2B\t0 uses", out.getvalue())
            self.assertIn("1 visible-unused", out.getvalue())
            out = StringIO()
            with redirect_stdout(out):
                self.assertEqual(su.main([*base, "--json"]), 0)
            self.assertEqual(json.loads(out.getvalue())["summary"]["skills"], 1)


if __name__ == "__main__":
    unittest.main()

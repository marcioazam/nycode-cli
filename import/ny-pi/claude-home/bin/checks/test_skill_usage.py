import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("skill_usage", Path(__file__).resolve().parent / "skill-usage.py")
su = importlib.util.module_from_spec(spec)
spec.loader.exec_module(su)


def rec(role, content, ts):
    return json.dumps({"type": "message", "timestamp": ts, "message": {"role": role, "content": content}})


class SkillUsage(unittest.TestCase):
    def test_counts_only_tool_calls_and_commands(self):
        with tempfile.TemporaryDirectory() as t:
            t = Path(t)
            for n, fm in (("alpha", "name: alpha\\ndescription: aa"), ("beta", "name: beta\\ndescription: bbbb\\ndisable-model-invocation: true"),
                          ("gamma", "name: gamma\\ndescription: g")):
                (t / "skills" / n).mkdir(parents=True)
                (t / "skills" / n / "SKILL.md").write_text(f"---\n{fm.replace(chr(92) + 'n', chr(10))}\n---\nbody\n")
            lines = [
                rec("assistant", [{"type": "toolCall", "name": "read", "arguments": {"path": "/x/skills/alpha/SKILL.md"}}], "2026-01-02T00:00:00Z"),
                rec("assistant", [{"type": "toolCall", "name": "bash", "arguments": {"path": "/x/skills/gamma/SKILL.md"}}], "2026-01-02T00:00:00Z"),
                rec("user", [{"type": "text", "text": "/skill:beta do it"}], "2026-01-03T00:00:00Z"),
                rec("user", [{"type": "text", "text": "<available_skills> skills/gamma/SKILL.md /skill:gamma"}], "2026-01-03T00:00:00Z"),
            ]
            (t / "s").mkdir()
            (t / "s" / "a.jsonl").write_text("\n".join(lines) + "\nnot json skill\n")
            cat = su.catalog(t / "skills")
            su.tally(cat, t / "s")
            self.assertEqual((cat["alpha"]["uses"], cat["beta"]["uses"], cat["gamma"]["uses"]), (1, 1, 0))
            self.assertEqual(cat["beta"]["visible"], False)
            self.assertEqual(cat["alpha"]["last_used"], "2026-01-02")
            self.assertEqual(cat["alpha"]["description_bytes"], 2)
            su.tally(c2 := su.catalog(t / "skills"), t / "s", "2026-01-03")
            self.assertEqual(c2["alpha"]["uses"], 0)


if __name__ == "__main__":
    unittest.main()

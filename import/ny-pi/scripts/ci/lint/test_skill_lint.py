"""Self-test of skill_lint.py; run before the linter is trusted on the repo."""

import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).parent))
import skill_lint
import structure_changed

GOOD_DESC = "Does something useful for tests in a bounded way."


def make(
    root: Path, dirname: str, name: str | None, desc: str | None, body: str = "# x\n"
) -> Path:
    d = root / dirname
    d.mkdir(parents=True)
    fm = []
    if name is not None:
        fm.append(f"name: {name}")
    if desc is not None:
        fm.append(f"description: {desc}")
    p = d / "SKILL.md"
    p.write_text("---\n" + "\n".join(fm) + "\n---\n" + body, encoding="utf-8")
    return p


class SkillLintTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.addCleanup(self._tmp.cleanup)

    def problems(self, **kw: Any) -> list[str]:
        p = make(self.root, kw.pop("dirname", "my-skill"), **kw)
        return skill_lint.lint_skill(p)

    def test_valid_skill_passes(self) -> None:
        self.assertEqual(self.problems(name="my-skill", desc=GOOD_DESC), [])

    def test_name_must_match_directory(self) -> None:
        self.assertTrue(
            any("differs" in m for m in self.problems(name="other", desc=GOOD_DESC))
        )

    def test_name_must_be_kebab(self) -> None:
        out = self.problems(dirname="My_Skill", name="My_Skill", desc=GOOD_DESC)
        self.assertTrue(any("kebab" in m for m in out))

    def test_name_longer_than_64_fails(self) -> None:
        n = "a" * 65
        self.assertTrue(
            any("kebab" in m for m in self.problems(dirname=n, name=n, desc=GOOD_DESC))
        )

    def test_name_of_64_passes(self) -> None:
        n = "a" * 64
        self.assertEqual(self.problems(dirname=n, name=n, desc=GOOD_DESC), [])

    def test_description_bounds(self) -> None:
        self.assertTrue(self.problems(name="my-skill", desc="too short"))
        self.assertEqual(self.problems(dirname="a-1", name="a-1", desc="x" * 20), [])
        self.assertEqual(self.problems(dirname="a-2", name="a-2", desc="x" * 1024), [])
        self.assertTrue(self.problems(dirname="a-3", name="a-3", desc="x" * 1025))

    def test_missing_fields_fail(self) -> None:
        self.assertTrue(self.problems(name=None, desc=GOOD_DESC))
        self.assertTrue(self.problems(dirname="b-1", name="b-1", desc=None))

    def test_line_limit(self) -> None:
        ok = self.problems(dirname="c-1", name="c-1", desc=GOOD_DESC, body="x\n" * 495)
        self.assertEqual(ok, [])
        bad = self.problems(dirname="c-2", name="c-2", desc=GOOD_DESC, body="x\n" * 600)
        self.assertTrue(any("lines" in m for m in bad))

    def test_secret_detected(self) -> None:
        out = self.problems(
            dirname="d-1",
            name="d-1",
            desc=GOOD_DESC,
            body="key " + "AKIA" + "ABCDEFGHIJKLMNOP" + "\n",
        )
        self.assertTrue(any("secret" in m for m in out))

    def test_missing_frontmatter(self) -> None:
        d = self.root / "e-1"
        d.mkdir()
        (d / "SKILL.md").write_text("# no frontmatter\n", encoding="utf-8")
        self.assertEqual(skill_lint.lint_skill(d / "SKILL.md"), ["missing frontmatter"])

    def test_zero_skills_fails(self) -> None:
        self.assertEqual(skill_lint.main([str(self.root)]), 1)

    def test_main_exit_codes(self) -> None:
        make(self.root, "ok-skill", "ok-skill", GOOD_DESC)
        self.assertEqual(skill_lint.main([str(self.root)]), 0)
        make(self.root, "bad-skill", "other", GOOD_DESC)
        self.assertEqual(skill_lint.main([str(self.root)]), 1)


class StructureChangedTest(unittest.TestCase):
    """structure_changed.py shares this module so scripts/ci stays within 7 code files."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.addCleanup(self._tmp.cleanup)
        self.suffixes = frozenset({".py", ".sh"})

    def write(self, rel: str, lines: int) -> None:
        p = self.root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("x = 1\n" * lines, encoding="utf-8")

    def test_file_over_800_lines_fails_and_800_passes(self) -> None:
        self.write("a/big.py", 801)
        self.write("a/edge.py", 800)
        out = structure_changed.check(
            self.root, ["a/big.py", "a/edge.py"], self.suffixes
        )
        self.assertEqual(len(out), 1)
        self.assertIn("a/big.py", out[0])

    def test_untouched_legacy_never_blocks(self) -> None:
        self.write("legacy/big.py", 900)
        self.assertEqual(
            structure_changed.check(self.root, ["docs/readme.md"], self.suffixes), []
        )

    def test_directory_over_7_code_files_fails_only_when_touched(self) -> None:
        for i in range(8):
            self.write(f"d/f{i}.py", 1)
        self.write("ok/f.py", 1)
        out = structure_changed.check(self.root, ["d/f0.py"], self.suffixes)
        self.assertTrue(any("d/: 8 code files" in m for m in out))
        self.assertEqual(
            structure_changed.check(self.root, ["ok/f.py"], self.suffixes), []
        )

    def test_seven_files_pass_and_non_code_ignored(self) -> None:
        for i in range(7):
            self.write(f"d/f{i}.py", 1)
        (self.root / "d/notes.md").write_text("n\n", encoding="utf-8")
        self.assertEqual(
            structure_changed.check(self.root, ["d/f0.py"], self.suffixes), []
        )

    def test_deleted_files_are_skipped(self) -> None:
        self.assertEqual(
            structure_changed.check(self.root, ["gone.py"], self.suffixes), []
        )


if __name__ == "__main__":
    unittest.main()

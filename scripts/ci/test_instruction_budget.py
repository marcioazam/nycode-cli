import json
import tempfile
import unittest
from pathlib import Path

import instruction_budget as ib


def make_root(d: Path) -> None:
    h = d / "claude-home"
    (h / "rules").mkdir(parents=True)
    (h / "skills" / "s").mkdir(parents=True)
    (h / "agents").mkdir()
    (h / "CLAUDE.md").write_text("# regras\n" * 20)
    (h / "rules" / "a.md").write_text("regra\n" * 10)
    (h / "skills" / "s" / "SKILL.md").write_text(
        "---\nname: s\ndescription: d\nother: x\n---\ncorpo longo\n" * 1
    )
    (h / "agents" / "g.md").write_text("---\nname: g\ndescription: gg\n---\ncorpo\n")


class T(unittest.TestCase):
    def setUp(self) -> None:
        self._t = tempfile.TemporaryDirectory()
        self.root = Path(self._t.name)
        make_root(self.root)
        self.base = self.root / "base.json"
        self.assertEqual(
            ib.main(["update", "--root", str(self.root), "--baseline", str(self.base)]),
            0,
        )

    def tearDown(self) -> None:
        self._t.cleanup()

    def check(self, event: str | None = None) -> int:
        args = ["check", "--root", str(self.root), "--baseline", str(self.base)]
        args += ["--labels-from-event", event or ""]
        return ib.main(args)

    def grow(self) -> None:
        with (self.root / "claude-home" / "CLAUDE.md").open("a") as f:
            f.write("x" * 1024)

    def event(self, labels: list[str]) -> str:
        p = self.root / "ev.json"
        p.write_text(
            json.dumps({"pull_request": {"labels": [{"name": n} for n in labels]}})
        )
        return str(p)

    def test_equal(self) -> None:
        self.assertEqual(self.check(), 0)

    def test_increase_fails(self) -> None:
        self.grow()
        self.assertEqual(self.check(), 1)

    def test_label_allows(self) -> None:
        self.grow()
        self.assertEqual(self.check(self.event(["budget-increase"])), 0)

    def test_other_label_fails(self) -> None:
        self.grow()
        self.assertEqual(self.check(self.event(["x"])), 1)

    def test_reduction_passes(self) -> None:
        (self.root / "claude-home" / "CLAUDE.md").write_text("x")
        self.assertEqual(self.check(), 0)

    def test_missing_claude_md(self) -> None:
        (self.root / "claude-home" / "CLAUDE.md").unlink()
        self.assertEqual(self.check(), 2)

    def test_bad_baseline(self) -> None:
        self.base.write_text("{")
        self.assertEqual(self.check(), 2)

    def test_update_rewrites(self) -> None:
        self.grow()
        ib.main(["update", "--root", str(self.root), "--baseline", str(self.base)])
        data = json.loads(self.base.read_text())
        self.assertEqual(data["total"], sum(data["files"].values()))
        self.assertEqual(self.check(), 0)

    def test_frontmatter_only(self) -> None:
        self.assertEqual(
            ib.catalog_text(self.root / "claude-home/skills/s/SKILL.md"),
            "name: s\ndescription: d",
        )


if __name__ == "__main__":
    unittest.main()

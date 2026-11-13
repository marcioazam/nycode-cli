import importlib.util
import subprocess
import sys
from pathlib import Path

SCRIPT = Path(__file__).with_name("check-refs.py")
spec = importlib.util.spec_from_file_location("check_refs", SCRIPT)
cr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cr)


def make(tmp_path, files):
    for rel, text in files.items():
        p = tmp_path / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")
    return tmp_path


def base(tmp_path, doc, extra=None):
    files = {
        "claude-home/skills/tdd/SKILL.md": "# tdd\n",
        "claude-home/agents/swarm-worker.md": "# agent\n",
        "claude-home/docs/note.md": doc,
    }
    files.update(extra or {})
    return make(tmp_path, files)


def test_existing_references_pass(tmp_path):
    doc = "Load `tdd` skill, see skills/tdd/SKILL.md and /skill:tdd.\n" \
          "Use `swarm-worker` agent via {agent: swarm-worker}.\n" \
          "Read $CLAUDE_CONFIG_DIR/skills/tdd/SKILL.md and ~/.pi/agent/claude-home/agents/swarm-worker.md\n"
    assert cr.check(base(tmp_path, doc)) == []


def test_missing_skill_agent_path_reported_with_location(tmp_path):
    doc = "ok\nUse skills/ghost-skill/ here\nRun `nobody` agent\nSee $CLAUDE_CONFIG_DIR/docs/gone.md.\n"
    out = cr.check(base(tmp_path, doc))
    assert out == [
        "claude-home/docs/note.md:2: missing skill ghost-skill",
        "claude-home/docs/note.md:3: missing agent nobody",
        "claude-home/docs/note.md:4: missing path claude-home/docs/gone.md",
    ]


def test_contextual_skill_and_subagent_forms(tmp_path):
    doc = 'the `lost-one` skill\nload `other-lost`\nsubagent {agent: "ghost"}\n'
    kinds = sorted(o.split("missing ")[1] for o in cr.check(base(tmp_path, doc)))
    assert kinds == ["agent ghost", "skill lost-one", "skill other-lost"]


def test_optional_marker_on_line_or_bullet(tmp_path):
    doc = "Use skills/aaa-bbb/ (optional)\n- Use skills/ccc-ddd/ and more\n  continued optional: needs paid MCP\n\nUse skills/eee-fff/\n"
    out = cr.check(base(tmp_path, doc))
    assert out == ["claude-home/docs/note.md:5: missing skill eee-fff"]


def test_optional_does_not_leak_to_next_bullet(tmp_path):
    doc = "- first skills/aaa-bbb/ (optional)\n- second skills/ccc-ddd/\n"
    assert cr.check(base(tmp_path, doc)) == ["claude-home/docs/note.md:2: missing skill ccc-ddd"]


def test_allowlist_exact_and_directory(tmp_path):
    doc = "~/.pi/agent/local.env, ~/.pi/agent/sessions/abc.jsonl and ~/.pi/agent/other.json\n"
    allow = "# comment\nlocal.env  # runtime\nsessions/  # runtime dir\n"
    root = base(tmp_path, doc, {"scripts/refs-allow.txt": allow})
    assert cr.check(root) == ["claude-home/docs/note.md:1: missing path other.json"]


def test_allowlist_directory_entry_covers_children_only(tmp_path):
    assert cr.allowed("sessions", {"sessions/"})
    assert cr.allowed("sessions/a/b", {"sessions/"})
    assert not cr.allowed("sessions2", {"sessions/"})


def test_excluded_paths_not_scanned(tmp_path):
    doc = "skills/zzz-zzz/\n"
    root = make(tmp_path, {
        "docs/specs/0001.md": doc,
        "claude-home/hooks/fixtures/f.md": doc,
        "claude-home/hooks/test_x.py": doc,
        "claude-home/patches/a.patch": doc,
        "elsewhere/notes.md": doc,
    })
    assert cr.check(root) == []


def test_placeholder_paths_check_parent_dir(tmp_path):
    doc = "$CLAUDE_CONFIG_DIR/skills/<name>/SKILL.md and claude-home/agents/*.md\n"
    assert cr.check(base(tmp_path, doc)) == []


def test_cli_exit_codes(tmp_path):
    root = base(tmp_path, "skills/ghost-skill/\n", {"scripts/check-refs.py": SCRIPT.read_text()})
    bad = subprocess.run([sys.executable, str(root / "scripts/check-refs.py")], capture_output=True, text=True)
    assert bad.returncode == 1 and "missing skill ghost-skill" in bad.stdout
    (root / "claude-home/docs/note.md").write_text("fine\n")
    good = subprocess.run([sys.executable, str(root / "scripts/check-refs.py")], capture_output=True, text=True)
    assert good.returncode == 0 and good.stdout == ""


def test_table_rows_are_separate_units(tmp_path):
    doc = "| a | skills/aaa-bbb/ (optional) |\n| b | skills/ccc-ddd/ |\n"
    assert cr.check(base(tmp_path, doc)) == ["claude-home/docs/note.md:2: missing skill ccc-ddd"]

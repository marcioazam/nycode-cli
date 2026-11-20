#!/usr/bin/env python3
"""Skill usage from pi sessions, read-only. Counts only tool calls: `read` of .../skills/<name>/SKILL.md and user
messages starting with /skill:<name>; never raw text (the injected catalog repeats every name).
Visible to the model = frontmatter `disable-model-invocation` is not true (pi docs/skills.md).
Usage: skill-usage.py [--json] [--unused] [--since YYYY-MM-DD] [--sessions DIR]"""
import argparse
import json
import re
import sys
from pathlib import Path

import yaml

CH = Path.home() / ".pi/agent/claude-home"
READ_RE = re.compile(r"/skills/([^/]+)/SKILL\.md$")
CMD_RE = re.compile(r"^\s*/skill:([\w.-]+)")


def catalog(skills_dir):
    out = {}
    for f in sorted(Path(skills_dir).glob("*/SKILL.md")):
        m = re.match(r"^---\n(.*?)\n---\n", f.read_text(), re.S)
        try:
            meta = yaml.safe_load(m.group(1)) if m else {}
        except yaml.YAMLError:
            meta = {}
        meta = meta if isinstance(meta, dict) else {}
        out[f.parent.name] = {
            "visible": meta.get("disable-model-invocation") is not True,
            "description_bytes": len(str(meta.get("description") or "").encode()),
            "uses": 0,
            "last_used": None,
        }
    return out


def hits(line):
    """Yield (skill, timestamp) for one session JSONL record."""
    try:
        rec = json.loads(line)
    except ValueError:
        return
    msg = rec.get("message") if isinstance(rec, dict) else None
    if not isinstance(msg, dict) or not isinstance(msg.get("content"), list):
        return
    ts = str(rec.get("timestamp") or "")
    for part in msg["content"]:
        if not isinstance(part, dict):
            continue
        if msg.get("role") == "assistant" and part.get("type") == "toolCall" and part.get("name") == "read":
            args = part.get("arguments")
            m = READ_RE.search(str(args.get("path", ""))) if isinstance(args, dict) else None
            if m:
                yield m.group(1), ts
        elif msg.get("role") == "user" and part.get("type") == "text":
            m = CMD_RE.match(str(part.get("text", "")))
            if m:
                yield m.group(1), ts


def tally(cat, sessions, since=""):
    for f in sorted(Path(sessions).rglob("*.jsonl")):
        with f.open(errors="replace") as fh:
            for line in fh:
                if "skill" not in line:
                    continue
                for name, ts in hits(line):
                    if name in cat and ts[:10] >= since:
                        c = cat[name]
                        c["uses"] += 1
                        c["last_used"] = max(c["last_used"] or "", ts[:10])


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--unused", action="store_true", help="visible skills with 0 uses")
    ap.add_argument("--since", default="", help="YYYY-MM-DD")
    ap.add_argument("--sessions", default=str(Path.home() / ".pi/agent/sessions"))
    ap.add_argument("--skills", default=str(CH / "skills"), help=argparse.SUPPRESS)
    a = ap.parse_args(argv)
    cat = catalog(a.skills)
    tally(cat, a.sessions, a.since)
    rows = [(n, c) for n, c in cat.items() if not a.unused or (c["visible"] and not c["uses"])]
    vis = [c for c in cat.values() if c["visible"]]
    unused = [c for c in vis if not c["uses"]]
    summary = {
        "skills": len(cat), "visible": len(vis), "visible_description_bytes": sum(c["description_bytes"] for c in vis),
        "visible_unused": len(unused), "visible_unused_description_bytes": sum(c["description_bytes"] for c in unused),
    }
    if a.json:
        print(json.dumps({"summary": summary, "skills": {n: c for n, c in rows}}, indent=1))
        return 0
    for n, c in sorted(rows, key=lambda r: (-r[1]["uses"], r[0])):
        print(f"{n}\t{'visible' if c['visible'] else 'hidden'}\t{c['description_bytes']}B\t{c['uses']} uses\t{c['last_used'] or '-'}")
    print(f"{summary['skills']} skills, {summary['visible']} visible = {summary['visible_description_bytes']} description bytes; "
          f"{summary['visible_unused']} visible-unused = {summary['visible_unused_description_bytes']} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())

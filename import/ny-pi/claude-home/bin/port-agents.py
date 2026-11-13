#!/usr/bin/env python3
"""Porta ~/.claude/agents/*.md para ~/.pi/agent/claude-home/agents/ (vocabulário pi).

Frontmatter: tools/disallowedTools mapeados para nomes pi (MCP com '_' no lugar de '-'),
ferramentas inexistentes no pi descartadas, tool_search incluído quando há MCP.
Corpo: substituições pontuais de vocabulário; revisão manual depois.
Uso: port-agents.py [--dry-run]
"""
import os
import re
import sys
from pathlib import Path

SRC = Path(os.environ.get("CLAUDE_SRC_DIR", Path.home() / ".claude")) / "agents"
DST = Path(os.environ.get("CLAUDE_CONFIG_DIR", Path.home() / ".pi/agent/claude-home")) / "agents"

SIMPLE = {
    "read": ["read"], "write": ["write"], "edit": ["edit"], "multiedit": ["edit"], "bash": ["bash"],
    "grep": ["grep"], "glob": ["find"], "ls": ["ls"], "webfetch": ["web_fetch"],
    "websearch": ["mcp__keenable__search_web_pages"], "toolsearch": ["tool_search"],
    "todowrite": ["todo"], "askuserquestion": ["question"],
    "lsp": ["lsp_diagnostics", "lsp_hover", "lsp_definition", "lsp_references", "lsp_symbols"],
    "agent": ["subagent"], "task": ["subagent"],
}
# Claude-only tools with no pi counterpart (dropped silently).
DROP = {"skill", "structuredoutput", "notebookedit", "workflow", "artifact", "artifactdata",
        "artifactcomments", "designsync", "shareonboardingguide", "pushnotification",
        "remotetrigger", "croncreate", "crondelete", "enterworktree", "exitworktree",
        "publishplugin", "schedulewakeup", "monitor", "sendmessage"}
PI_SERVERS = {"exa", "firecrawl", "youcom", "nimble", "octen", "context7", "paper_search",
              "brave_search", "computer_use_linux", "playwright", "perplexity", "codegraph",
              "package_version_check", "keenable", "parallel", "fetch", "linear"}


def norm(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9_*]", "_", s)


def map_tool(t: str) -> list[str]:
    t = t.strip().strip('"').strip("'")
    if not t:
        return []
    low = t.lower()
    if low in SIMPLE:
        return SIMPLE[low]
    if low in DROP:
        return []
    if not t.startswith("mcp__"):
        return []
    rest = t[len("mcp__"):]
    server, _, tool = rest.partition("__")
    if server.startswith("plugin_parallel_parallel-search"):
        server = "parallel"
    elif server.startswith("plugin_linear_linear") or server == "claude_ai_Linear":
        server = "linear"
    elif server.startswith("plugin_") or server.startswith("claude_ai_"):
        return []
    server = norm(server)
    if server not in PI_SERVERS:
        return []
    if server == "fetch":
        return ["web_fetch"]
    return [f"mcp__{server}__{norm(tool) if tool else '*'}"]


def parse_list(v: str) -> list[str]:
    v = v.strip()
    if v.startswith("["):
        v = v.strip("[]")
    return [x for x in (p.strip() for p in v.split(",")) if x]


def convert(text: str) -> str:
    m = re.match(r"^---\n(.*?)\n---\n(.*)$", text, re.S)
    if not m:
        raise ValueError("sem frontmatter")
    fm, body = m.group(1), m.group(2)
    out = []
    for line in fm.splitlines():
        key = line.split(":", 1)[0].strip()
        if key in ("tools", "disallowedTools"):
            items = []
            for t in parse_list(line.split(":", 1)[1]):
                for mapped in map_tool(t):
                    if mapped not in items:
                        items.append(mapped)
            if key == "tools" and any(i.startswith("mcp__") and i != "mcp__keenable__search_web_pages" for i in items) and "tool_search" not in items:
                items.append("tool_search")
            if key == "disallowedTools":
                items = [i for i in items if i != "subagent"]  # filhos já não podem criar subagentes
            if items:
                out.append(f"{key}: {', '.join(items)}")
            continue
        if key in ("autoCompactWindow", "omitClaudeMd"):
            continue
        out.append(line)
    body = (body
            .replace("~/.claude/skills/", "~/.pi/agent/claude-home/skills/")
            .replace("~/.claude/agents/", "~/.pi/agent/claude-home/agents/"))
    return "---\n" + "\n".join(out) + "\n---\n" + body


def main() -> None:
    dry = "--dry-run" in sys.argv
    DST.mkdir(parents=True, exist_ok=True)
    for f in sorted(SRC.glob("*.md")):
        new = convert(f.read_text())
        if dry:
            print(f"== {f.name}\n" + new.split("\n---\n", 1)[0])
        else:
            (DST / f.name).write_text(new)
    if not dry:
        print(f"portados: {len(list(SRC.glob('*.md')))} -> {DST}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Valida os agentes de ~/.pi/agent/claude-home/agents para o pi (pi-code subagent).

Checa: frontmatter YAML, name = arquivo, description, tools/disallowedTools contra as
ferramentas reais do pi e os nomes MCP de `pi mcp list --json` (cache em /tmp/mcp-list.json,
regenerado com --refresh), skills existentes, model/effort válidos, e vocabulário do
Claude Code que não existe no pi no corpo. Saída: uma linha por problema; exit 1 se houver.
Uso: check-agents.py [--refresh] [agente.md ...]
"""
import json, re, subprocess, sys
from pathlib import Path
import yaml

HOME = Path.home()
AGENTS = HOME / ".pi/agent/claude-home/agents"
SKILLS = HOME / ".pi/agent/claude-home/skills"
CACHE = Path("/tmp/mcp-list.json")
BUILTIN = {"read", "bash", "edit", "write", "grep", "find", "ls", "web_fetch", "todo", "question",
           "memory", "tool_search", "subagent", "plan_mode_complete", "lsp_diagnostics", "lsp_hover",
           "lsp_definition", "lsp_references", "lsp_symbols", "list_mcp_resources", "read_mcp_resource",
           "slash_command", "mcp__keenable__search_web_pages"}
MODELS = {"sonnet", "opus", "haiku", "fable", "inherit"}
EFFORT = {"off", "minimal", "low", "medium", "high", "xhigh", "max"}
# Vocabulário do Claude Code sem equivalente direto no pi (corpo dos agentes).
BAD = [
    (r"\bmcp__plugin_", "MCP de plugin do Claude (inexistente no pi)"),
    (r"\bmcp__claude_ai_", "MCP claude.ai (inexistente no pi)"),
    (r"\bmcp__[a-z]+-[a-z-]+__", "nome MCP com hífen (no pi vira _)"),
    (r"~/\.claude/(skills|agents|settings|rules|CLAUDE\.md|hooks)", "caminho do Claude Code (use ~/.pi/agent/claude-home)"),
    (r"\b(TodoWrite|AskUserQuestion|WebSearch|WebFetch|NotebookEdit|ToolSearch|SendMessage|ScheduleWakeup|StructuredOutput)\b", "ferramenta Claude"),
    (r"\bSkill tool\b|\bthe Skill\b|`Skill`", "Skill tool (no pi: read do SKILL.md)"),
    (r"\b(Agent|Task) tool\b|subagent_type", "Task/Agent tool (no pi: subagent)"),
    (r"\bclaude -p\b", "claude -p (no pi: pi -p)"),
    (r"\b(Glob|Grep|MultiEdit) tool\b", "ferramenta Claude"),
    (r"`(Read|Write|Edit|Bash|Grep|Glob)`", "nome capitalizado de ferramenta Claude"),
    (r"\bCLAUDE\.md\b", "CLAUDE.md (no pi o contrato global é claude-home/CLAUDE.md, já no contexto do agente)"),
    (r"\bClaude Code\b", "menção a Claude Code"),
    (r"\bweb_search\b(?!_)", "web_search do pi-code está desligado"),
]

# Ocorrências revisadas à mão e corretas no pi (arquivo, trecho): CLAUDE.md do repositório-alvo,
# comparação de runs Claude Code x pi, referência de leitura a ~/.claude/rules.
ALLOW = {
    ("agent-systems-auditor.md", "Claude Code"),
    ("gate-runner.md", "CLAUDE.md"), ("go-service-engineer.md", "CLAUDE.md"),
    ("gateway-engineer.md", "Claude Code"), ("pente-fino.md", "CLAUDE.md"),
}


def mcp_names(refresh: bool):
    if refresh or not CACHE.exists():
        out = subprocess.run([str(HOME / ".pi/agent/bin/pi"), "mcp", "list", "--json"], capture_output=True, text=True, cwd="/tmp")
        CACHE.write_text(out.stdout)
    data = json.loads(CACHE.read_text())
    norm = lambda s: re.sub(r"[^A-Za-z0-9_]", "_", s)
    servers, names, unauth = set(), set(), set()
    for s in data["servers"]:
        server = norm(s["name"])
        servers.add(server)
        if s.get("state") != "connected":
            unauth.add(server)
        for t in s.get("tools", []):
            names.add(f"mcp__{server}__{norm(t)}")
    return servers, names, unauth


def check(path: Path, servers, names, unauth):
    probs = []
    text = path.read_text()
    m = re.match(r"^---\n(.*?)\n---\n(.*)$", text, re.S)
    if not m:
        return [f"{path.name}: sem frontmatter"]
    try:
        fm = yaml.safe_load(m.group(1))
    except Exception as e:
        return [f"{path.name}: YAML inválido: {e}"]
    # O corpo inteiro, comentários HTML inclusive, vira o system prompt (pi-code subagent/agents.ts).
    body = m.group(2)
    if fm.get("name") != path.stem:
        probs.append(f"name {fm.get('name')!r} != arquivo")
    desc = fm.get("description") or ""
    if not desc or len(desc) > 1024:
        probs.append(f"description vazia ou >1024 ({len(desc)})")
    for key in ("tools", "disallowedTools"):
        raw = fm.get(key)
        if raw is None:
            continue
        items = raw if isinstance(raw, list) else [x.strip() for x in str(raw).split(",") if x.strip()]
        for it in items:
            if it in BUILTIN or it in names:
                continue
            mm = re.match(r"^mcp__([A-Za-z0-9_]+)__\*$", it)
            if mm and mm.group(1) in servers:
                continue
            mm = re.match(r"^mcp__([A-Za-z0-9_]+)__", it)
            if mm and mm.group(1) in unauth:
                continue  # servidor sem login: nomes não verificáveis agora
            mm = re.match(r"^mcp__([A-Za-z0-9_]+)__(authenticate|complete_authentication)$", it)
            if mm and mm.group(1) in servers:
                continue  # ferramentas de login que o pi cria só enquanto o servidor pede auth
            probs.append(f"{key}: {it!r} não existe no pi")
        if key == "tools" and any(i.startswith("mcp__") and i != "mcp__keenable__search_web_pages" for i in items) and "tool_search" not in items:
            probs.append("tools tem MCP deferido mas não tool_search")
    model = fm.get("model")
    if model and model != "inherit" and "/" not in str(model):
        # Alias nu (sonnet/haiku/opus) resolve pelo primeiro id que o contém: o tier mais antigo
        # (sonnet -> claude-sonnet-4-5, 404 em 2026-11-11). Use provider/id concreto.
        probs.append(f"model {model!r}: use provider/id concreto (alias resolve para o modelo mais antigo)")
    if fm.get("effort") and fm["effort"] not in EFFORT:
        probs.append(f"effort {fm['effort']!r} inválido")
    sk = fm.get("skills")
    for s in (sk if isinstance(sk, list) else ([x.strip() for x in str(sk).split(",")] if sk else [])):
        if not (SKILLS / s / "SKILL.md").exists():
            probs.append(f"skill {s!r} inexistente")
    for pat, why in BAD:
        for mm in re.finditer(pat, body):
            if (path.name, mm.group(0)) in ALLOW:
                continue
            line = body[: mm.start()].count("\n") + 1
            probs.append(f"corpo L{line}: {why}: {mm.group(0)!r}")
    for mm in re.finditer(r"(~|/home/[a-z][\w-]*)/[\w./-]+", body):
        p = Path(mm.group(0).replace("~", str(HOME), 1).rstrip(".,)"))
        if "<" in p.as_posix() or "*" in p.as_posix():
            continue
        if not p.exists():
            probs.append(f"caminho inexistente: {mm.group(0)}")
    for mm in re.finditer(r"\b(?:skill|skills)[: ]+`?([a-z][a-z0-9-]+)`?", body):
        pass
    return [f"{path.name}: {p}" for p in probs]


def main():
    refresh = "--refresh" in sys.argv
    files = [AGENTS / a for a in sys.argv[1:] if a.endswith(".md")] or sorted(AGENTS.glob("*.md"))
    servers, names, unauth = mcp_names(refresh)
    allp = []
    for f in files:
        allp += check(f, servers, names, unauth)
    print("\n".join(allp) if allp else f"OK: {len(files)} agentes sem problemas")
    sys.exit(1 if allp else 0)


if __name__ == "__main__":
    main()

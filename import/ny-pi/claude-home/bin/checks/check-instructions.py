#!/usr/bin/env python3
r"""Valida as instruções globais do pi: claude-home/CLAUDE.md, rules/*.md, rules-ref/*.md (sob demanda) e commands/*.md.

Checa, no texto que chega ao modelo (comentários HTML de bloco removidos, como o pi-code faz):
- tamanho: CLAUDE.md abaixo de 200 linhas (code.claude.com/docs/en/memory);
- `@token` fora de código, que o pi-code trataria como import;
- frontmatter: rules sem frontmatter ou só com `paths`; commands com YAML válido e `description`;
- caminhos `~/...` e `/home/<user>/...` citados em código existem;
- nomes de skill e agente citados em código existem em claude-home;
- ferramentas MCP `mcp__server__tool` existem em `pi mcp list --json` (cache /tmp/mcp-list.json, --refresh);
- comandos `/x` citados em código existem (pi, pi-code, extensões, claude-home/commands, /skill:);
- vocabulário só do Claude Code numa linha sem negação ("no", "not", "never", "Claude"...).
- `$1`, `$@`, `${1:-x}` acidentais em skills e commands, que o pi-code expandiria na invocação
  (bin/checks/arg-expansion-check.mjs, com a função real do pi-code; corrigir escapando: `\$1`);
- divergência: o sha256 de cada fonte do Claude (CLAUDE.md, rules, hooks portados) bate com o
  manifesto docs/pi-instructions.sources.json; fonte mudada = porta pendente.
Atualização guiada quando uma fonte muda:
  1. check-instructions.py --diff        mostra o diff de cada fonte contra o snapshot da última porta
     (docs/pi-instructions.sources/) e o arquivo do pi que a porta, para aplicar a mudança à mão;
  2. portar a mudança no arquivo do pi (adaptando, não copiando);
  3. check-instructions.py --accept-sources   grava hashes e snapshot novos.
Saída: uma linha por problema e um resumo; exit 1 se houver problema.
Uso: check-instructions.py [--refresh] [--diff] [--accept-sources]
"""
import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path

import yaml

HOME = Path.home()
CH = HOME / ".pi/agent/claude-home"
SKILLS = {p.name for p in (CH / "skills").iterdir() if (p / "SKILL.md").exists()}
AGENTS = {p.stem for p in (CH / "agents").glob("*.md")} | {"Explore", "Plan", "general-purpose"}
CACHE = Path("/tmp/mcp-list.json")
_INSTALL = Path.home() / ".pi/agent/install"
_VERSION = (_INSTALL / "current-version").read_text().strip() if (_INSTALL / "current-version").exists() else "1.5.2"
PI_DOCS = _INSTALL / "releases" / _VERSION / "node_modules/@earendil-works/pi-coding-agent/docs"
EXT_DIRS = [HOME / ".pi/agent/npm/node_modules/pi-code/extensions", HOME / ".pi/agent/extensions", HOME / ".pi/agent/vendor"]

MANIFEST = CH / "docs/pi-instructions.sources.json"
SNAPSHOT = CH / "docs/pi-instructions.sources"
ARG_CHECK = CH / "bin/checks/arg-expansion-check.mjs"
# Fonte do Claude -> arquivo(s) do pi que a portam (mostrado pelo --diff).
PORTS = {
    HOME / ".claude/CLAUDE.md": "claude-home/CLAUDE.md",
    HOME / ".claude/hooks/graph_context.py": "claude-home/hooks/graph_context.py",
    HOME / ".claude/hooks/plan/plan_gate.py": "extensions/plan-gate.ts",
    HOME / ".claude/hooks/sound-notify.py": "extensions/sound-notify/index.ts",
    HOME / ".claude/hooks/claims/claims.py": "claude-home/hooks/claims/claims.py (cópia literal)",
    HOME / ".claude/hooks/claims/patterns.ere": "claude-home/hooks/claims/patterns.ere (cópia literal)",
    HOME / ".claude/hooks/hook-dispatch.sh": "claude-home/hooks/dispatch/hook-dispatch.sh (só notas e lembretes; sem ledger e auditoria)",
    HOME / ".claude/hooks/lib/telemetry_io.py": "não portado: custo x benefício; equivalente offline bin/telemetry/pi_telemetry.py (docs/pi-hooks-port.md)",
    HOME / ".claude/hooks/subagent_telemetry.py": "não portado: custo x benefício; equivalente offline bin/telemetry/pi_telemetry.py (docs/pi-hooks-port.md)",
    HOME / ".claude/hooks/tool_use_telemetry.py": "não portado: custo x benefício; equivalente offline bin/telemetry/pi_telemetry.py (docs/pi-hooks-port.md)",
    HOME / ".claude/hooks/route_hint.py": "não portado: custo x benefício (dicas seguidas ~38% no Claude, sem prova causal; docs/pi-hooks-port.md)",
    HOME / ".claude/hooks/route_hints.json": "não portado: custo x benefício (dicas seguidas ~38% no Claude, sem prova causal; docs/pi-hooks-port.md)",
    HOME / ".claude/hooks/claims/cade_o_print.py": "não portado: custo x benefício; equivalente offline bin/telemetry/pi_telemetry.py (docs/pi-hooks-port.md)",
    HOME / ".claude/hooks/context-mode-cache-heal.mjs": "não se aplica (pi sem context-mode; docs/pi-hooks-port.md)",
    HOME / ".claude/rules/safety.md": "claude-home/rules/safety.md",
    # Sob demanda desde 2026-11-13 (docs/preamble-diet-completion-gate-2026-11-13.md): fora do preâmbulo fixo.
    **{HOME / ".claude/rules" / n: f"claude-home/rules-ref/{n}"
       for n in ("docs-and-knowledge.md", "harness-economy.md", "research-and-tools.md")},
}
SOURCES = list(PORTS)
# Pseudo-fonte: inventário dos hooks do Claude (settings.json + plugins), para um hook novo ou mudado virar porta pendente.
INVENTORY = "~/.claude/settings.json#hooks"
HOOK_SUFFIXES = {".py", ".sh", ".mjs", ".js", ".json"}
HOOK_SKIP_DIRS = {"tests", "__pycache__", ".pytest_cache", ".ruff_cache"}
# Arquivos em ~/.claude/hooks que não são hooks a portar (plan_gate.py já é fonte via PORTS).
HOOK_NOT_PORTED = {HOME / ".claude/hooks/claims/replay.py"}  # replay offline dos streams de eval do Claude

# Nomes kebab-case em código que não são skill nem agente (scripts, timers, workflows citados como inexistentes...).
OTHER_NAMES = {
    "git-deliver", "codegraph-obsidian", "chrome-debug", "swarm-lanes", "pre-launch", "cua-driver", "needs-llm",
    "build.slice", "mcp-auth", "claude-secrets", "pytest-xdist", "claude-tier-probe", "claude-hud", "plan-gate", "sound-notify",
}
# Caminhos que um comando cria quando roda (o /claude-hud-setup e o /claude-hud-configure), não pré-requisitos.
CREATED_PATHS = {
    "~/.pi/agent/claude-home/plugins/claude-hud/config.json", "~/.pi/agent/claude-home/claude-hud.json",
    "~/.pi/agent/claude-home/plugins/claude-hud/statusline.mjs",
}
# `/x` que é caminho de repositório, não comando.
PATH_WORDS = {"docs", "tmp", "home", "etc", "dev"}
NEGATION = re.compile(r"\b(no|not|never|none|without|isn't|aren't|don't|doesn't|instead|Claude('s)?|ported|dropped)\b", re.I)
CLAUDE_ONLY = [
    (r"\bToolSearch\b", "ToolSearch (pi: tool_search)"),
    (r"\bWeb(Search|Fetch)\b", "WebSearch/WebFetch (pi: keenable / web_fetch)"),
    (r"\bSkill tool\b", "Skill tool (pi: read do SKILL.md)"),
    (r"\b(Agent|Task) tool\b|\bsubagent_type\b", "Agent/Task (pi: subagent)"),
    (r"\bcontext-mode\b|\bctx_[a-z_]+", "context-mode (inexistente no pi)"),
    (r"\bSessionStart\b|\bSubagentStart\b", "hook SessionStart (inexistente no pi)"),
    (r"\b(TodoWrite|AskUserQuestion|ExitPlanMode|EnterPlanMode|SendMessage|ScheduleWakeup|StructuredOutput)\b", "ferramenta Claude"),
    (r"`(Read|Write|Edit|Grep|Glob)`", "nome capitalizado de ferramenta Claude"),
    (r"~/\.claude/(skills|agents|rules|hooks|settings\.json|CLAUDE\.md)\b", "caminho do Claude Code (use claude-home)"),
    (r"\bweb_search\b", "web_search está desligado no wrapper"),
]


def strip_block_comments(text):
    out, in_comment, fence = [], False, None
    for line in text.splitlines():
        s = line.strip()
        if fence is None and not in_comment and s[:3] in ("```", "~~~"):
            fence = s[:3]
        elif fence is not None and s.startswith(fence):
            fence = None
            out.append(line)
            continue
        if fence is not None:
            out.append(line)
            continue
        if in_comment:
            if "-->" in s:
                in_comment = False
            continue
        if s.startswith("<!--"):
            if "-->" not in s:
                in_comment = True
            continue
        out.append(line)
    return "\n".join(out)


def split_frontmatter(text):
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    return (m.group(1), text[m.end():]) if m else (None, text)


def mcp_tools(refresh):
    if refresh or not CACHE.exists():
        out = subprocess.run([str(HOME / ".pi/agent/bin/pi"), "mcp", "list", "--json"], capture_output=True, text=True, cwd="/tmp")
        CACHE.write_text(out.stdout)
    norm = lambda s: re.sub(r"[^A-Za-z0-9_]", "_", s)
    names, servers = set(), set()
    for s in json.loads(CACHE.read_text())["servers"]:
        server = norm(s["name"])
        servers.add(server)
        for t in s.get("tools", []):
            names.add(f"mcp__{server}__{norm(t if isinstance(t, str) else t.get('name', ''))}")
    return names, servers


def slash_commands():
    cmds = {"skill"}
    for d in EXT_DIRS:
        for f in d.rglob("*.ts"):
            try:
                cmds |= set(re.findall(r"registerCommand\(\s*['\"]([a-z:-]+)['\"]", f.read_text(errors="ignore")))
            except OSError:
                pass
    doc = PI_DOCS / "slash-commands.md"
    if doc.exists():
        cmds |= set(re.findall(r"^\| `/([a-z-]+)", doc.read_text(), re.M))
    cmds |= {p.stem for p in (CH / "commands").glob("*.md")}
    return cmds


def code_spans(text):
    """(linha, span) de cada código inline fora de blocos cercados."""
    text = re.sub(r"^(```|~~~).*?^\1", "", text, flags=re.S | re.M)
    return [(line, span) for line in text.splitlines() for span in re.findall(r"`([^`\n]+)`", line)]


def check_paths(span):
    probs = []
    for raw in re.findall(r"(?:~|/home/[a-z][\w-]*)/[^\s`'\"),;]+", span):
        if any(c in raw for c in "*<>…{}$"):
            continue
        p = raw.rstrip(".:")
        if p in CREATED_PATHS:
            continue
        if not Path(os.path.expanduser(p)).exists():
            probs.append(f"caminho inexistente: {p}")
    return probs


def check_file(path, kind, tools, servers, cmds):
    probs = []
    raw = path.read_text()
    fm, body = split_frontmatter(raw)
    if kind == "rule" and fm is not None:
        try:
            data = yaml.safe_load(fm) or {}
        except yaml.YAMLError as e:
            probs.append(f"frontmatter inválido: {e}")
            data = {}
        if set(data) - {"paths"}:
            probs.append(f"frontmatter de rule só aceita paths: {sorted(set(data))}")
    if kind == "command":
        try:
            data = yaml.safe_load(fm or "") or {}
        except yaml.YAMLError as e:
            probs.append(f"frontmatter inválido: {e}")
            data = {}
        if not data.get("description"):
            probs.append("command sem description")
    text = strip_block_comments(body)
    lines = text.splitlines()
    if kind == "claude" and len(lines) >= 200:
        probs.append(f"{len(lines)} linhas (alvo < 200)")
    if kind in ("claude", "rule"):
        prose = re.sub(r"`[^`\n]*`", "", re.sub(r"^(```|~~~).*?^\1", "", text, flags=re.S | re.M))
        for m in re.finditer(r"(^|\s)@(\S+)", prose):
            probs.append(f"@{m.group(2)} seria tratado como import")
    for line, span in code_spans(text):
        probs += check_paths(span)
        for name in re.findall(r"\bmcp__[A-Za-z0-9_]+", span):
            parts = name.split("__")
            if len(parts) >= 2 and parts[1] not in servers:
                probs.append(f"servidor MCP inexistente: {name}")
            elif len(parts) == 3 and parts[2] and name not in tools:
                probs.append(f"ferramenta MCP inexistente: {name}")
        if re.fullmatch(r"[a-z][a-z0-9]*(-[a-z0-9]+)+", span) and span not in SKILLS | AGENTS | OTHER_NAMES:
            probs.append(f"nome desconhecido (skill/agente?): {span}")
        m = re.fullmatch(r"/([a-z][a-z-]*)(:[a-z-]+)?(\s.*)?", span)
        if m and m.group(1) not in cmds | PATH_WORDS and not NEGATION.search(line):
            probs.append(f"comando inexistente no pi: /{m.group(1)}")
        m = re.fullmatch(r"/skill:([a-z0-9-]+)(\s.*)?", span)
        if m and m.group(1) not in SKILLS and m.group(1) != "<name>":
            probs.append(f"skill inexistente: {m.group(1)}")
    for n, line in enumerate(lines, 1):
        for pat, why in CLAUDE_ONLY:
            if re.search(pat, line) and not NEGATION.search(line):
                probs.append(f"linha {n}: {why}")
    return probs


def _json_or_none(path):
    try:
        return json.loads(Path(path).read_text())
    except (OSError, ValueError):
        return None


def _plugin_hooks(install):
    """hooks.json e `hooks` do plugin.json; caminhos relativos viram {caminho: JSON lido}."""
    manifest = _json_or_none(install / ".claude-plugin/plugin.json")
    decl = manifest.get("hooks") if isinstance(manifest, dict) else None
    if isinstance(decl, str) or (isinstance(decl, list) and all(isinstance(x, str) for x in decl)):
        decl = {x: _json_or_none(install / x) for x in ([decl] if isinstance(decl, str) else decl)}
    return {"hooks.json": _json_or_none(install / "hooks/hooks.json"), "plugin.json hooks": decl}


def hook_inventory():
    """Texto canônico dos hooks do settings.json e dos plugins habilitados; erro de leitura vira null."""
    settings = _json_or_none(HOME / ".claude/settings.json")
    settings = settings if isinstance(settings, dict) else {}
    installed = _json_or_none(HOME / ".claude/plugins/installed_plugins.json")
    plugins = {}
    enabled = settings.get("enabledPlugins")
    for name, on in (enabled.items() if isinstance(enabled, dict) else []):
        try:
            install = Path(installed["plugins"][name][0]["installPath"])
        except (TypeError, KeyError, IndexError):
            continue
        if on is True:
            info = _plugin_hooks(install)
            if any(v is not None for v in info.values()):
                plugins[name] = info
    data = {"settings_hooks": settings.get("hooks"), "plugins": plugins}
    return json.dumps(data, indent=1, sort_keys=True, ensure_ascii=False) + "\n"


def source_hashes():
    hashes = {str(p).replace(str(HOME), "~"): hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None for p in SOURCES}
    hashes[INVENTORY] = hashlib.sha256(hook_inventory().encode()).hexdigest()
    extra = sorted(str(p).replace(str(HOME), "~") for p in (HOME / ".claude/rules").glob("*.md") if p not in SOURCES)
    return hashes, extra


def new_hooks():
    root = HOME / ".claude/hooks"
    return sorted(
        str(p).replace(str(HOME), "~") for p in root.rglob("*")
        if p.is_file() and p.suffix in HOOK_SUFFIXES and not HOOK_SKIP_DIRS & set(p.relative_to(root).parts)
        and p not in SOURCES and p not in HOOK_NOT_PORTED
    )


def snapshot_of(path):
    return SNAPSHOT / str(path.relative_to(HOME)).replace("/", "__")


def inventory_snapshot():
    return SNAPSHOT / (INVENTORY.replace("~/", "").replace("/", "__") + ".json")


def show_inventory_diff():
    import difflib
    snap = inventory_snapshot()
    old = snap.read_text().splitlines(keepends=True) if snap.exists() else []
    print("\n### inventário de hooks do Claude -> porta: docs/pi-hooks-port.md (registro das portas)")
    if not snap.exists():
        print("(sem snapshot do inventário anterior: compare o inventário inteiro com docs/pi-hooks-port.md)")
    sys.stdout.writelines(difflib.unified_diff(old, hook_inventory().splitlines(keepends=True), "inventário anterior", "inventário atual", n=2))


def show_diff(path):
    import difflib
    snap = snapshot_of(path)
    old = snap.read_text().splitlines(keepends=True) if snap.exists() else []
    new = path.read_text().splitlines(keepends=True) if path.exists() else []
    print(f"\n### {path} -> porta: ~/.pi/agent/{PORTS[path]}")
    if not snap.exists():
        print("(sem snapshot da porta anterior: compare a fonte inteira com a porta)")
    sys.stdout.writelines(difflib.unified_diff(old, new, f"porta anterior/{path.name}", f"atual/{path.name}", n=2))


def check_sources(accept, diff=False):
    hashes, extra = source_hashes()
    if accept:
        MANIFEST.write_text(json.dumps(hashes, indent=2) + "\n")
        SNAPSHOT.mkdir(exist_ok=True)
        for path in SOURCES:
            if path.exists():
                snapshot_of(path).write_bytes(path.read_bytes())
        inventory_snapshot().write_text(hook_inventory())
        print(f"manifesto e snapshot gravados: {MANIFEST}, {SNAPSHOT}")
    probs = [f"rule nova no Claude, sem porta: {p}" for p in extra]
    probs += [f"hook novo no Claude, sem porta: {p} (docs/pi-hooks-port.md)" for p in new_hooks()]
    if not MANIFEST.exists():
        return probs + [f"manifesto ausente: {MANIFEST} (rode --accept-sources depois de conferir a porta)"]
    saved = json.loads(MANIFEST.read_text())
    for path, digest in hashes.items():
        if path not in saved:
            probs.append(f"fonte sem registro no manifesto: {path} (conferir a porta, depois --accept-sources)")
        elif saved[path] != digest and path == INVENTORY:
            probs.append("inventário de hooks do Claude mudou: ~/.claude/settings.json e plugins habilitados "
                         "(--diff, portar o hook novo ou mudado para o pi, docs/pi-hooks-port.md, depois --accept-sources)")
            if diff:
                show_inventory_diff()
        elif saved[path] != digest:
            probs.append(f"fonte mudou desde a porta: {path} (--diff, portar a mudança, depois --accept-sources)")
            if diff:
                show_diff(Path(os.path.expanduser(path)))
    return probs


def check_arg_expansion():
    try:
        out = subprocess.run(["node", str(ARG_CHECK)], capture_output=True, text=True, timeout=120)
        hits = json.loads(out.stdout)
    except (OSError, subprocess.TimeoutExpired, ValueError) as e:
        return [f"detector de $N falhou: {e}"]
    return [f"{h['file']}:{h['line']}: `$N`/`$@` seria expandido pelo pi-code (escape como \\$): {h['text']}" for h in hits]




def check_skills():
    """Cada skills/*/SKILL.md: YAML válido, name == diretório, description não vazia (caminhos citados no corpo não: 12/12 falsos positivos em 2026-11-13)."""
    probs = []
    for d in sorted(p for p in (CH / "skills").iterdir() if p.is_dir()):
        f = d / "SKILL.md"
        if not f.exists():
            continue
        fm, body = split_frontmatter(f.read_text())
        rel = f"skills/{d.name}/SKILL.md"
        if fm is None:
            probs.append(f"{rel}: sem frontmatter")
            continue
        try:
            meta = yaml.safe_load(fm)
        except yaml.YAMLError as e:
            probs.append(f"{rel}: YAML inválido: {str(e).splitlines()[0]}")
            continue
        if not isinstance(meta, dict):
            probs.append(f"{rel}: frontmatter não é um mapa")
            continue
        if meta.get("name") != d.name:
            probs.append(f"{rel}: name {meta.get('name')!r} != diretório {d.name!r}")
        if not str(meta.get("description") or "").strip():
            probs.append(f"{rel}: description ausente ou vazia")
    return probs


def main():
    tools, servers = mcp_tools("--refresh" in sys.argv)
    cmds = slash_commands()
    files = [(CH / "CLAUDE.md", "claude")] + [(p, "rule") for p in sorted((CH / "rules").glob("*.md"))]
    files += [(p, "ondemand") for p in sorted((CH / "rules-ref").glob("*.md"))]
    files += [(p, "command") for p in sorted((CH / "commands").glob("*.md"))]
    total, nbytes = 0, 0
    for path, kind in files:
        probs = check_file(path, kind, tools, servers, cmds)
        text = strip_block_comments(split_frontmatter(path.read_text())[1])
        if kind in ("claude", "rule"):
            nbytes += len(text.encode())
        for p in dict.fromkeys(probs):
            print(f"{path.relative_to(CH)}: {p}")
        total += len(set(probs))
    for p in check_arg_expansion():
        print(f"skills/commands: {p}")
        total += 1
    for p in check_skills():
        print(p)
        total += 1
    for p in check_sources("--accept-sources" in sys.argv, "--diff" in sys.argv):
        print(f"fontes: {p}")
        total += 1
    print(f"{len(files)} arquivos, {total} problema(s); sempre carregado (CLAUDE.md + rules): {nbytes} bytes")
    return 1 if total else 0


if __name__ == "__main__":
    sys.exit(main())

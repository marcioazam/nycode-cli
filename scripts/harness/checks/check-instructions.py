#!/usr/bin/env python3
r"""Valida as instruções embarcadas do nycode: instructions/contract.md, rules/*.md, rules/ref/*.md (sob demanda) e commands/*.md.

Raiz dos recursos: ${NYCODE_RESOURCES} (padrão: packages/coding-agent/resources deste checkout).
Checa, no texto que chega ao modelo (comentários HTML de bloco removidos, como o nycode faz):
- tamanho: contract.md abaixo de 200 linhas (code.claude.com/docs/en/memory);
- `@token` fora de código, que o nycode trataria como import;
- frontmatter: rules sem frontmatter ou só com `paths`; commands com YAML válido e `description`;
- caminhos `~/...` e `/home/<user>/...` citados em código existem;
- nomes de skill e agente citados em código existem nos recursos;
- ferramentas MCP `mcp__server__tool` existem em `nycode mcp list --json` (cache /tmp/mcp-list.json, --refresh;
  sem o binário `nycode` essa checagem é pulada);
- comandos `/x` citados em código existem (nycode, extensões, resources/commands, /skill:);
- vocabulário só do Claude Code numa linha sem negação ("no", "not", "never", "Claude"...);
- `$1`, `$@`, `${1:-x}` acidentais em skills e commands, que o nycode expandiria na invocação
  (arg-expansion-check.mjs, com a função real do nycode; corrigir escapando: `\$1`).
Saída: uma linha por problema e um resumo; exit 1 se houver problema.
Uso: check-instructions.py [--refresh]
"""

import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import yaml

HOME = Path.home()
ROOT = Path(__file__).resolve().parents[3]
RESOURCES = Path(
    os.environ.get("NYCODE_RESOURCES", ROOT / "packages/coding-agent/resources")
)
SKILLS = {p.name for p in (RESOURCES / "skills").iterdir() if (p / "SKILL.md").exists()}
AGENTS = {p.stem for p in (RESOURCES / "agents").glob("*.md")} | {
    "Explore",
    "Plan",
    "general-purpose",
}
CACHE = Path("/tmp/mcp-list.json")
CODING_AGENT = ROOT / "packages/coding-agent"
EXT_DIRS = [CODING_AGENT / "src/extensions", HOME / ".nycode/agent/extensions"]
SLASH_DOC = CODING_AGENT / "docs/slash-commands.md"
ARG_CHECK = Path(__file__).resolve().parent / "arg-expansion-check.mjs"

# Nomes kebab-case em código que não são skill nem agente (scripts, timers, workflows citados como inexistentes...).
OTHER_NAMES = {
    "git-deliver",
    "codegraph-obsidian",
    "chrome-debug",
    "swarm-lanes",
    "pre-launch",
    "cua-driver",
    "needs-llm",
    "build.slice",
    "mcp-auth",
    "claude-secrets",
    "pytest-xdist",
    "claude-tier-probe",
    "claude-hud",
    "plan-gate",
    "sound-notify",
}
# Caminhos que um comando cria quando roda (o /claude-hud-setup e o /claude-hud-configure), não pré-requisitos.
CREATED_PATHS = {
    "~/.nycode/agent/claude-hud/config.json",
    "~/.nycode/agent/claude-hud.json",
}
# `/x` que é caminho de repositório, não comando.
PATH_WORDS = {"docs", "tmp", "home", "etc", "dev"}
NEGATION = re.compile(
    r"\b(no|not|never|none|without|isn't|aren't|don't|doesn't|instead|Claude('s)?|ported|dropped)\b",
    re.IGNORECASE,
)
CLAUDE_ONLY = [
    (r"\bToolSearch\b", "ToolSearch (nycode: tool_search)"),
    (r"\bWeb(Search|Fetch)\b", "WebSearch/WebFetch (nycode: keenable / web_fetch)"),
    (r"\bSkill tool\b", "Skill tool (nycode: read do SKILL.md)"),
    (r"\b(Agent|Task) tool\b|\bsubagent_type\b", "Agent/Task (nycode: subagent)"),
    (r"\bcontext-mode\b|\bctx_[a-z_]+", "context-mode (inexistente no nycode)"),
    (
        r"\bSessionStart\b|\bSubagentStart\b",
        "hook SessionStart (inexistente no nycode)",
    ),
    (
        r"\b(TodoWrite|AskUserQuestion|ExitPlanMode|EnterPlanMode|SendMessage|ScheduleWakeup|StructuredOutput)\b",
        "ferramenta Claude",
    ),
    (r"`(Read|Write|Edit|Grep|Glob)`", "nome capitalizado de ferramenta Claude"),
    (
        r"~/\.claude/(skills|agents|rules|hooks|settings\.json|CLAUDE\.md)\b",
        "caminho do Claude Code (use ${NYCODE_RESOURCES})",
    ),
    (r"\bweb_search\b", "web_search está desligado no wrapper"),
]


def strip_block_comments(text: str) -> str:
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


def split_frontmatter(text: str) -> tuple[str | None, str]:
    m = re.match(r"^---\n(.*?)\n---\n", text, re.DOTALL)
    return (m.group(1), text[m.end() :]) if m else (None, text)


def mcp_tools(refresh: bool) -> tuple[set[str], set[str]] | None:
    """Ferramentas e servidores MCP; None quando não dá para verificar (sem cache e sem o binário `nycode`)."""
    if refresh or not CACHE.exists():
        binary = shutil.which("nycode")
        if binary is None:
            return None
        out = subprocess.run(
            [binary, "mcp", "list", "--json"],
            capture_output=True,
            text=True,
            cwd="/tmp",
            check=False,
        )
        CACHE.write_text(out.stdout)

    def norm(s: str) -> str:
        return re.sub(r"[^A-Za-z0-9_]", "_", s)

    names: set[str] = set()
    servers: set[str] = set()
    for s in json.loads(CACHE.read_text())["servers"]:
        server = norm(s["name"])
        servers.add(server)
        for t in s.get("tools", []):
            names.add(
                f"mcp__{server}__{norm(t if isinstance(t, str) else t.get('name', ''))}"
            )
    return names, servers


def slash_commands() -> set[str]:
    cmds = {"skill"}
    for d in EXT_DIRS:
        for f in d.rglob("*.ts"):
            try:
                cmds |= set(
                    re.findall(
                        r"registerCommand\(\s*['\"]([a-z:-]+)['\"]",
                        f.read_text(errors="ignore"),
                    )
                )
            except OSError:
                pass
    if SLASH_DOC.exists():
        cmds |= set(re.findall(r"^\| `/([a-z-]+)", SLASH_DOC.read_text(), re.MULTILINE))
    cmds |= {p.stem for p in (RESOURCES / "commands").glob("*.md")}
    return cmds


def code_spans(text: str) -> list[tuple[str, str]]:
    """(linha, span) de cada código inline fora de blocos cercados."""
    text = re.sub(r"^(```|~~~).*?^\1", "", text, flags=re.DOTALL | re.MULTILINE)
    return [
        (line, span)
        for line in text.splitlines()
        for span in re.findall(r"`([^`\n]+)`", line)
    ]


def check_paths(span: str) -> list[str]:
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


def check_file(
    path: Path,
    kind: str,
    tools: set[str] | None,
    servers: set[str] | None,
    cmds: set[str],
) -> list[str]:
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
        prose = re.sub(
            r"`[^`\n]*`",
            "",
            re.sub(r"^(```|~~~).*?^\1", "", text, flags=re.DOTALL | re.MULTILINE),
        )
        for m in re.finditer(r"(^|\s)@(\S+)", prose):
            probs.append(f"@{m.group(2)} seria tratado como import")
    for line, span in code_spans(text):
        probs += check_paths(span)
        for name in re.findall(r"\bmcp__[A-Za-z0-9_]+", span):
            parts = name.split("__")
            if servers is None or tools is None:
                continue
            if len(parts) >= 2 and parts[1] not in servers:
                probs.append(f"servidor MCP inexistente: {name}")
            elif len(parts) == 3 and parts[2] and name not in tools:
                probs.append(f"ferramenta MCP inexistente: {name}")
        if (
            re.fullmatch(r"[a-z][a-z0-9]*(-[a-z0-9]+)+", span)
            and span not in SKILLS | AGENTS | OTHER_NAMES
        ):
            probs.append(f"nome desconhecido (skill/agente?): {span}")
        cm = re.fullmatch(r"/([a-z][a-z-]*)(:[a-z-]+)?(\s.*)?", span)
        if cm and cm.group(1) not in cmds | PATH_WORDS and not NEGATION.search(line):
            probs.append(f"comando inexistente no nycode: /{cm.group(1)}")
        sk = re.fullmatch(r"/skill:([a-z0-9-]+)(\s.*)?", span)
        if sk and sk.group(1) not in SKILLS and sk.group(1) != "<name>":
            probs.append(f"skill inexistente: {sk.group(1)}")
    for n, line in enumerate(lines, 1):
        for pat, why in CLAUDE_ONLY:
            if re.search(pat, line) and not NEGATION.search(line):
                probs.append(f"linha {n}: {why}")
    return probs


def check_arg_expansion() -> list[str]:
    try:
        out = subprocess.run(
            ["node", str(ARG_CHECK)],
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
        hits = json.loads(out.stdout)
    except (OSError, subprocess.TimeoutExpired, ValueError) as e:
        return [f"detector de $N falhou: {e}"]
    return [
        f"{h['file']}:{h['line']}: `$N`/`$@` seria expandido pelo nycode (escape como \\$): {h['text']}"
        for h in hits
    ]


def check_skills() -> list[str]:
    """Cada skills/*/SKILL.md: YAML válido, name == diretório, description não vazia (caminhos citados no corpo não: 12/12 falsos positivos em 2026-11-13)."""
    probs = []
    for d in sorted(p for p in (RESOURCES / "skills").iterdir() if p.is_dir()):
        f = d / "SKILL.md"
        if not f.exists():
            continue
        fm, _ = split_frontmatter(f.read_text())
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


def main() -> int:
    found = mcp_tools("--refresh" in sys.argv)
    tools, servers = found if found else (None, None)
    cmds = slash_commands()
    files = [(RESOURCES / "instructions/contract.md", "claude")]
    files += [(p, "rule") for p in sorted((RESOURCES / "rules").glob("*.md"))]
    files += [(p, "ondemand") for p in sorted((RESOURCES / "rules/ref").glob("*.md"))]
    files += [(p, "command") for p in sorted((RESOURCES / "commands").glob("*.md"))]
    total, nbytes = 0, 0
    for path, kind in files:
        probs = check_file(path, kind, tools, servers, cmds)
        text = strip_block_comments(split_frontmatter(path.read_text())[1])
        if kind in ("claude", "rule"):
            nbytes += len(text.encode())
        for p in dict.fromkeys(probs):
            print(f"{path.relative_to(RESOURCES)}: {p}")
        total += len(set(probs))
    for p in check_arg_expansion() + check_skills():
        print(p)
        total += 1
    print(
        f"{len(files)} arquivos, {total} problema(s); sempre carregado (contract.md + rules): {nbytes} bytes"
    )
    return 1 if total else 0


if __name__ == "__main__":
    sys.exit(main())

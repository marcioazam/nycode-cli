#!/usr/bin/env python3
"""Relatórios de telemetria do pi lidos das sessões (~/.pi/agent/sessions), retroativos e sem hook.

Substitui, no pi, os hooks de observação do Claude Code (decisão de custo x benefício, docs/pi-hooks-port.md):
- tools      ~ tool_use_telemetry.py: ferramentas, servidores MCP, skills carregadas (read do SKILL.md ou /skill:),
               chamadas de tool_search e sessões com 2+ provedores de busca (política de rules-ref/research-and-tools.md);
- subagents  ~ subagent_telemetry.py: por agente, chamadas, falhas, turnos e custo (usage dos resultados do subagent);
- audit      ~ auditoria do hook-dispatch.sh: comandos e caminhos destrutivos, de credencial, de egress e de deleção
               (mesmos padrões do Claude), com segredos mascarados;
- claims     ~ cade_o_print.py: respostas finais que afirmam "os testes passam", julgadas pelo claims.py do Claude
               (cópia em ../hooks/claims) contra as execuções de teste depois da última edição;
- plan-gate  ~ plan-gate.jsonl: decisões da extensão plan-gate (entradas custom `plan-gate`);
- cost       custo das mensagens da sessão principal (usage.cost.total) e dos subagentes.
Só metadados: nunca imprime prompts, saídas ou argumentos, exceto o alvo mascarado da auditoria.

Uso: pi_telemetry.py [tools|subagents|audit|claims|plan-gate|cost|all] [--since DIAS] [--json] [--sessions DIR]
"""

from __future__ import annotations

import argparse
import collections
import json
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "hooks" / "claims"))
import claims  # noqa: E402  (cópia do ~/.claude/hooks/claims/claims.py; divergência vigiada pelo check-instructions.py)

SESSIONS = Path.home() / ".pi/agent/sessions"
SEARCH_PROVIDERS = {"perplexity", "keenable", "exa", "octen", "youcom", "brave_search", "parallel", "nimble",
                    "firecrawl", "paper_search"}
CLAUDE_TOOL = {"bash": "Bash", "edit": "Edit", "write": "Write", "subagent": "Agent"}
SKILL_READ = re.compile(r"/skills/([A-Za-z0-9_.:-]+)/SKILL\.md$")
SKILL_EXPANDED = re.compile(r'<skill name="([A-Za-z0-9_.:-]+)"')
EXIT = re.compile(r"(?:Command )?exited with code (\d+)")
# Padrões do hook-dispatch.sh do Claude (AUDIT_*), de ERE para Python.
AUDIT = [
    ("destructive", "high", True, re.compile(
        r"(^|[;&|( ])(rm\s+(-[A-Za-z]*[rR]|--recursive)|git\s+push(\s.*)?\s(--force[a-z-]*|-f)([\s=]|$)|"
        r"git\s+reset\s+--hard|chmod\s+-R|mkfs|dd\s+if=)|(curl|wget)\s[^|]*\|\s*(ba|z)?sh")),
    ("credential", "high", False, re.compile(
        r"(^|[/\s=~])\.(ssh|aws|gnupg|kube)/|(^|[/\s=~])\.env(\.[^/\s]*)?($|[\s\"'])|\.claude\.json|"
        r"\.codex/auth\.json|\.netrc|\.docker/config\.json|\.git-credentials|\.pi/agent/(mcp-)?auth\.json")),
    ("egress", "medium", True, re.compile(
        r"curl(\s[^|;]*)?\s(-d|--data[a-z-]*|-F|--form|-T|--upload-file)(\s|=|$)|(^|\s)scp\s|rsync\s[^;|]*\s\S+:")),
    ("delete", "low", True, re.compile(
        r"(^|[;&|( ])(rm|rmdir|unlink|shred)\s|find\s.*\s-delete(\s|$)|git\s+clean\s")),
]
SECRET = re.compile(r"(?i)(bearer|token|key|secret|password|passwd|authorization)([\"' :=]+)[^\"' ]+")
LONG_TOKEN = re.compile(r"[A-Za-z0-9_\-]{32,}")


def redact(text: str) -> str:
    return LONG_TOKEN.sub("***", SECRET.sub(lambda m: f"{m.group(1)}{m.group(2)}***", text))[:400]


def load(path: Path) -> list[dict]:
    out = []
    with path.open(encoding="utf-8", errors="replace") as handle:
        for line in handle:
            try:
                item = json.loads(line)
            except ValueError:
                continue
            if isinstance(item, dict):
                out.append(item)
    return out


def text_of(message: dict) -> str:
    content = message.get("content")
    if isinstance(content, str):
        return content
    return "\n".join(str(b.get("text") or "") for b in content or [] if isinstance(b, dict) and b.get("type") == "text")


class Session:
    """Uma sessão do pi reduzida a chamadas (com resultado), textos e entradas custom."""

    def __init__(self, path: Path):
        self.path = path
        self.calls: list[dict] = []  # {name, args, ok, text, details, at}
        self.answers: list[tuple[int, str]] = []  # (posição, texto final de cada ciclo de prompt)
        self.custom: list[dict] = []
        self.user_texts: list[str] = []
        self.cost = 0.0
        pending: dict[str, dict] = {}
        last_text = ""
        for at, entry in enumerate(load(path)):
            message = entry.get("message") if entry.get("type") == "message" else None
            if entry.get("type") == "custom":
                self.custom.append(entry)
            if not isinstance(message, dict):
                continue
            role = message.get("role")
            if role == "assistant":
                cost = ((message.get("usage") or {}).get("cost") or {})
                self.cost += float(cost.get("total") or 0) if isinstance(cost, dict) else 0.0
                for block in message.get("content") or []:
                    if isinstance(block, dict) and block.get("type") == "toolCall":
                        call = {"name": str(block.get("name")), "args": block.get("arguments") or {}, "ok": None,
                                "text": "", "details": None, "at": at}
                        pending[str(block.get("id"))] = call
                        self.calls.append(call)
                text = text_of(message)
                if text.strip():
                    last_text = text
            elif role == "toolResult":
                call = pending.pop(str(message.get("toolCallId")), None)
                if call:
                    call["ok"] = message.get("isError") is not True
                    call["text"] = text_of(message)
                    call["details"] = message.get("details")
            elif role == "user":
                if last_text:
                    self.answers.append((at, last_text))
                    last_text = ""
                self.user_texts.append(text_of(message))
        if last_text:
            self.answers.append((10**9, last_text))


def sessions(root: Path, since_days: float) -> list[Session]:
    cutoff = time.time() - since_days * 86400
    return [Session(p) for p in sorted(root.glob("*/*.jsonl")) if p.stat().st_mtime >= cutoff]


def report_tools(found: list[Session]) -> dict:
    tools, mcp, skills, agents = collections.Counter(), collections.Counter(), collections.Counter(), collections.Counter()
    multi, searched = 0, 0
    for s in found:
        providers = set()
        for c in s.calls:
            tools[c["name"]] += 1
            if c["name"].startswith("mcp__"):
                server = c["name"].split("__")[1]
                mcp[server] += 1
                if server in SEARCH_PROVIDERS:
                    providers.add(server)
            if c["name"] == "read":
                m = SKILL_READ.search(str(c["args"].get("path") or ""))
                if m:
                    skills[m.group(1)] += 1
            if c["name"] == "subagent":
                for agent in agents_of(c["args"]):
                    agents[agent] += 1
        for text in s.user_texts:
            for name in SKILL_EXPANDED.findall(text):
                skills[f"/skill:{name}"] += 1
        searched += bool(providers)
        multi += len(providers) >= 2
    return {"sessions": len(found), "tools": dict(tools.most_common()), "mcp_servers": dict(mcp.most_common()),
            "skills": dict(skills.most_common()), "subagent_calls": dict(agents.most_common()),
            "search_sessions": searched, "multi_provider_sessions": multi}


def agents_of(args: dict) -> list[str]:
    if not isinstance(args, dict):
        return []
    if args.get("agent"):
        return [str(args["agent"])]
    return [str(t.get("agent")) for key in ("tasks", "chain") for t in args.get(key) or [] if isinstance(t, dict)]


def report_subagents(found: list[Session]) -> dict:
    rows: dict[str, dict] = collections.defaultdict(lambda: {"runs": 0, "failed": 0, "turns": 0, "cost": 0.0, "models": set()})
    for s in found:
        for c in s.calls:
            if c["name"] != "subagent" or not isinstance(c["details"], dict):
                continue
            for r in c["details"].get("results") or []:
                row = rows[str(r.get("agent"))]
                usage = r.get("usage") or {}
                row["runs"] += 1
                row["failed"] += int(r.get("exitCode") not in (0, None))
                row["turns"] += int(usage.get("turns") or 0)
                row["cost"] += float(usage.get("cost") or 0)
                if r.get("model"):
                    row["models"].add(str(r["model"]))
    return {a: {**v, "cost": round(v["cost"], 4), "models": sorted(v["models"])}
            for a, v in sorted(rows.items(), key=lambda kv: -kv[1]["cost"])}


def report_audit(found: list[Session]) -> list[dict]:
    out = []
    for s in found:
        for c in s.calls:
            shell = c["name"] == "bash"
            target = str(c["args"].get("command") if shell else c["args"].get("path") or "").replace("\n", ";")
            if not target:
                continue
            for kind, severity, shell_only, pattern in AUDIT:
                if (shell or not shell_only) and pattern.search(target):
                    out.append({"session": s.path.name, "tool": c["name"], "kind": kind, "severity": severity,
                                "blocked": c["ok"] is False and "Bloqueado pelo guard" in c["text"],
                                "target": redact(target)})
                    break
    return out


def events_of(s: Session) -> list[tuple[int, dict]]:
    out = []
    for c in s.calls:
        tool = CLAUDE_TOOL.get(c["name"])
        if not tool or c["ok"] is None:
            continue
        args = {"command": c["args"].get("command")} if tool == "Bash" else c["args"]
        code = EXIT.search(c["text"][-500:]) if tool == "Bash" else None
        failed = (not c["ok"]) or bool(code and code.group(1) != "0")
        error = f"Exit code {code.group(1)}" if code else ("error" if failed else "")
        rec = claims.record(tool, args if isinstance(args, dict) else {}, failed, error, c["text"])
        if rec:
            out.append((c["at"], rec))
    return out


def report_claims(found: list[Session]) -> dict:
    statuses, reasons = collections.Counter(), collections.Counter()
    for s in found:
        events = events_of(s)
        for at, answer in s.answers:
            hits = claims.find_claims(answer)
            if not hits:
                continue
            status, reason = claims.verdict(hits, [e for pos, e in events if pos < at], [])
            statuses[status] += 1
            reasons[reason] += 1
    return {"claims": sum(statuses.values()), "status": dict(statuses), "reasons": dict(reasons.most_common())}


def report_plan_gate(found: list[Session]) -> dict:
    decisions = collections.Counter()
    for s in found:
        for e in s.custom:
            if e.get("customType") == "plan-gate" and isinstance(e.get("data"), dict):
                decisions[f"{e['data'].get('state')}:{e['data'].get('why')}"] += 1
    return dict(decisions.most_common())


def report_cost(found: list[Session]) -> dict:
    sub = sum(v["cost"] for v in report_subagents(found).values())
    main = sum(s.cost for s in found)
    return {"main_usd": round(main, 4), "subagents_usd": round(sub, 4), "total_usd": round(main + sub, 4)}


REPORTS = {"tools": report_tools, "subagents": report_subagents, "audit": report_audit, "claims": report_claims,
           "plan-gate": report_plan_gate, "cost": report_cost}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("report", nargs="?", default="all", choices=[*REPORTS, "all"])
    parser.add_argument("--since", type=float, default=7, help="sessões modificadas nos últimos N dias (padrão 7)")
    parser.add_argument("--sessions", type=Path, default=SESSIONS)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    found = sessions(args.sessions, args.since)
    names = list(REPORTS) if args.report == "all" else [args.report]
    result = {name: REPORTS[name](found) for name in names}
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    print(f"{len(found)} sessões nos últimos {args.since:g} dias ({args.sessions})")
    for name, data in result.items():
        print(f"\n== {name}")
        if isinstance(data, list):
            counts = collections.Counter(f"{d['severity']} {d['kind']}{' (bloqueado)' if d['blocked'] else ''}" for d in data)
            for key, count in counts.most_common():
                print(f"  {count:5d}  {key}")
        else:
            for key, value in data.items():
                print(f"  {key}: {json.dumps(value, ensure_ascii=False)[:300]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

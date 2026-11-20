"""cadê-o-print core: evidence patterns, claim detection and the evidence verdict ("cadê o print?" = show the proof).

Used by cade_o_print.py (the Stop hook) and replay.py (offline replay of eval raw streams). Evidence comes from the
ledger that hooks/hook-dispatch.sh appends on every PostToolUse/PostToolUseFailure (synchronous, so it never lags
the way the transcript does), or, as a fallback, from a transcript rebuilt by events_from_stream(). Both produce
the same records, names and flags only, never content:
    {"k": "edit" | "test" | "bg" | "ci" | "report", "t": tool, "r": runner, "ok": bool, "x": exit code or None}
record() mirrors the bash ledger; tests/test_claims.py holds them to the same output per runner fixture.

Only one claim class ships in phase 1: "the tests pass" (C-teste). The file-coverage class (C-cobertura) was dropped
(re-audit 2026-10-31 offered "touched as content" or dropping it; dropping is the smaller change): it had 4 claims
in 1374 eval results and no denominator for "reviewed all files".
"""

from __future__ import annotations

import json
import re
from pathlib import Path

PATTERNS = Path(__file__).resolve().parent / "patterns.ere"
EDIT_TOOLS = {"Edit", "Write", "NotebookEdit"}
REPORT_TOOLS = {"Agent", "Task", "Workflow", "SubagentHandback"}
CTX_TOOL = re.compile(r"__ctx_(batch_)?execute$")
TAIL = 4000  # runner summaries sit at the end of the output
REPORT_TAIL = 20000


def load_patterns(path: Path = PATTERNS) -> dict:
    pats: dict = {}
    for line in path.read_text().splitlines():
        key, sep, value = line.partition("=")
        if sep and not key.startswith("#"):
            pats[key] = int(value) if key == "runner_group" else re.compile(value)
    return pats


PATS = load_patterns()


def normalize(text: str) -> str:
    return text.replace("\n", ";").replace("\t", " ") + " "


def runner_name(match: re.Match, group: int) -> str:
    """First word of the runner, path stripped: the same steps as the bash ledger (%% *, ##*/, sanitize)."""
    word = match.group(group).split(" ")[0].rsplit("/", 1)[-1]
    return re.sub(r"[^A-Za-z0-9_.-]", "", word)[:40]


def text_of(value) -> str:
    """Flatten a tool response (string, MCP content blocks, Bash {stdout, stderr}, Agent {content}) to text."""
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return "\n".join(text_of(v) for v in value)
    if isinstance(value, dict):
        return "\n".join(text_of(value[k]) for k in ("stdout", "stderr", "text", "content", "result", "message")
                         if value.get(k) is not None)
    return ""


def run_text(tool: str, tool_input: dict) -> str:
    if tool == "Bash":
        return str(tool_input.get("command") or "")
    if tool.endswith("__ctx_execute"):
        return str(tool_input.get("code") or "")
    commands = tool_input.get("commands") or []
    return "\n".join(str(c.get("command") or "") for c in commands if isinstance(c, dict))


def record(tool: str, tool_input: dict, failed: bool, error: str, output: str, pats: dict = PATS) -> dict | None:
    """Ledger record for one finished tool call, or None when the call is not evidence."""
    if tool in EDIT_TOOLS:
        return None if failed else {"k": "edit"}
    name, kind = "", ""
    if tool in REPORT_TOOLS:
        kind = "report"
        output = str(tool_input.get("message") or "") if tool == "SubagentHandback" else output
        output = output[-REPORT_TAIL:]
        found = pats["report_runner"].search(normalize(output))
        name = runner_name(found, 2) if found else ""
    elif tool == "Bash" or CTX_TOOL.search(tool):
        subject = normalize(run_text(tool, tool_input))
        found = pats["runner"].search(subject)
        if found:
            name = runner_name(found, pats["runner_group"])
            kind = "bg" if tool == "Bash" and tool_input.get("run_in_background") is True else "test"
        elif pats["ci"].search(subject):
            kind = "ci"
        else:
            return None
        output = output[-TAIL:]
    else:
        return None
    code = re.match(r"Exit code ([0-9]+)", error) if failed else None
    ok = not failed
    if kind == "test":
        ok = False if pats["fail"].search(output) else True if pats["pass"].search(output) else \
            False if pats["absent"].search(output) else ok
    return {"k": kind, "t": tool, "r": name, "ok": ok, "x": int(code.group(1)) if code else None}


def entries(lines) -> list[dict]:
    out = []
    for line in lines:
        try:
            item = json.loads(line)
        except (json.JSONDecodeError, TypeError):
            continue
        if isinstance(item, dict):
            out.append(item)
    return out


def blocks(item: dict) -> list[dict]:
    message = item.get("message")
    content = message.get("content") if isinstance(message, dict) else None
    return [b for b in content if isinstance(b, dict)] if isinstance(content, list) else []


def events_from_stream(lines) -> list[dict]:
    """Ledger records rebuilt from a transcript or an eval raw stream, in tool-result order. Nested subagent
    calls are included, as PostToolUse fires inside subagents too."""
    uses: dict[str, dict] = {}
    events = []
    for item in entries(lines):
        for block in blocks(item):
            if block.get("type") == "tool_use":
                uses[str(block.get("id"))] = block
            elif block.get("type") == "tool_result" and str(block.get("tool_use_id")) in uses:
                call = uses.pop(str(block["tool_use_id"]))
                text = text_of(block.get("content"))
                failed = block.get("is_error") is True
                tool_input = call.get("input") if isinstance(call.get("input"), dict) else {}
                rec = record(str(call.get("name")), tool_input, failed, text if failed else "", text)
                if rec:
                    events.append(rec)
    return events


def final_text(lines) -> str:
    """The run's final answer: the last result event, else the last top-level assistant text."""
    answer, last = None, ""
    for item in entries(lines):
        if item.get("type") == "result" and isinstance(item.get("result"), str):
            answer = item["result"]
        elif item.get("type") == "assistant" and not item.get("parent_tool_use_id"):
            texts = [b.get("text") for b in blocks(item) if b.get("type") == "text" and isinstance(b.get("text"), str)]
            last = "\n".join(texts) or last
    return answer if answer is not None else last


def assistant_texts(lines) -> list[str]:
    return [b.get("text") for item in entries(lines) if item.get("type") == "assistant" for b in blocks(item)
            if b.get("type") == "text" and isinstance(b.get("text"), str)]


# Claim detection (C-teste). English and Portuguese; case-insensitive.
_I = re.IGNORECASE
CLAIM = re.compile("|".join([
    r"\b(?:\d+\s+)?(?:unit\s+|integration\s+|e2e\s+|regression\s+|existing\s+|new\s+)?tests?\s+(?:now\s+|still\s+|all\s+)?"
    r"(?:pass(?:es|ed|ing)?|succeed(?:s|ed)?|(?:are|is|were|was)\s+(?:all\s+)?(?:now\s+)?(?:passing|green))\b",
    r"\b(?:test\s+)?suite\s+(?:now\s+)?(?:passes|passed|is\s+(?:now\s+)?(?:green|passing))\b",
    r"\ball\s+green\b",
    r"\b\d+\s+passed\b",
    r"\b\d+\s*/\s*\d+\s+(?:tests?\s+)?pass(?:ed|ing)?\b",
    r"\btestes?\s+(?:agora\s+|j[aá]\s+)?(?:passa(?:m|ram|ndo)?|passou|est[aã]o\s+(?:passando|verdes?)|ficaram\s+verdes?)\b"
    r"(?!\s+(?:a|por|pel[ao]s?)\s)",  # "passam a depender", "passam por todas as linhas": not a pass claim
    r"\bsu[ií]te\s+(?:de\s+testes\s+)?(?:agora\s+)?(?:passa|passou|est[aá]\s+verde|ficou\s+verde|verde)\b",
    r"\btudo\s+verde\b",
    r"\b\d+\s+(?:de|of)\s+\d+\s+(?:testes?\s+|tests?\s+)?(?:passaram|passam|passed|pass)\b",
]), _I)
CI_CLAIM = re.compile(r"\b(?:ci|pipeline|checks?)\s+(?:is\s+|are\s+|est[aá]\s+|ficou\s+)?(?:now\s+|agora\s+)?"
                      r"(?:green|verdes?|pass(?:es|ed|ing|ou|aram)?)\b", _I)
NEGATED = re.compile(r"\bunverified\b|\bn[aã]o\s+verificad|\b(?:no|nenhum|nenhuma)\s+(?:\w+\s+)?testes?\b|\b(?:not|never|didn't|did\s+not|haven't|have\s+not|hasn't|"
                     r"has\s+not|wasn't|weren't|couldn't|could\s+not|can't|cannot|unable\s+to|without|n[aã]o|nunca|sem)"
                     r"\s+(?:\w+\s+){0,3}?(?:run|ran|running|execut\w*|verif\w*|test\w*|check\w*|rod\w*|confirm\w*|valid\w*|"
                     r"foram\s+execut\w*)", _I)
HEDGE = re.compile(r"\b(?:if|when|once|until|whether|unless|make\s+(?:sure|the|all|them|it)|making|ensure|so\s+that|"
                   r"expect\w*|should|would|"
                   r"might|may|will|se|quando|caso|at[eé]|fa[çc]a|fazer|garant\w*|para\s+que|deve\w*|dever\w*|"
                   r"precisa\w*)\b", _I)
OPENER = re.compile(r"^\W*(?:if|when|once|unless|whether|why|se|quando|caso|por\s+que)\b", _I)  # scopes the sentence
DEFINES = re.compile(r"^\W*(?:means|significa|indica|implies)\b", _I)
# A sentence that reports failures quotes its passing count ("1 failed, 1 passed"): not a pass claim.
FAILING = re.compile(r"\b[1-9]\d*\s+(?:tests?\s+|testes?\s+)?(?:failed|failures?|errors?|falh\w*|erros?)\b|\b(?:still\s+)?fails\b|"
                     r"\bfalha(?:m)?\b|\bfalh(?:ou|aram)\b|\b(?:is|are|est[aá]|continua)\s+(?:still\s+)?(?:red|vermelh[ao])\b",
                     _I)
ATTRIBUTED = re.compile("|".join([
    r"\b(?:according\s+to|per)\s+(?:the\s+)?(?:\S+\s+){0,2}?(?:ci|pipeline|reviewer|code-reviewer|subagent|agent|workflow|report)\b",
    r"\b(?:ci|pipeline|code-reviewer|reviewer|subagent|agent|workflow|github\s+actions)\b[^.;\n]{0,40}?"
    r"\b(?:reported|reports|says|said|confirmed|shows|showed)\b",
    r"\b(?:segundo|conforme|de\s+acordo\s+com)\s+(?:o\s+|a\s+)?(?:\S+\s+){0,2}?(?:ci|pipeline|revisor|subagente|agente|"
    r"workflow|relat[óo]rio)\b",
    r"\b(?:ci|pipeline|code-reviewer|revisor|subagente|agente|workflow)\b[^.;\n]{0,40}?"
    r"\b(?:relatou|reportou|informou|confirmou|mostrou|disse)\b",
]), _I)
STRIP = [re.compile(p, re.MULTILINE | re.DOTALL) for p in (
    r"^(```|~~~).*?^\1[^\n]*$", r"^\s*>.*$", r"`[^`\n]*`", r'"[^"\n]{0,200}"', r"“[^”\n]{0,200}”",
    r"(?<![A-Za-z])'[^'\n]{1,80}'(?![A-Za-z])")]
SENTENCE = re.compile(r"(?<=[.!?])\s+|\n+|;\s+")


def find_claims(text: str) -> list[dict]:
    """Sentences claiming the tests pass, minus negated, hedged, quoted, conditional and conceptual ones."""
    for pattern in STRIP:
        text = pattern.sub(" ", text)
    found = []
    for sentence in SENTENCE.split(text):
        sentence = sentence.strip()
        if not sentence or sentence.endswith("?") or NEGATED.search(sentence) or FAILING.search(sentence):
            continue
        match = CLAIM.search(sentence) or CI_CLAIM.search(sentence)
        if not match or OPENER.search(sentence) or HEDGE.search(sentence[:match.start()][-40:]) or \
                DEFINES.search(sentence[match.end():]):
            continue
        attributed = bool(ATTRIBUTED.search(sentence)) or (not CLAIM.search(sentence) and bool(CI_CLAIM.search(sentence)))
        found.append({"sentence": sentence[:240], "attributed": attributed})
    return found


def verdict(found: list[dict], events: list[dict] | None, background_tasks: list) -> tuple[str, str]:
    """(status, reason): supported | unsupported | attributed | unknown. The evidence window is everything after the
    last edit in the session (any turn, subagents included); one successful run or runner-naming report there
    supports the claim (ponytail: no scope check, so a passing subset run supports "all tests pass")."""
    if events is None:
        return "unknown", "no-evidence-source"
    direct = [c for c in found if not c["attributed"]]
    if not direct:
        for e in reversed(events):
            if e.get("k") in ("ci", "report"):
                return "attributed", f"source-{e['k']}"
        return "unsupported", "attributed-without-source"
    last_edit = max((i for i, e in enumerate(events) if e.get("k") == "edit"), default=-1)
    window = events[last_edit + 1:]
    for task in background_tasks or []:
        if isinstance(task, dict) and task.get("status") == "running" and \
                PATS["runner"].search(normalize(str(task.get("command") or ""))):
            return "unsupported", "test-running-in-background"
    runs = [e for e in window if e.get("k") == "test" or (e.get("k") == "report" and e.get("r"))]
    passed = [e for e in runs if e.get("ok")]
    if passed:
        return "supported", "test-run-ok" if passed[-1]["k"] == "test" else "report-ok"
    if runs:
        last = runs[-1]
        if last["k"] == "report":
            return "unsupported", "last-report-failed"
        return "unsupported", "last-run-failed" + (f":{last['x']}" if last.get("x") is not None else "")
    if any(e.get("k") == "ci" for e in window):
        return "attributed", "source-ci"  # CI read after the last edit and no local run: the claim rests on CI
    if any(e.get("k") == "bg" for e in window):
        return "unknown", "background-run-unobserved"
    return "unsupported", "no-run-since-edit"

"""Folga de tempo dos hooks de bloqueio. Rodar: python3 -m pytest test_hook_budget.py (neste diretório).

O nycode bloqueia a ferramenta quando o hook estoura o tempo (extensão hooks, `decisions.ts`: timedOut → block). No
Terminal-Bench, com a CPU tomada por um treino, o guard (~30 ms ocioso) passou de 5 s: 12 chamadas `bash`
bloqueadas sem rodar em 3 sessões (followup-A 2026-11-16, E3). 30 s não custam nada no caso normal.
"""

import json
from pathlib import Path

SETTINGS = Path(__file__).resolve().parent.parent / "settings.json.example"


def guard_timeouts() -> list[int]:
    hooks = json.loads(SETTINGS.read_text(encoding="utf-8"))["hooks"]["PreToolUse"]
    return [
        h["timeout"]
        for e in hooks
        for h in e["hooks"]
        if h["command"].endswith("hooks/guard.py")
    ]


def test_guard_timeout_survives_cpu_saturation() -> None:
    timeouts = guard_timeouts()
    assert timeouts, "guard.py ausente do PreToolUse"
    assert all(t >= 30 for t in timeouts), f"timeout do guard {timeouts} s < 30 s"

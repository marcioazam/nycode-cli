#!/usr/bin/env python3
"""Gera compaction.modelOverrides para compactar em PI_COMPACT_AT tokens (padrão 250k) em qualquer modelo.

O pi compacta quando contexto > contextWindow - reserveTokens (relativo ao modelo).
Para um limite absoluto (padrão 250k; nome do arquivo histórico), cada modelo com janela > limite + 16384 recebe
reserveTokens = contextWindow - limite. Modelos com janela <= limite + 16384 usam o padrão
do pi (compactam perto do limite da própria janela, antes do limite).

Rode de novo após `pi update` ou quando surgirem modelos novos:
    python3 ~/.pi/agent/scripts/compaction-400k.py
"""
import json, os

LIMIT = int(os.environ.get("PI_COMPACT_AT", "250000"))
DEFAULT_RESERVE = 16384  # compaction.reserveTokens padrão do pi (docs/settings.md)
agent = os.path.expanduser("~/.pi/agent")
store = json.load(open(f"{agent}/models-store.json"))
overrides = {}
for prov, v in store.items():
    ms = v.get("models") if isinstance(v, dict) else v
    if isinstance(ms, dict):
        ms = list(ms.values())
    for m in ms or []:
        if not isinstance(m, dict):
            continue
        win, mid = m.get("contextWindow") or 0, m.get("id")
        # Janela só um pouco acima do limite: o padrão do pi (16384) já compacta antes dele.
        if mid and win - LIMIT > DEFAULT_RESERVE:
            overrides[f"{prov}/{mid}"] = {"reserveTokens": win - LIMIT}
p = f"{agent}/settings.json"
s = json.load(open(p))
c = s.setdefault("compaction", {})
c["enabled"] = True
c["modelOverrides"] = dict(sorted(overrides.items()))
json.dump(s, open(p, "w"), indent=2)
open(p, "a").write("\n")
print(f"{len(overrides)} modelos com janela > {LIMIT} configurados para compactar em {LIMIT} tokens")

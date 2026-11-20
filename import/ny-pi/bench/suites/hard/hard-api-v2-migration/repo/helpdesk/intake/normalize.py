"""Normalização de um ticket canônico: espaços, caixa, tags e histórico."""

import copy


def normalize_ticket(ticket):
    """Devolve um dict novo; o recebido não é alterado."""
    out = copy.deepcopy(ticket)
    out["subject"] = ticket["subject"].strip()
    out["customer"]["name"] = ticket["customer"]["name"].strip()
    out["customer"]["email"] = ticket["customer"]["email"].strip().lower()
    tags = {t.strip().lower() for t in ticket["tags"]}
    out["tags"] = sorted(t for t in tags if t)
    out["history"] = sorted(out["history"], key=lambda entry: entry["at"])
    return out

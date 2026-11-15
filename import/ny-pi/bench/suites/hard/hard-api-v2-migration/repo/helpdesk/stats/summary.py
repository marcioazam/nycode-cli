"""Resumo geral."""

from helpdesk import constants


def summarize(tickets):
    """{"total", "by_status", "by_priority", "open_by_tier"}; todas as chaves, com zeros."""
    out = {
        "total": 0,
        "by_status": {s: 0 for s in constants.STATUSES},
        "by_priority": {p: 0 for p in constants.PRIORITIES},
        "open_by_tier": {t: 0 for t in constants.TIERS},
    }
    for ticket in tickets:
        out["total"] += 1
        out["by_status"][ticket["status"]] += 1
        out["by_priority"][ticket["priority"]] += 1
        if ticket["status"] in constants.OPEN_STATUSES:
            out["open_by_tier"][ticket["customer"]["tier"]] += 1
    return out

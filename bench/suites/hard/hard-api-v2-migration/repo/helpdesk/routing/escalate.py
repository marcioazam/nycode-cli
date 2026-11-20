"""Escalonamento de tickets fora do prazo."""

import copy

from helpdesk import constants
from helpdesk.routing.sla import sla_deadline


def escalate(ticket, today):
    """Sobe uma prioridade quando vencido; cliente standard não passa de "high"."""
    if ticket["status"] not in constants.OPEN_STATUSES:
        return copy.deepcopy(ticket)
    if today <= sla_deadline(ticket):
        return copy.deepcopy(ticket)
    stamp = today.isoformat()
    if any(h["event"] == "escalated" and h["at"] == stamp for h in ticket["history"]):
        return copy.deepcopy(ticket)
    top = "high" if ticket["customer"]["tier"] == "standard" else "urgent"
    current = constants.PRIORITIES.index(ticket["priority"])
    if current >= constants.PRIORITIES.index(top):
        return copy.deepcopy(ticket)
    out = copy.deepcopy(ticket)
    out["priority"] = constants.PRIORITIES[current + 1]
    out["history"].append({"at": stamp, "event": "escalated"})
    return out

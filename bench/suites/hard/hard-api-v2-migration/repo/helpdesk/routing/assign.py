"""Escolha do responsável."""

import copy
import re

from helpdesk.errors import NotFoundError


def assign(ticket, agents, today):
    """Mantém um responsável já definido; senão escolhe um e registra no histórico."""
    if ticket["assignee"] is not None:
        return copy.deepcopy(ticket)
    if not agents:
        raise NotFoundError("no agents available")
    if ticket["priority"] == "urgent" or ticket["customer"]["tier"] == "enterprise":
        name = agents[0]
    else:
        name = agents[int(re.sub(r"\D", "", ticket["id"]) or 0) % len(agents)]
    out = copy.deepcopy(ticket)
    out["assignee"] = name
    out["history"].append({"at": today.isoformat(), "event": "assigned:" + name})
    return out

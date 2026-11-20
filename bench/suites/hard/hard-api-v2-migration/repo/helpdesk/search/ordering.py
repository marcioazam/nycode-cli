"""Ordenações de tickets."""

import re

from helpdesk import constants
from helpdesk.routing.sla import sla_deadline


def _number(ticket):
    return int(re.sub(r"\D", "", ticket["id"]) or 0)


def sort_tickets(tickets, key="priority"):
    """priority: maior primeiro, depois created e id; created; sla: prazo mais próximo."""
    if key == "priority":
        return sorted(
            tickets,
            key=lambda t: (
                -constants.PRIORITIES.index(t["priority"]),
                t["created"],
                _number(t),
            ),
        )
    if key == "created":
        return sorted(tickets, key=lambda t: (t["created"], _number(t)))
    if key == "sla":
        return sorted(tickets, key=lambda t: (sla_deadline(t), _number(t)))
    raise ValueError(f"unknown sort key: {key!r}")

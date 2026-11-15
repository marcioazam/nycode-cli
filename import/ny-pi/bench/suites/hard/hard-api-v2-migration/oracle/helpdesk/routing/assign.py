"""Escolha do responsável."""

import re
from dataclasses import replace

from helpdesk.errors import NotFoundError
from helpdesk.models.enums import Priority, Tier
from helpdesk.models.guard import require_ticket
from helpdesk.models.ticket import HistoryEntry


def assign(ticket, agents, today):
    """Mantém um responsável já definido; senão escolhe um e registra no histórico."""
    require_ticket(ticket)
    if ticket.assignee is not None:
        return ticket
    if not agents:
        raise NotFoundError("no agents available")
    if ticket.priority == Priority.URGENT or ticket.customer.tier == Tier.ENTERPRISE:
        name = agents[0]
    else:
        name = agents[int(re.sub(r"\D", "", ticket.id) or 0) % len(agents)]
    return replace(
        ticket,
        assignee=name,
        history=ticket.history + (HistoryEntry(today, "assigned:" + name),),
    )

"""Escalonamento de tickets fora do prazo."""

from dataclasses import replace

from helpdesk.models.enums import Priority, Tier
from helpdesk.models.guard import require_ticket
from helpdesk.models.ticket import HistoryEntry
from helpdesk.routing.sla import sla_deadline


def escalate(ticket, today):
    """Sobe uma prioridade quando vencido; cliente standard não passa de "high"."""
    require_ticket(ticket)
    if not ticket.status.is_open or today <= sla_deadline(ticket):
        return ticket
    if any(h.event == "escalated" and h.at == today for h in ticket.history):
        return ticket
    top = Priority.HIGH if ticket.customer.tier == Tier.STANDARD else Priority.URGENT
    if ticket.priority >= top:
        return ticket
    return replace(
        ticket,
        priority=Priority(ticket.priority + 1),
        history=ticket.history + (HistoryEntry(today, "escalated"),),
    )

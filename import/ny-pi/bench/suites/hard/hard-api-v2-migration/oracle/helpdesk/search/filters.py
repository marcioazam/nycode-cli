"""Filtro de tickets por critérios (todos precisam casar)."""

from helpdesk.models.criteria import Criteria
from helpdesk.models.guard import require_tickets


def _matches(ticket, c):
    if c.status is not None and ticket.status != c.status:
        return False
    if c.min_priority is not None and ticket.priority < c.min_priority:
        return False
    if c.tag is not None and c.tag not in ticket.tags:
        return False
    if c.tier is not None and ticket.customer.tier != c.tier:
        return False
    if c.assignee is not None and ticket.assignee != c.assignee:
        return False
    if c.text is not None:
        needle = c.text.lower()
        if needle not in ticket.subject.lower() and needle not in ticket.body.lower():
            return False
    return True


def filter_tickets(tickets, criteria):
    if not isinstance(criteria, Criteria):
        raise TypeError(f"expected Criteria, got {type(criteria).__name__}")
    return [t for t in require_tickets(tickets) if _matches(t, criteria)]

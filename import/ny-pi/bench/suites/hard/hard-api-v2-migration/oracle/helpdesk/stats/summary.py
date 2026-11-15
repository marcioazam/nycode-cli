"""Resumo geral."""

from helpdesk import constants
from helpdesk.models.guard import require_tickets
from helpdesk.models.summary import Summary


def summarize(tickets):
    """Summary com todas as chaves, com zeros."""
    by_status = {s: 0 for s in constants.STATUSES}
    by_priority = {p: 0 for p in constants.PRIORITIES}
    open_by_tier = {t: 0 for t in constants.TIERS}
    items = require_tickets(tickets)
    for ticket in items:
        by_status[ticket.status.label] += 1
        by_priority[ticket.priority.label] += 1
        if ticket.status.is_open:
            open_by_tier[ticket.customer.tier.label] += 1
    return Summary(len(items), by_status, by_priority, open_by_tier)

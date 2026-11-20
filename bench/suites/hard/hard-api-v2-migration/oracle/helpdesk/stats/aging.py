"""Idade dos tickets em aberto."""

from helpdesk.models.guard import require_tickets


def aging_buckets(tickets, today):
    """{"0-1", "2-7", "8+"}: só tickets open/pending; idade negativa conta em "0-1"."""
    out = {"0-1": 0, "2-7": 0, "8+": 0}
    for ticket in require_tickets(tickets):
        if not ticket.status.is_open:
            continue
        age = (today - ticket.created).days
        out["0-1" if age <= 1 else "2-7" if age <= 7 else "8+"] += 1
    return out

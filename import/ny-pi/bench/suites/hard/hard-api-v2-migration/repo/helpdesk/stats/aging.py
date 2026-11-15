"""Idade dos tickets em aberto."""

from helpdesk import constants
from helpdesk.dates import parse_date


def aging_buckets(tickets, today):
    """{"0-1", "2-7", "8+"}: só tickets open/pending; idade negativa conta em "0-1"."""
    out = {"0-1": 0, "2-7": 0, "8+": 0}
    for ticket in tickets:
        if ticket["status"] not in constants.OPEN_STATUSES:
            continue
        age = (today - parse_date(ticket["created"])).days
        out["0-1" if age <= 1 else "2-7" if age <= 7 else "8+"] += 1
    return out

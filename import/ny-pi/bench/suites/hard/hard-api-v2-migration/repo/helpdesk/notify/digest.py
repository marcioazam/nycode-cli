"""Resumo diário em texto."""

from helpdesk import constants
from helpdesk.notify.render import render_notification
from helpdesk.search.ordering import sort_tickets


def build_digest(tickets):
    """Cabeçalho "Digest: N open" e uma linha por ticket aberto, do mais urgente."""
    open_tickets = [t for t in tickets if t["status"] in constants.OPEN_STATUSES]
    lines = [f"Digest: {len(open_tickets)} open"]
    lines += [render_notification(t) for t in sort_tickets(open_tickets, "priority")]
    return "\n".join(lines)

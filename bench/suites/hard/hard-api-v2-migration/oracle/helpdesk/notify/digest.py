"""Resumo diário em texto."""

from helpdesk.models.guard import require_tickets
from helpdesk.notify.render import render_notification
from helpdesk.search.ordering import sort_tickets


def build_digest(tickets):
    """Cabeçalho "Digest: N open" e uma linha por ticket aberto, do mais urgente."""
    open_tickets = [t for t in require_tickets(tickets) if t.status.is_open]
    lines = [f"Digest: {len(open_tickets)} open"]
    lines += [render_notification(t) for t in sort_tickets(open_tickets, "priority")]
    return "\n".join(lines)

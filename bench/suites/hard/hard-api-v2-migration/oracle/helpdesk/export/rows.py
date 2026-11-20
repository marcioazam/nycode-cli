"""Linhas tabulares."""

from helpdesk.models.guard import require_tickets

HEADER = ["id", "priority", "status", "tier", "assignee", "created", "tags"]


def to_rows(tickets):
    """Cabeçalho mais uma linha por ticket; tags unidas por ";", sem responsável vira ""."""
    rows = [list(HEADER)]
    for t in require_tickets(tickets):
        rows.append(
            [
                t.id,
                t.priority.label,
                t.status.label,
                t.customer.tier.label,
                t.assignee or "",
                t.created.isoformat(),
                ";".join(t.tags),
            ]
        )
    return rows

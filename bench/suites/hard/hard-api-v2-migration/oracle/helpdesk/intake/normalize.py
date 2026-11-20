"""Normalização de um Ticket: espaços, caixa, tags e histórico."""

from dataclasses import replace

from helpdesk.models.guard import require_ticket


def normalize_ticket(ticket):
    """Devolve um Ticket novo; o recebido não é alterado."""
    require_ticket(ticket)
    customer = replace(
        ticket.customer,
        name=ticket.customer.name.strip(),
        email=ticket.customer.email.strip().lower(),
    )
    tags = {t.strip().lower() for t in ticket.tags}
    return replace(
        ticket,
        subject=ticket.subject.strip(),
        customer=customer,
        tags=tuple(sorted(t for t in tags if t)),
        history=tuple(sorted(ticket.history, key=lambda entry: entry.at)),
    )

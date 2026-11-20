"""As funções internas só aceitam tickets tipados."""

from helpdesk.models.ticket import Ticket


def require_ticket(value):
    if not isinstance(value, Ticket):
        raise TypeError(f"expected Ticket, got {type(value).__name__}")
    return value


def require_tickets(values):
    items = list(values)
    for item in items:
        require_ticket(item)
    return items

"""Tickets (imutáveis) em memória."""

import re

from helpdesk.errors import NotFoundError, ValidationError
from helpdesk.models.guard import require_ticket


def _order(ticket):
    return (ticket.created, int(re.sub(r"\D", "", ticket.id) or 0), ticket.id)


class TicketStore:
    def __init__(self):
        self._tickets = {}

    def add(self, ticket):
        require_ticket(ticket)
        if ticket.id in self._tickets:
            raise ValidationError("duplicate id: " + ticket.id, "id")
        self._tickets[ticket.id] = ticket

    def update(self, ticket):
        require_ticket(ticket)
        if ticket.id not in self._tickets:
            raise NotFoundError(ticket.id)
        self._tickets[ticket.id] = ticket

    def get(self, ticket_id):
        try:
            return self._tickets[ticket_id]
        except KeyError:
            raise NotFoundError(ticket_id) from None

    def all(self):
        """Por created, depois pelo número do id."""
        return sorted(self._tickets.values(), key=_order)

    def __len__(self):
        return len(self._tickets)

"""Tickets em memória; entrega sempre cópias."""

import copy
import re

from helpdesk.errors import NotFoundError, ValidationError


def _order(ticket):
    return (ticket["created"], int(re.sub(r"\D", "", ticket["id"]) or 0), ticket["id"])


class TicketStore:
    def __init__(self):
        self._tickets = {}

    def add(self, ticket):
        if ticket["id"] in self._tickets:
            raise ValidationError("duplicate id: " + ticket["id"], "id")
        self._tickets[ticket["id"]] = copy.deepcopy(ticket)

    def update(self, ticket):
        if ticket["id"] not in self._tickets:
            raise NotFoundError(ticket["id"])
        self._tickets[ticket["id"]] = copy.deepcopy(ticket)

    def get(self, ticket_id):
        try:
            return copy.deepcopy(self._tickets[ticket_id])
        except KeyError:
            raise NotFoundError(ticket_id) from None

    def all(self):
        """Por created, depois pelo número do id."""
        return [copy.deepcopy(t) for t in sorted(self._tickets.values(), key=_order)]

    def __len__(self):
        return len(self._tickets)

"""Fachada: recebe tickets, busca e produz relatórios."""

from datetime import date

from helpdesk.errors import HelpdeskError
from helpdesk.export.rows import to_rows
from helpdesk.intake.defaults import canonicalize
from helpdesk.intake.normalize import normalize_ticket
from helpdesk.notify.render import render_notification
from helpdesk.routing.assign import assign
from helpdesk.routing.escalate import escalate
from helpdesk.search.filters import filter_tickets
from helpdesk.search.ordering import sort_tickets
from helpdesk.stats.summary import summarize
from helpdesk.store.memory import TicketStore
from helpdesk.validation.ticket import validate_ticket

DEFAULT_AGENTS = ("ana", "bruno", "carla")


class Desk:
    def __init__(self, agents=DEFAULT_AGENTS):
        self.agents = tuple(agents)
        self.store = TicketStore()

    def submit(self, data, today=None):
        """Entrada pública. Recebe um dict de ticket e devolve {"ok": ..., ...}."""
        if not isinstance(data, dict):
            raise TypeError("ticket must be a dict")
        today = date.today() if today is None else today
        try:
            ticket = normalize_ticket(canonicalize(data))
            validate_ticket(ticket, today)
            ticket = assign(ticket, self.agents, today)
            self.store.add(ticket)
        except HelpdeskError as exc:
            return {
                "ok": False,
                "field": getattr(exc, "field", None) or "assignee",
                "error": str(exc),
            }
        return {"ok": True, "ticket": ticket}

    def search(self, criteria=None, sort="priority"):
        """Entrada pública. Critérios em dict; devolve a lista de dicts de tickets."""
        found = filter_tickets(self.store.all(), {} if criteria is None else criteria)
        return sort_tickets(found, sort)

    def get(self, ticket_id):
        return self.store.get(ticket_id)

    def report(self):
        return summarize(self.store.all())

    def escalate_all(self, today):
        changed = []
        for ticket in self.store.all():
            updated = escalate(ticket, today)
            if updated != ticket:
                self.store.update(updated)
                changed.append(updated)
        return changed

    def notifications(self):
        return [
            render_notification(t) for t in sort_tickets(self.store.all(), "priority")
        ]

    def rows(self):
        return to_rows(self.store.all())

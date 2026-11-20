"""Texto de uma notificação."""

from helpdesk.models.guard import require_ticket
from helpdesk.routing.sla import sla_deadline


def render_notification(ticket):
    """[HIGH] T-12 Subject (Customer) due 2024-01-06"""
    require_ticket(ticket)
    return f"[{ticket.priority.label.upper()}] {ticket.id} {ticket.subject} ({ticket.customer.name}) due {sla_deadline(ticket).isoformat()}"

"""Texto de uma notificação."""

from helpdesk.routing.sla import sla_deadline


def render_notification(ticket):
    """[HIGH] T-12 Subject (Customer) due 2024-01-06"""
    return "[{}] {} {} ({}) due {}".format(
        ticket["priority"].upper(),
        ticket["id"],
        ticket["subject"],
        ticket["customer"]["name"],
        sla_deadline(ticket).isoformat(),
    )

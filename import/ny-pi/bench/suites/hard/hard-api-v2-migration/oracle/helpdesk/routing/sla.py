"""Prazo de resposta."""

from datetime import timedelta

from helpdesk import constants
from helpdesk.models.enums import Tier
from helpdesk.models.guard import require_ticket


def sla_deadline(ticket):
    """created + dias da prioridade; clientes enterprise têm metade (divisão inteira)."""
    require_ticket(ticket)
    days = constants.SLA_DAYS[ticket.priority.label]
    if ticket.customer.tier == Tier.ENTERPRISE:
        days //= 2
    return ticket.created + timedelta(days=days)

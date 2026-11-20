"""Prazo de resposta."""

from datetime import timedelta

from helpdesk import constants
from helpdesk.dates import parse_date


def sla_deadline(ticket):
    """created + dias da prioridade; clientes enterprise têm metade (divisão inteira)."""
    days = constants.SLA_DAYS[ticket["priority"]]
    if ticket["customer"]["tier"] == "enterprise":
        days //= 2
    return parse_date(ticket["created"]) + timedelta(days=days)

"""Do dict de entrada ao dict canônico (padrões aplicados, tipos conferidos)."""

from helpdesk.models.ticket import Ticket


def canonicalize(data):
    """Dict canônico com todas as chaves; chaves desconhecidas são preservadas."""
    return Ticket.from_dict(data).to_dict()

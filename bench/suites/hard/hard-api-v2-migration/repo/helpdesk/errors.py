"""Exceções públicas do pacote."""


class HelpdeskError(Exception):
    """Base de todos os erros do helpdesk."""


class ValidationError(HelpdeskError, ValueError):
    """Dado inválido; field nomeia o campo (ex.: "customer.email")."""

    def __init__(self, message, field=None):
        super().__init__(message)
        self.field = field


class NotFoundError(HelpdeskError, KeyError):
    """Ticket inexistente."""

"""Exceções públicas do pacote."""


class StockflowError(Exception):
    """Base de todos os erros do stockflow."""


class InvalidEventError(StockflowError):
    """Evento malformado (campos ausentes, tipos errados, sequência < 1)."""

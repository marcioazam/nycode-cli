"""Exceções públicas do pacote."""


class StockflowError(Exception):
    """Base de todos os erros do stockflow."""


class InvalidEventError(StockflowError):
    """Evento malformado (campos ausentes, tipos errados, sequência < 1)."""


class ConflictingEventError(StockflowError):
    """Evento que contradiz um já aceito (mesmo id ou mesma sequência)."""


class SnapshotMismatchError(StockflowError):
    """O snapshot não descreve um prefixo deste log ou outras projeções."""


class InvalidSnapshotError(StockflowError, ValueError):
    """Snapshot serializado malformado."""

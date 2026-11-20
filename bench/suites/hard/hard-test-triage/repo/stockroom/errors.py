"""Erros do domínio."""


class StockroomError(Exception):
    """Base de todos os erros do pacote."""


class ValidationError(StockroomError):
    """Entrada inválida (formato, quantidade, configuração)."""


class NotFoundError(StockroomError):
    """SKU, depósito ou pedido desconhecido."""


class DuplicateError(StockroomError):
    """Cadastro repetido."""


class InsufficientStock(StockroomError):
    """Quantidade pedida maior que a disponível."""


class StateError(StockroomError):
    """Transição de estado não permitida."""

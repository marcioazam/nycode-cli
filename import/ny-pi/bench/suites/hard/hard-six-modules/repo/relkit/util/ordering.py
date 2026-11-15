"""Ordenação estável por várias chaves."""


def stable_sort(items, keys) -> list:
    """Ordena por ``keys`` = [(função_chave, decrescente), ...], da mais forte à mais fraca.

    Itens iguais em todas as chaves mantêm a ordem de entrada.
    """
    result = list(items)
    for key, descending in reversed(list(keys)):
        result.sort(key=key, reverse=descending)
    return result

"""Ordenação dos eventos de um agregado."""


def canonical_order(events):
    """Eventos de UM agregado em ordem de aplicação (por sequence)."""
    return sorted(events, key=lambda event: event.sequence)

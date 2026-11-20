"""Replay completo: relê todos os eventos e recalcula tudo."""

from ..events.ordering import canonical_order
from ..events.types import KNOWN_TYPES
from ..projections.registry import applicable_projections, default_projections


def initial_state(selected):
    return {projection.name: projection.initial() for projection in selected}


def fold_events(selected, state, events):
    """Aplica os eventos, na ordem recebida, ignorando tipos desconhecidos."""
    for event in events:
        if event.type not in KNOWN_TYPES:
            continue
        for projection in selected:
            projection.apply(state[projection.name], event)


def replay_aggregate(store, aggregate_id, projections=None):
    """Estado {nome_da_projeção: estado} de um agregado ({} se não há eventos)."""
    if projections is None:
        projections = default_projections()
    events = canonical_order(store.for_aggregate(aggregate_id))
    if not events:
        return {}
    selected = applicable_projections(projections, aggregate_id)
    state = initial_state(selected)
    fold_events(selected, state, events)
    return state


def replay_all(store, projections=None):
    """Estado {aggregate_id: {nome_da_projeção: estado}} de todo o log."""
    if projections is None:
        projections = default_projections()
    return {
        aggregate_id: replay_aggregate(store, aggregate_id, projections)
        for aggregate_id in store.aggregate_ids()
    }

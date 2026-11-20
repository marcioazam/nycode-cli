"""Replay completo: relê todos os eventos e recalcula tudo."""

from ..events.ordering import canonical_order
from ..events.types import KNOWN_TYPES
from ..projections.registry import applicable_projections, default_projections


def replay_aggregate(store, aggregate_id, projections=None):
    """Estado {nome_da_projeção: estado} de um agregado ({} se não há eventos)."""
    if projections is None:
        projections = default_projections()
    events = canonical_order(store.for_aggregate(aggregate_id))
    if not events:
        return {}
    selected = applicable_projections(projections, aggregate_id)
    state = {projection.name: projection.initial() for projection in selected}
    for event in events:
        if event.type not in KNOWN_TYPES:
            continue
        for projection in selected:
            projection.apply(state[projection.name], event)
    return state


def replay_all(store, projections=None):
    """Estado {aggregate_id: {nome_da_projeção: estado}} de todo o log."""
    if projections is None:
        projections = default_projections()
    return {
        aggregate_id: replay_aggregate(store, aggregate_id, projections)
        for aggregate_id in store.aggregate_ids()
    }

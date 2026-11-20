"""Snapshot e replay incremental, equivalentes ao replay completo."""

import copy

from ..errors import SnapshotMismatchError
from ..events.ordering import canonical_order
from ..projections.registry import applicable_projections, default_projections
from ..replay.full import fold_events, initial_state
from .model import AggregateSnapshot, Snapshot


def _check(store, snapshot, names):
    if snapshot.projections != names:
        raise SnapshotMismatchError("different projections")
    if snapshot.position > len(store):
        raise SnapshotMismatchError("snapshot is ahead of the log")
    if snapshot.position and (
        store.events_from(snapshot.position - 1)[0].event_id != snapshot.head_event_id
    ):
        raise SnapshotMismatchError("snapshot belongs to another log")


def update_snapshot(store, snapshot=None, projections=None):
    if projections is None:
        projections = default_projections()
    names = tuple(projection.name for projection in projections)
    if snapshot is None:
        snapshot = Snapshot(0, None, names, {})
    _check(store, snapshot, names)
    size = len(store)
    aggregates = {
        aggregate_id: AggregateSnapshot(copy.deepcopy(agg.state), agg.last_sequence)
        for aggregate_id, agg in snapshot.aggregates.items()
    }
    fresh = {}
    for event in store.events_from(snapshot.position):
        fresh.setdefault(event.aggregate_id, []).append(event)
    for aggregate_id, events in fresh.items():
        selected = applicable_projections(projections, aggregate_id)
        known = aggregates.get(aggregate_id)
        if known is not None and min(e.sequence for e in events) < known.last_sequence:
            events, known = store.for_aggregate(aggregate_id), None
        if known is None:
            state, last = initial_state(selected), 0
        else:
            state, last = known.state, known.last_sequence
        fold_events(selected, state, canonical_order(events))
        last = max([last] + [event.sequence for event in events])
        aggregates[aggregate_id] = AggregateSnapshot(state, last)
    head = store.events_from(size - 1)[0].event_id if size else None
    return Snapshot(size, head, names, dict(sorted(aggregates.items())))


def take_snapshot(store, projections=None):
    return update_snapshot(store, None, projections)


def snapshot_state(snapshot):
    return {
        aggregate_id: copy.deepcopy(agg.state)
        for aggregate_id, agg in snapshot.aggregates.items()
    }


def replay_from(store, snapshot, projections=None):
    return snapshot_state(update_snapshot(store, snapshot, projections))

"""Snapshots do estado e replay incremental."""

from .codec import snapshot_from_dict, snapshot_to_dict
from .incremental import replay_from, snapshot_state, take_snapshot, update_snapshot
from .model import AggregateSnapshot, Snapshot

__all__ = [
    "AggregateSnapshot",
    "Snapshot",
    "replay_from",
    "snapshot_from_dict",
    "snapshot_state",
    "snapshot_to_dict",
    "take_snapshot",
    "update_snapshot",
]

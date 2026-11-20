"""Modelo de snapshot."""

from dataclasses import dataclass


@dataclass(frozen=True)
class AggregateSnapshot:
    state: dict
    last_sequence: int


@dataclass(frozen=True)
class Snapshot:
    position: int
    head_event_id: "str | None"
    projections: tuple
    aggregates: dict

"""Conversão de eventos de/para dict (uma linha JSON por evento)."""

from ..errors import InvalidEventError
from .model import Event, validate_event

_FIELDS = ("event_id", "aggregate_id", "sequence", "timestamp", "type")


def event_to_dict(event):
    return {
        "event_id": event.event_id,
        "aggregate_id": event.aggregate_id,
        "sequence": event.sequence,
        "timestamp": event.timestamp,
        "type": event.type,
        "payload": dict(event.payload),
    }


def event_from_dict(data):
    if not isinstance(data, dict):
        raise InvalidEventError("event must be a JSON object")
    missing = [name for name in _FIELDS if name not in data]
    if missing:
        raise InvalidEventError("missing fields: " + ", ".join(missing))
    event = Event(
        event_id=data["event_id"],
        aggregate_id=data["aggregate_id"],
        sequence=data["sequence"],
        timestamp=data["timestamp"],
        type=data["type"],
        payload=data.get("payload", {}),
    )
    validate_event(event)
    return event

"""Construtores de eventos para os testes."""

from stockflow.events.model import Event


def ev(event_id, aggregate_id, sequence, type, payload=None, timestamp=None):
    return Event(
        event_id=event_id,
        aggregate_id=aggregate_id,
        sequence=sequence,
        timestamp=sequence if timestamp is None else timestamp,
        type=type,
        payload={} if payload is None else payload,
    )

"""Evento imutável do log."""

from dataclasses import dataclass, field

from ..errors import InvalidEventError


@dataclass(frozen=True)
class Event:
    """Um fato registrado sobre um agregado.

    aggregate_id tem a forma "<kind>:<chave>" (ex.: "sku:A1", "order:77").
    sequence é a posição do evento dentro do agregado e começa em 1.
    timestamp é um relógio lógico inteiro (não é usado para ordenar).
    """

    event_id: str
    aggregate_id: str
    sequence: int
    timestamp: int
    type: str
    payload: dict = field(default_factory=dict)

    @property
    def kind(self):
        return aggregate_kind(self.aggregate_id)


def aggregate_kind(aggregate_id):
    """Prefixo antes do primeiro ':' ("sku:A1" -> "sku")."""
    return aggregate_id.split(":", 1)[0]


def _is_int(value):
    return isinstance(value, int) and not isinstance(value, bool)


def validate_event(event):
    """Levanta InvalidEventError se o evento não puder entrar no log."""
    if not isinstance(event, Event):
        raise InvalidEventError("not an Event")
    if not isinstance(event.event_id, str) or not event.event_id:
        raise InvalidEventError("event_id must be a non-empty string")
    if not isinstance(event.aggregate_id, str) or ":" not in event.aggregate_id:
        raise InvalidEventError("aggregate_id must look like '<kind>:<key>'")
    if not _is_int(event.sequence) or event.sequence < 1:
        raise InvalidEventError("sequence must be an int >= 1")
    if not _is_int(event.timestamp) or event.timestamp < 0:
        raise InvalidEventError("timestamp must be an int >= 0")
    if not isinstance(event.type, str) or not event.type:
        raise InvalidEventError("type must be a non-empty string")
    if not isinstance(event.payload, dict):
        raise InvalidEventError("payload must be a dict")

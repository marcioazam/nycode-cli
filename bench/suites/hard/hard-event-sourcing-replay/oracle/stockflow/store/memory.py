"""Log de eventos em memória, idempotente."""

from ..errors import ConflictingEventError
from ..events.model import validate_event


class InMemoryEventStore:
    """Guarda os eventos na ordem de chegada, indexados por agregado."""

    def __init__(self):
        self._events = []
        self._by_aggregate = {}
        self._by_id = {}
        self._by_position = {}

    def append(self, event):
        validate_event(event)
        known = self._by_id.get(event.event_id)
        if known is not None:
            if known == event:
                return
            raise ConflictingEventError("event_id reused: " + event.event_id)
        slot = (event.aggregate_id, event.sequence)
        if slot in self._by_position:
            raise ConflictingEventError("sequence taken: %s#%d" % slot)  # noqa: UP031
        self._events.append(event)
        self._by_id[event.event_id] = event
        self._by_position[slot] = event.event_id
        self._by_aggregate.setdefault(event.aggregate_id, []).append(event)

    def extend(self, events):
        for event in events:
            self.append(event)

    def all(self):
        """Todos os eventos, na ordem de chegada."""
        return list(self._events)

    def events_from(self, position):
        """Eventos aceitos a partir do índice position, na ordem de chegada."""
        if isinstance(position, bool) or not isinstance(position, int):
            raise ValueError("position must be an int")  # noqa: TRY004
        if position < 0 or position > len(self._events):
            raise ValueError("position out of range: %d" % position)  # noqa: UP031
        return self._events[position:]

    def for_aggregate(self, aggregate_id):
        """Eventos de um agregado, na ordem de chegada ([] se não houver)."""
        return list(self._by_aggregate.get(aggregate_id, ()))

    def aggregate_ids(self):
        """Ids dos agregados com ao menos um evento, em ordem alfabética."""
        return sorted(self._by_aggregate)

    def __len__(self):
        return len(self._events)

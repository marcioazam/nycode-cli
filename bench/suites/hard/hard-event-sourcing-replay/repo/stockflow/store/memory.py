"""Log de eventos em memória."""

from ..events.model import validate_event


class InMemoryEventStore:
    """Guarda os eventos na ordem de chegada, indexados por agregado."""

    def __init__(self):
        self._events = []
        self._by_aggregate = {}

    def append(self, event):
        validate_event(event)
        self._events.append(event)
        self._by_aggregate.setdefault(event.aggregate_id, []).append(event)

    def extend(self, events):
        for event in events:
            self.append(event)

    def all(self):
        """Todos os eventos, na ordem de chegada."""
        return list(self._events)

    def for_aggregate(self, aggregate_id):
        """Eventos de um agregado, na ordem de chegada ([] se não houver)."""
        return list(self._by_aggregate.get(aggregate_id, ()))

    def aggregate_ids(self):
        """Ids dos agregados com ao menos um evento, em ordem alfabética."""
        return sorted(self._by_aggregate)

    def __len__(self):
        return len(self._events)

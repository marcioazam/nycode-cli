"""Último evento aplicado a um agregado."""

from ..base import Projection


class LastSeen(Projection):
    """Estado: {"timestamp": int, "event_id": str, "sequence": int}.

    timestamp é o maior já visto; event_id e sequence são do último evento
    aplicado.
    """

    name = "last_seen"
    kind = "*"

    def initial(self):
        return {"timestamp": 0, "event_id": "", "sequence": 0}

    def apply(self, state, event):
        state["timestamp"] = max(state["timestamp"], event.timestamp)
        state["event_id"] = event.event_id
        state["sequence"] = event.sequence

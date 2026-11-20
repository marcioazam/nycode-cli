"""Contagem de eventos aplicados por tipo."""

from ..base import Projection


class EventCounters(Projection):
    """Estado: {"events": int, "by_type": dict[str, int]}."""

    name = "counters"
    kind = "*"

    def initial(self):
        return {"events": 0, "by_type": {}}

    def apply(self, state, event):
        state["events"] += 1
        state["by_type"][event.type] = state["by_type"].get(event.type, 0) + 1

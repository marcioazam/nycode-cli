"""Máquina de estados de um pedido."""

from ...events import types
from ..base import Projection


class OrderStatus(Projection):
    """Estado: {"status": str, "flags": set[str]}.

    Transições fora de ordem são ignoradas e anotadas em flags como
    "ignored:<type>".
    """

    name = "status"
    kind = "order"

    def initial(self):
        return {"status": "new", "flags": set()}

    def apply(self, state, event):
        current = state["status"]
        if event.type == types.ORDER_PLACED:
            allowed, target = current == "new", "placed"
        elif event.type == types.ORDER_PAID:
            allowed, target = current == "placed", "paid"
        elif event.type == types.ORDER_SHIPPED:
            allowed, target = current == "paid", "shipped"
        elif event.type == types.ORDER_CANCELLED:
            allowed, target = current in ("placed", "paid"), "cancelled"
        else:
            return
        if allowed:
            state["status"] = target
        else:
            state["flags"].add("ignored:" + event.type)

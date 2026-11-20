"""Saldo físico e reservado de um SKU."""

from ...events import types
from ..base import Projection


class StockLevels(Projection):
    """Estado: {"on_hand": int, "reserved": int}."""

    name = "levels"
    kind = "sku"

    def initial(self):
        return {"on_hand": 0, "reserved": 0}

    def apply(self, state, event):
        payload = event.payload
        if event.type == types.STOCK_RECEIVED:
            state["on_hand"] += payload["qty"]
        elif event.type == types.STOCK_COUNTED:
            # Contagem física: substitui o saldo, não soma.
            state["on_hand"] = payload["qty"]
        elif event.type == types.STOCK_ADJUSTED:
            state["on_hand"] = max(0, state["on_hand"] + payload["delta"])
        elif event.type == types.STOCK_RESERVED:
            state["reserved"] += payload["qty"]
        elif event.type == types.STOCK_RELEASED:
            state["reserved"] = max(0, state["reserved"] - payload["qty"])
        elif event.type == types.STOCK_SHIPPED:
            state["on_hand"] = max(0, state["on_hand"] - payload["qty"])
            state["reserved"] = max(0, state["reserved"] - payload["qty"])

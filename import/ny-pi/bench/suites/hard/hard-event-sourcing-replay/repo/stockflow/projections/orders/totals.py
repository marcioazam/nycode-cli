"""Linhas e total de um pedido."""

from ...events import types
from ..base import Projection


class OrderTotals(Projection):
    """Estado: {"lines": dict[str, tuple[int, int]], "total_cents": int}.

    lines mapeia sku -> (qty, unit_cents).
    """

    name = "totals"
    kind = "order"

    def initial(self):
        return {"lines": {}, "total_cents": 0}

    def apply(self, state, event):
        payload = event.payload
        if event.type == types.ORDER_PLACED:
            state["lines"] = {
                line["sku"]: (line["qty"], line["unit_cents"])
                for line in payload["lines"]
            }
        elif event.type == types.ORDER_LINE_ADDED:
            state["lines"][payload["sku"]] = (payload["qty"], payload["unit_cents"])
        elif event.type == types.ORDER_LINE_REMOVED:
            state["lines"].pop(payload["sku"], None)
        else:
            return
        state["total_cents"] = sum(qty * unit for qty, unit in state["lines"].values())

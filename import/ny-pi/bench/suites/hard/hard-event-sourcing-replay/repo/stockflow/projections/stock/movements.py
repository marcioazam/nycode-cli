"""Últimas movimentações físicas de um SKU."""

from ...events import types
from ..base import Projection

HISTORY_SIZE = 5


def _signed_quantity(event):
    payload = event.payload
    if event.type in (types.STOCK_RECEIVED, types.STOCK_COUNTED):
        return payload["qty"]
    if event.type == types.STOCK_ADJUSTED:
        return payload["delta"]
    if event.type == types.STOCK_SHIPPED:
        return -payload["qty"]
    return None


class StockMovements(Projection):
    """Estado: {"count": int, "history": list[tuple[int, str, int]]}.

    history guarda (sequence, type, quantidade com sinal) das últimas
    HISTORY_SIZE movimentações; reservas e liberações não são movimentação.
    """

    name = "movements"
    kind = "sku"

    def initial(self):
        return {"count": 0, "history": []}

    def apply(self, state, event):
        quantity = _signed_quantity(event)
        if quantity is None:
            return
        state["count"] += 1
        state["history"].append((event.sequence, event.type, quantity))
        del state["history"][:-HISTORY_SIZE]

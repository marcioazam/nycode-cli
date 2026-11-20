"""Reservas abertas e encerradas de um SKU."""

from ...events import types
from ..base import Projection


class Reservations(Projection):
    """Estado: {"open": set[str], "closed": set[str]} (ids de reserva)."""

    name = "reservations"
    kind = "sku"

    def initial(self):
        return {"open": set(), "closed": set()}

    def apply(self, state, event):
        if event.type == types.STOCK_RESERVED:
            reservation = event.payload["reservation_id"]
            # Reserva já encerrada não reabre.
            if reservation not in state["closed"]:
                state["open"].add(reservation)
        elif event.type in (types.STOCK_RELEASED, types.STOCK_SHIPPED):
            reservation = event.payload["reservation_id"]
            state["open"].discard(reservation)
            state["closed"].add(reservation)

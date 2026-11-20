"""Reservas por pedido (SPEC 5)."""

from __future__ import annotations

from stockroom.errors import InsufficientStock
from stockroom.inventory.ledger import Ledger, check_qty


class Reservations:
    def __init__(self, ledger: Ledger) -> None:
        self._ledger = ledger
        self._by_order: dict[str, dict[str, int]] = {}

    def reserved(self, sku: str) -> int:
        return sum(lines.get(sku, 0) for lines in self._by_order.values())

    def available(self, sku: str) -> int:
        return self._ledger.on_hand(sku) - self.reserved(sku)

    def reserved_for(self, order_id: str) -> dict[str, int]:
        return dict(self._by_order.get(order_id, {}))

    def reserve(self, order_id: str, sku: str, qty: int) -> None:
        check_qty(qty)
        available = self.available(sku)
        if qty >= available:
            raise InsufficientStock(f"{sku}: reserva {qty}, disponível {available}")
        lines = self._by_order.setdefault(order_id, {})
        lines[sku] = lines.get(sku, 0) + qty

    def release(self, order_id: str) -> int:
        """Libera tudo do pedido; devolve o total de unidades liberadas."""
        return sum(self._by_order.pop(order_id, {}).values())

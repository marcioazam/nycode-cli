"""Pedido e seu ciclo de vida (SPEC 10)."""

from __future__ import annotations

from dataclasses import dataclass

from stockroom.errors import InsufficientStock, StateError, ValidationError
from stockroom.inventory.ledger import check_qty
from stockroom.inventory.lots import Pick
from stockroom.inventory.warehouse import Warehouse

DRAFT, CONFIRMED, SHIPPED, CANCELLED = "draft", "confirmed", "shipped", "cancelled"


@dataclass(frozen=True)
class OrderLine:
    sku: str
    qty: int


class Order:
    def __init__(self, order_id: str) -> None:
        self.id = order_id
        self.status = DRAFT
        self._lines: dict[str, int] = {}

    @property
    def lines(self) -> tuple[OrderLine, ...]:
        return tuple(OrderLine(sku, qty) for sku, qty in self._lines.items())

    def _require(self, *allowed: str) -> None:
        if self.status not in allowed:
            raise StateError(f"pedido {self.id} está {self.status}")

    def add_line(self, sku: str, qty: int) -> None:
        self._require(DRAFT)
        self._lines[sku] = self._lines.get(sku, 0) + check_qty(qty)

    def confirm(self, warehouse: Warehouse) -> None:
        """Reserva todas as linhas ou nenhuma."""
        self._require(DRAFT)
        if not self._lines:
            raise ValidationError("pedido sem linhas")
        for line in self.lines:
            if line.qty > warehouse.available(line.sku):
                raise InsufficientStock(f"{line.sku}: sem saldo para {line.qty}")
        for line in self.lines:
            warehouse.reservations.reserve(self.id, line.sku, line.qty)
        self.status = CONFIRMED

    def ship(self, warehouse: Warehouse) -> dict[str, list[Pick]]:
        self._require(CONFIRMED)
        warehouse.reservations.release(self.id)
        picks = {line.sku: warehouse.ship(line.sku, line.qty) for line in self.lines}
        self.status = SHIPPED
        return picks

    def cancel(self, warehouse: Warehouse) -> None:
        self._require(DRAFT, CONFIRMED)
        if self.status == CONFIRMED:
            warehouse.reservations.release(self.id)
        self.status = CANCELLED

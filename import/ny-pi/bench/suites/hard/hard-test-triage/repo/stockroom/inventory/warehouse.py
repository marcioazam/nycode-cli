"""Depósito: junta livro de movimentos, lotes e reservas."""

from __future__ import annotations

from stockroom.errors import InsufficientStock, ValidationError
from stockroom.inventory.ledger import Ledger, check_qty
from stockroom.inventory.lots import Lot, LotBook, Pick
from stockroom.inventory.reservations import Reservations


class Warehouse:
    def __init__(self, name: str) -> None:
        if not name.strip():
            raise ValidationError("nome de depósito vazio")
        self.name = name
        self.ledger = Ledger()
        self.lots = LotBook()
        self.reservations = Reservations(self.ledger)

    def receive(self, sku: str, qty: int, expiry: str | None = None) -> Lot:
        lot = self.lots.receive(sku, qty, expiry)
        self.ledger.receive(sku, qty)
        return lot

    def on_hand(self, sku: str) -> int:
        return self.ledger.on_hand(sku)

    def available(self, sku: str) -> int:
        return self.reservations.available(sku)

    def ship(self, sku: str, qty: int) -> list[Pick]:
        """Baixa `qty` do disponível e devolve os lotes consumidos."""
        check_qty(qty)
        if qty > self.available(sku):
            raise InsufficientStock(
                f"{sku}: saída {qty}, disponível {self.available(sku)}"
            )
        self.ledger.issue(sku, qty)
        return self.lots.consume(sku, qty)

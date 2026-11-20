"""Livro de movimentos (SPEC 3)."""

from __future__ import annotations

from stockroom.errors import InsufficientStock, ValidationError


def check_qty(qty: object) -> int:
    if isinstance(qty, bool) or not isinstance(qty, int) or qty <= 0:
        raise ValidationError("quantidade deve ser inteiro > 0")
    return qty


class Ledger:
    def __init__(self) -> None:
        self._moves: list[tuple[str, str, int]] = []
        self._on_hand: dict[str, int] = {}

    def receive(self, sku: str, qty: int) -> None:
        check_qty(qty)
        self._on_hand[sku] = self.on_hand(sku) + qty
        self._moves.append((sku, "receive", qty))

    def issue(self, sku: str, qty: int) -> None:
        check_qty(qty)
        if qty > self.on_hand(sku):
            raise InsufficientStock(f"{sku}: saída {qty} > saldo {self.on_hand(sku)}")
        self._on_hand[sku] -= qty
        self._moves.append((sku, "issue", qty))

    def on_hand(self, sku: str) -> int:
        return self._on_hand.get(sku, 0)

    def skus(self) -> list[str]:
        return sorted(self._on_hand)

    def history(self, sku: str) -> list[tuple[str, int]]:
        """Movimentos do SKU, na ordem em que aconteceram."""
        return [(kind, qty) for s, kind, qty in self._moves if s == sku]

"""A placed order: frozen lines and totals."""

from dataclasses import dataclass

from pricing.cart.line import CartLine
from pricing.cart.totals import Totals


@dataclass(frozen=True)
class Order:
    order_id: str
    lines: tuple[CartLine, ...]
    totals: Totals
    region: str

    @property
    def currency(self) -> str:
        return self.totals.currency

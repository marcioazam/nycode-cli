"""Running record of placed orders."""

from decimal import Decimal

from pricing.orders.order import Order


class Ledger:
    def __init__(self) -> None:
        self._orders: list[Order] = []

    def record(self, order: Order) -> None:
        self._orders.append(order)

    @property
    def orders(self) -> tuple[Order, ...]:
        return tuple(self._orders)

    def count(self) -> int:
        return len(self._orders)

    def total(self) -> Decimal:
        """Sum of the grand totals of every recorded order."""
        return sum((o.totals.grand_total for o in self._orders), Decimal("0.00"))

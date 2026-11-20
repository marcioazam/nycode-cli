"""Running record of placed orders, summed per currency."""

from datetime import date
from decimal import Decimal

from pricing.errors import CurrencyMismatchError
from pricing.money import Money, RateTable, convert
from pricing.orders.order import Order
from pricing.rounding import round_amount


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

    def totals_by_currency(self) -> dict[str, Decimal]:
        """Grand totals per currency, keys in ascending code order."""
        sums: dict[str, Decimal] = {}
        for order in self._orders:
            zero = round_amount(Decimal(0), order.currency)
            sums[order.currency] = (
                sums.get(order.currency, zero) + order.totals.grand_total
            )
        return dict(sorted(sums.items()))

    def total(self, currency: str | None = None) -> Decimal:
        """Sum of one currency; without a code the ledger must hold at most one."""
        sums = self.totals_by_currency()
        if currency is not None:
            return sums.get(currency, round_amount(Decimal(0), currency))
        if len(sums) > 1:
            raise CurrencyMismatchError(f"ledger holds {', '.join(sums)}")
        for value in sums.values():
            return value
        return Decimal("0.00")

    def total_in(self, currency: str, rates: RateTable, on: date) -> Decimal:
        """Convert each currency's sum once, then add the converted sums."""
        result = round_amount(Decimal(0), currency)
        for code, value in self.totals_by_currency().items():
            result += convert(Money(value, code), currency, rates, on).amount
        return result

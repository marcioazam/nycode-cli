"""Percentage discount."""

from decimal import Decimal

from pricing.discounts.base import Discount
from pricing.errors import InvalidAmountError
from pricing.rounding import round_amount, to_decimal


class PercentOff(Discount):
    def __init__(self, percent: object) -> None:
        self.percent = to_decimal(percent)
        if not 0 < self.percent <= 100:
            raise InvalidAmountError(f"percent out of range: {self.percent}")

    def amount(self, subtotal: Decimal) -> Decimal:
        return round_amount(subtotal * self.percent / 100)

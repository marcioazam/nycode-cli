"""Fixed amount discount."""

from decimal import Decimal

from pricing.discounts.base import Discount
from pricing.errors import InvalidAmountError
from pricing.rounding import check_precision, to_decimal


class FixedOff(Discount):
    def __init__(self, value: object) -> None:
        self.value = check_precision(to_decimal(value))
        if self.value <= 0:
            raise InvalidAmountError(f"discount must be positive: {self.value}")

    def amount(self, subtotal: Decimal) -> Decimal:
        return self.value

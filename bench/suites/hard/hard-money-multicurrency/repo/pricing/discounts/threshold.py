"""Fixed amount off once the amount payable reaches a minimum."""

from decimal import Decimal

from pricing.discounts.base import Discount
from pricing.errors import InvalidAmountError
from pricing.rounding import check_precision, to_decimal


class SpendThreshold(Discount):
    def __init__(self, min_subtotal: object, value: object) -> None:
        self.min_subtotal = check_precision(to_decimal(min_subtotal))
        self.value = check_precision(to_decimal(value))
        if self.min_subtotal < 0 or self.value <= 0:
            raise InvalidAmountError("threshold must be >= 0 and value > 0")

    def amount(self, subtotal: Decimal) -> Decimal:
        if subtotal >= self.min_subtotal:
            return self.value
        return Decimal("0.00")

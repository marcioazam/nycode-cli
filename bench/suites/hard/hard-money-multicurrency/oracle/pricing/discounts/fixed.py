"""Fixed amount discount, valid in one currency only."""

from decimal import Decimal

from pricing.discounts.base import Discount
from pricing.errors import CurrencyMismatchError, InvalidAmountError
from pricing.rounding import check_precision, to_decimal


class FixedOff(Discount):
    def __init__(self, value: object, currency: str = "USD") -> None:
        self.currency = currency
        self.value = check_precision(to_decimal(value), currency)
        if self.value <= 0:
            raise InvalidAmountError(f"discount must be positive: {self.value}")

    def amount(self, subtotal: Decimal, currency: str = "USD") -> Decimal:
        if currency != self.currency:
            raise CurrencyMismatchError(
                f"{self.currency} discount on {currency} amount"
            )
        return self.value

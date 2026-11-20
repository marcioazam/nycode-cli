"""Fixed amount off once the amount payable reaches a minimum."""

from decimal import Decimal

from pricing.discounts.base import Discount
from pricing.errors import CurrencyMismatchError, InvalidAmountError
from pricing.rounding import check_precision, round_amount, to_decimal


class SpendThreshold(Discount):
    def __init__(
        self, min_subtotal: object, value: object, currency: str = "USD"
    ) -> None:
        self.currency = currency
        self.min_subtotal = check_precision(to_decimal(min_subtotal), currency)
        self.value = check_precision(to_decimal(value), currency)
        if self.min_subtotal < 0 or self.value <= 0:
            raise InvalidAmountError("threshold must be >= 0 and value > 0")

    def amount(self, subtotal: Decimal, currency: str = "USD") -> Decimal:
        if currency != self.currency:
            raise CurrencyMismatchError(
                f"{self.currency} discount on {currency} amount"
            )
        if subtotal >= self.min_subtotal:
            return self.value
        return round_amount(Decimal(0), currency)

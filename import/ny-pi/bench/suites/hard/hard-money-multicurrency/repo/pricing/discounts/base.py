"""Discount interface."""

from decimal import Decimal


class Discount:
    """A rule that turns the amount still payable into a discount."""

    def amount(self, subtotal: Decimal) -> Decimal:
        raise NotImplementedError

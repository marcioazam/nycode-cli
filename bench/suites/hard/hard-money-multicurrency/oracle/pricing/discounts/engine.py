"""Combine discounts in the order given."""

from collections.abc import Iterable
from decimal import Decimal

from pricing.discounts.base import Discount


def total_discount(
    subtotal: Decimal, discounts: Iterable[Discount], currency: str = "USD"
) -> Decimal:
    """Each discount sees what is still payable; the sum never exceeds the subtotal."""
    remaining = subtotal
    for discount in discounts:
        cut = min(discount.amount(remaining, currency), remaining)
        remaining -= cut
    return subtotal - remaining

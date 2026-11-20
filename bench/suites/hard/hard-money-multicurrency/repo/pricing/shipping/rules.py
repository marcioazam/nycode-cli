"""Flat shipping, free from a minimum discounted amount on."""

from decimal import Decimal

from pricing import config


def shipping_cost(amount: Decimal) -> Decimal:
    """Nothing to pay ships free; so does anything at or above the threshold."""
    if amount == 0 or amount >= config.SHIPPING_FREE_ABOVE:
        return Decimal("0.00")
    return config.SHIPPING_FLAT

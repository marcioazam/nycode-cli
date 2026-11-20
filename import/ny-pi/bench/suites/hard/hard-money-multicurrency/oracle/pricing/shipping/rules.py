"""Flat shipping per currency, free from a minimum discounted amount on."""

from decimal import Decimal

from pricing import config
from pricing.errors import MissingRuleError
from pricing.money import get_currency
from pricing.rounding import round_amount


def shipping_cost(amount: Decimal, currency: str = "USD") -> Decimal:
    """Nothing to pay ships free; so does anything at or above the threshold."""
    get_currency(currency)
    if currency not in config.SHIPPING_RULES:
        raise MissingRuleError(f"no shipping rule for {currency}")
    flat, free_above = config.SHIPPING_RULES[currency]
    if amount == 0 or amount >= free_above:
        return round_amount(Decimal(0), currency)
    return flat

"""Decimal parsing and per-currency rounding shared by every layer."""

from decimal import Decimal

from pricing.errors import InvalidAmountError
from pricing.money.currency import get_currency
from pricing.parsing import to_decimal

__all__ = ["check_precision", "round_amount", "to_decimal"]


def round_amount(amount: Decimal, currency: str = "USD") -> Decimal:
    """Round with the exponent, mode and increment of the currency."""
    return get_currency(currency).round(amount)


def check_precision(amount: Decimal, currency: str = "USD") -> Decimal:
    """Reject amounts with more decimal places than the currency has."""
    quantum = get_currency(currency).quantum
    if amount != amount.quantize(quantum):
        raise InvalidAmountError(f"too many decimal places for {currency}: {amount}")
    return amount

"""Decimal parsing and rounding shared by every layer."""

from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from pricing.errors import InvalidAmountError

CENTS = Decimal("0.01")


def to_decimal(value: object) -> Decimal:
    """Parse a monetary input. Floats and bools are refused (TypeError)."""
    if isinstance(value, (bool, float)):
        raise TypeError(f"refusing imprecise amount: {value!r}")
    if isinstance(value, Decimal):
        result = value
    elif isinstance(value, (int, str)):
        try:
            result = Decimal(value)
        except InvalidOperation as exc:
            raise InvalidAmountError(f"not a number: {value!r}") from exc
    else:
        raise TypeError(f"unsupported amount type: {type(value).__name__}")
    if not result.is_finite():
        raise InvalidAmountError(f"not a finite number: {value!r}")
    return result


def round_amount(amount: Decimal) -> Decimal:
    """Round to cents, half up."""
    return amount.quantize(CENTS, rounding=ROUND_HALF_UP)


def check_precision(amount: Decimal) -> Decimal:
    """Reject amounts with more precision than cents."""
    if amount != round_amount(amount):
        raise InvalidAmountError(f"too many decimal places: {amount}")
    return amount

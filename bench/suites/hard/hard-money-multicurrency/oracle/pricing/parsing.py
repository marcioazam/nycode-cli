"""Decimal parsing of monetary inputs."""

from decimal import Decimal, InvalidOperation

from pricing.errors import InvalidAmountError


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

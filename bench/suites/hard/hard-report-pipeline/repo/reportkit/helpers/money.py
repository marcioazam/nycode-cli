"""Decimal helpers. Money never goes through float."""

from decimal import ROUND_HALF_UP, Decimal

CENT = Decimal("0.01")
TENTH = Decimal("0.1")
HUNDRED = Decimal(100)
ZERO = Decimal("0.00")


def round_half_up(value, step=CENT):
    """Round to a multiple of `step`; ties go away from zero."""
    return value.quantize(step, rounding=ROUND_HALF_UP)


def total(values):
    """Sum Decimals keeping two decimal places even for an empty input."""
    return sum(values, ZERO)


def plain(value, places=2):
    """Machine-readable number: no grouping, fixed decimals."""
    return f"{value:.{places}f}"


def grouped(value):
    """Human-readable money: thousands separator and two decimals."""
    return f"{value:,.2f}"

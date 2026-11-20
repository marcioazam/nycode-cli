"""Valores em centavos inteiros (SPEC 8)."""

from __future__ import annotations

from stockroom.errors import ValidationError


def check_cents(value: object, what: str = "valor") -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValidationError(f"{what} deve ser inteiro de centavos >= 0")
    return value


def percent_of(amount: int, percent: int) -> int:
    """`percent`% de `amount`, em centavos inteiros; meio centavo sobe."""
    check_cents(amount)
    if not 0 <= percent <= 100:
        raise ValidationError("percentual fora de 0..100")
    return (amount * percent + 50) // 100


def format_cents(value: int) -> str:
    """1234 -> '12.34'."""
    check_cents(value)
    return f"{value // 100}.{value % 100:02d}"

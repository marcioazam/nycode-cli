"""Arredondamento decimal usado por todos os cálculos monetários."""

from decimal import ROUND_DOWN, ROUND_HALF_EVEN, ROUND_HALF_UP, Decimal

_MODES = {
    "half-up": ROUND_HALF_UP,
    "half-even": ROUND_HALF_EVEN,
    "down": ROUND_DOWN,
}


def quantize(value: Decimal, exponent: int = 2, mode: str = "half_up") -> Decimal:
    """Arredonda `value` para `exponent` casas usando o modo nomeado."""
    rounding = _MODES.get(mode, ROUND_HALF_EVEN)
    step = Decimal(1).scaleb(-exponent)
    return Decimal(value).quantize(step, rounding=rounding)


def unit(exponent: int) -> Decimal:
    """Menor unidade representável com `exponent` casas."""
    return Decimal(1).scaleb(-exponent)

"""Arredondamento decimal usado por todos os cálculos monetários."""

from decimal import ROUND_DOWN, ROUND_HALF_EVEN, ROUND_HALF_UP, Decimal

_MODES = {
    "half_up": ROUND_HALF_UP,
    "half_even": ROUND_HALF_EVEN,
    "down": ROUND_DOWN,
}


def quantize(value: Decimal, exponent: int = 2, mode: str = "half_up") -> Decimal:
    """Arredonda `value` para `exponent` casas usando o modo nomeado."""
    try:
        rounding = _MODES[mode.strip().lower().replace("-", "_")]
    except (KeyError, AttributeError):
        raise ValueError(f"modo de arredondamento desconhecido: {mode!r}") from None
    step = Decimal(1).scaleb(-exponent)
    return Decimal(value).quantize(step, rounding=rounding)


def unit(exponent: int) -> Decimal:
    """Menor unidade representável com `exponent` casas."""
    return Decimal(1).scaleb(-exponent)

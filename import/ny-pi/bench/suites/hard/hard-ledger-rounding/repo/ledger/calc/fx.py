"""Conversão cambial."""

from decimal import Decimal

from ledger.config.defaults import FX_MODE
from ledger.model.currency import exponent
from ledger.util.numeric import quantize


class Rates:
    def __init__(self, table: dict[tuple[str, str], Decimal]) -> None:
        self._table = dict(table)

    def get(self, src: str, dst: str) -> Decimal:
        if src == dst:
            return Decimal(1)
        try:
            return self._table[(src, dst)]
        except KeyError:
            raise ValueError(f"taxa ausente: {src}->{dst}") from None


def precise(amount: Decimal, src: str, dst: str, rates: Rates) -> Decimal:
    """Valor convertido sem arredondar."""
    return amount * rates.get(src, dst)


def convert(amount: Decimal, src: str, dst: str, rates: Rates) -> Decimal:
    if src == dst:
        return amount
    return quantize(precise(amount, src, dst, rates), exponent(dst), FX_MODE)

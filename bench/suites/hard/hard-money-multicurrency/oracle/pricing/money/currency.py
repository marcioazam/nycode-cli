"""Supported currencies and their rounding rules."""

from dataclasses import dataclass
from decimal import ROUND_DOWN, ROUND_HALF_EVEN, ROUND_HALF_UP, Decimal

from pricing.errors import UnknownCurrencyError


@dataclass(frozen=True)
class Currency:
    code: str
    exponent: int
    rounding: str
    increment: Decimal | None = None

    @property
    def quantum(self) -> Decimal:
        return Decimal(1).scaleb(-self.exponent)

    def round(self, amount: Decimal) -> Decimal:
        if self.increment is not None:
            steps = (amount / self.increment).quantize(
                Decimal(1), rounding=self.rounding
            )
            amount = steps * self.increment
        return amount.quantize(self.quantum, rounding=self.rounding)


_CURRENCIES = {
    c.code: c
    for c in (
        Currency("USD", 2, ROUND_HALF_UP),
        Currency("BRL", 2, ROUND_HALF_UP),
        Currency("EUR", 2, ROUND_HALF_EVEN),
        Currency("JPY", 0, ROUND_DOWN),
        Currency("KWD", 3, ROUND_HALF_UP),
        Currency("CHF", 2, ROUND_HALF_UP, Decimal("0.05")),
    )
}


def get_currency(code: object) -> Currency:
    """Exact, case-sensitive lookup."""
    if not isinstance(code, str) or code not in _CURRENCIES:
        raise UnknownCurrencyError(f"unknown currency: {code!r}")
    return _CURRENCIES[code]

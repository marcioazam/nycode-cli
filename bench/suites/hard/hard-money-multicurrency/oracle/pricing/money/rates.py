"""Dated exchange rates and conversion."""

from datetime import date
from decimal import Decimal

from pricing.errors import InvalidRateError, RateNotFoundError
from pricing.money.currency import get_currency
from pricing.money.money import Money
from pricing.parsing import to_decimal


class RateTable:
    def __init__(self) -> None:
        self._rates: dict[tuple[str, str], dict[date, Decimal]] = {}

    def add_rate(self, base: str, quote: str, rate: object, on: date) -> None:
        """1 unit of base is worth `rate` units of quote from `on` onwards."""
        get_currency(base)
        get_currency(quote)
        value = to_decimal(rate)
        if base == quote or value <= 0:
            raise InvalidRateError(f"bad rate {base}->{quote}: {value}")
        self._rates.setdefault((base, quote), {})[on] = value

    def _latest(self, base: str, quote: str, on: date) -> Decimal | None:
        dated = self._rates.get((base, quote), {})
        usable = [day for day in dated if day <= on]
        return dated[max(usable)] if usable else None

    def rate_for(self, base: str, quote: str, on: date) -> Decimal:
        get_currency(base)
        get_currency(quote)
        if base == quote:
            return Decimal(1)
        direct = self._latest(base, quote, on)
        if direct is not None:
            return direct
        inverse = self._latest(quote, base, on)
        if inverse is not None:
            return Decimal(1) / inverse
        raise RateNotFoundError(f"no rate {base}->{quote} on {on}")


def convert(money: Money, to: str, rates: RateTable, on: date) -> Money:
    """Convert and round with the rules of the target currency."""
    target = get_currency(to)
    if money.currency == to:
        return money
    rate = rates.rate_for(money.currency, to, on)
    return Money(target.round(money.amount * rate), to)

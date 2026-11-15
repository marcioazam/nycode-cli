"""Money: an exact amount tied to a currency."""

from dataclasses import dataclass
from decimal import Decimal

from pricing.errors import CurrencyMismatchError
from pricing.money.currency import get_currency
from pricing.parsing import to_decimal


@dataclass(frozen=True, eq=False)
class Money:
    amount: Decimal
    currency: str

    def __post_init__(self) -> None:
        get_currency(self.currency)
        object.__setattr__(self, "amount", to_decimal(self.amount))

    @classmethod
    def zero(cls, currency: str) -> "Money":
        return cls(Decimal(0), currency)

    def rounded(self) -> "Money":
        return Money(get_currency(self.currency).round(self.amount), self.currency)

    def _same(self, other: object) -> "Money":
        if not isinstance(other, Money):
            raise TypeError(f"expected Money, got {type(other).__name__}")
        if other.currency != self.currency:
            raise CurrencyMismatchError(f"{self.currency} vs {other.currency}")
        return other

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, Money):
            return NotImplemented
        return self.currency == other.currency and self.amount == other.amount

    def __hash__(self) -> int:
        return hash((self.amount, self.currency))

    def __add__(self, other: object) -> "Money":
        return Money(self.amount + self._same(other).amount, self.currency)

    def __radd__(self, other: object) -> "Money":
        # sum() starts from the integer 0.
        if type(other) is int and other == 0:
            return self
        return self.__add__(other)

    def __sub__(self, other: object) -> "Money":
        return Money(self.amount - self._same(other).amount, self.currency)

    def __neg__(self) -> "Money":
        return Money(-self.amount, self.currency)

    def __mul__(self, factor: object) -> "Money":
        if isinstance(factor, bool) or not isinstance(factor, (int, Decimal)):
            raise TypeError(f"cannot multiply Money by {type(factor).__name__}")
        return Money(self.amount * factor, self.currency)

    __rmul__ = __mul__

    def __lt__(self, other: object) -> bool:
        return self.amount < self._same(other).amount

    def __le__(self, other: object) -> bool:
        return self.amount <= self._same(other).amount

    def __gt__(self, other: object) -> bool:
        return self.amount > self._same(other).amount

    def __ge__(self, other: object) -> bool:
        return self.amount >= self._same(other).amount

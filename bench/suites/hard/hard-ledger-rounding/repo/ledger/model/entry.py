"""Lançamento contábil."""

from dataclasses import dataclass
from decimal import Decimal

KINDS = ("sale", "refund", "fee", "interest")


@dataclass(frozen=True)
class Entry:
    id: str
    account: str
    kind: str
    amount: Decimal
    currency: str
    date: str
    tax_rate: Decimal = Decimal(0)
    memo: str = ""

    def __post_init__(self) -> None:
        if self.kind not in KINDS:
            raise ValueError(f"tipo inválido: {self.kind!r}")
        if not isinstance(self.amount, Decimal):
            raise TypeError("amount deve ser Decimal")

    @property
    def taxable(self) -> bool:
        return self.kind in ("sale", "refund")

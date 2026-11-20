"""Monta as linhas do relatório a partir do diário."""

from dataclasses import dataclass
from decimal import Decimal

from ledger.calc import fx
from ledger.calc.tax import tax_for
from ledger.model.journal import Journal


@dataclass(frozen=True)
class Line:
    entry_id: str
    kind: str
    net: Decimal
    tax: Decimal
    gross: Decimal
    precise_net: Decimal
    precise_tax: Decimal


def build(journal: Journal, rates: fx.Rates, target: str) -> list[Line]:
    lines = []
    for e in journal:
        net = fx.convert(e.amount, e.currency, target, rates)
        precise_net = fx.precise(e.amount, e.currency, target, rates)
        rate = e.tax_rate if e.taxable else Decimal(0)
        tax = tax_for(net, rate, target)
        lines.append(Line(e.id, e.kind, net, tax, net + tax, precise_net, net * rate))
    return lines

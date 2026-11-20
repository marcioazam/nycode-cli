"""Totais do relatório."""

from dataclasses import dataclass
from decimal import Decimal

from ledger.report.builder import Line


@dataclass(frozen=True)
class Totals:
    net: Decimal
    tax: Decimal
    gross: Decimal


def totals(lines: list[Line], currency: str) -> Totals:
    net = sum((l.net for l in lines), Decimal(0))
    tax = sum((l.tax for l in lines), Decimal(0))
    return Totals(net, tax, net + tax)

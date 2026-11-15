"""Totais do relatório."""

from dataclasses import dataclass
from decimal import Decimal

from ledger.model.currency import exponent
from ledger.report.builder import Line
from ledger.util.numeric import quantize


@dataclass(frozen=True)
class Totals:
    net: Decimal
    tax: Decimal
    gross: Decimal


def totals(lines: list[Line], currency: str) -> Totals:
    exp = exponent(currency)
    net = quantize(sum((l.precise_net for l in lines), Decimal(0)), exp, "half_up")
    tax = quantize(sum((l.precise_tax for l in lines), Decimal(0)), exp, "half_up")
    return Totals(net, tax, net + tax)

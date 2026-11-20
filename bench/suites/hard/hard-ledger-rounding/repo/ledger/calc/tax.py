"""Imposto sobre lançamentos tributáveis."""

from decimal import Decimal

from ledger.config.defaults import TAX_MODE
from ledger.model.currency import exponent
from ledger.util.numeric import quantize


def tax_for(net: Decimal, rate: Decimal, currency: str) -> Decimal:
    return quantize(net * rate, exponent(currency), TAX_MODE)

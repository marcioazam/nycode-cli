"""Juros simples sobre saldo."""

from decimal import Decimal

from ledger.config.defaults import INTEREST_MODE
from ledger.model.currency import exponent
from ledger.util.numeric import quantize


def accrue(
    principal: Decimal, annual_rate: Decimal, days: int, currency: str
) -> Decimal:
    raw = principal * annual_rate * days / Decimal(365)
    return quantize(raw, exponent(currency), INTEREST_MODE)

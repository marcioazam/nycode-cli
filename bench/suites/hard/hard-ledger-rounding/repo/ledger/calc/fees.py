"""Taxa de processamento."""

from decimal import Decimal

from ledger.config.defaults import FEE_MODE, FEE_RATE
from ledger.model.currency import exponent
from ledger.util.numeric import quantize


def fee_for(amount: Decimal, currency: str) -> Decimal:
    return quantize(abs(amount) * FEE_RATE, exponent(currency), FEE_MODE)

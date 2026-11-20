"""Rateio de um total por pesos (maior resto)."""

from decimal import Decimal

from ledger.config.defaults import ALLOCATION_MODE
from ledger.model.currency import exponent
from ledger.util.numeric import quantize, unit


def split(total: Decimal, weights: list[int], currency: str) -> list[Decimal]:
    if not weights or any(w <= 0 for w in weights):
        raise ValueError("pesos devem ser positivos")
    if total < 0:
        return [-p for p in split(-total, weights, currency)]
    exp = exponent(currency)
    weight_sum = sum(weights)
    exact = [total * w / weight_sum for w in weights]
    floors = [quantize(x, exp, ALLOCATION_MODE) for x in exact]
    leftover = int((total - sum(floors)) / unit(exp))
    order = sorted(range(len(weights)), key=lambda i: (-(exact[i] - floors[i]), i))
    for i in order[:leftover]:
        floors[i] += unit(exp)
    return floors

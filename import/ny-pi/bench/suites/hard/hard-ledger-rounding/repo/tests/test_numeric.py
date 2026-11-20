from decimal import Decimal as D

from ledger.model.currency import exponent
from ledger.util.numeric import quantize, unit


def test_quantize_basic():
    assert quantize(D("1.234")) == D("1.23")
    assert quantize(D("1.236")) == D("1.24")


def test_quantize_down():
    assert quantize(D("1.239"), 2, "down") == D("1.23")


def test_unit_and_exponent():
    assert unit(3) == D("0.001")
    assert exponent("JPY") == 0

from decimal import Decimal as D

import pytest
from ledger.util.numeric import quantize


def test_half_up_names():
    for name in ["half_up", "HALF_UP", "half-up", "Half_Up"]:
        assert quantize(D("0.125"), 2, name) == D("0.13")
        assert quantize(D("2.675"), 2, name) == D("2.68")


def test_half_up_negative_and_default():
    assert quantize(D("-0.125"), 2, "half_up") == D("-0.13")
    assert quantize(D("0.125"), 2, "half_up") == D("0.13")


def test_half_even_names():
    for name in ["half_even", "HALF-EVEN"]:
        assert quantize(D("0.125"), 2, name) == D("0.12")
        assert quantize(D("0.135"), 2, name) == D("0.14")


def test_down_toward_zero():
    assert quantize(D("-1.999"), 2, "down") == D("-1.99")


def test_unknown_mode_raises():
    with pytest.raises(ValueError):
        quantize(D("1.005"), 2, "half_sideways")


def test_other_exponents():
    assert quantize(D("2.5"), 0, "half_up") == D(3)
    assert quantize(D("1.0005"), 3, "half_up") == D("1.001")

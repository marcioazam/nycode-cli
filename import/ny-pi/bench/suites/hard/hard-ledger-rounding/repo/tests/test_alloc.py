from decimal import Decimal as D

import pytest
from ledger.calc.allocation import split


def test_split_even():
    assert split(D("100.00"), [1, 1, 2], "EUR") == [D("25.00"), D("25.00"), D("50.00")]


def test_split_remainder_goes_first():
    assert split(D("0.10"), [1, 1, 1], "EUR") == [D("0.04"), D("0.03"), D("0.03")]


def test_split_bad_weights():
    with pytest.raises(ValueError):
        split(D(1), [], "EUR")

from decimal import Decimal as D

from ledger.calc.fees import fee_for
from ledger.calc.tax import tax_for


def test_tax_plain():
    assert tax_for(D("100.00"), D("0.10"), "EUR") == D("10.00")


def test_tax_rounds_non_tie():
    assert tax_for(D("33.33"), D("0.07"), "EUR") == D("2.33")


def test_fee():
    assert fee_for(D("-200.00"), "USD") == D("2.50")

from decimal import Decimal as D

from ledger.calc.interest import accrue


def test_accrue_exact():
    assert accrue(D(1000), D("0.05"), 73, "EUR") == D("10.00")


def test_accrue_non_tie():
    assert accrue(D(1000), D("0.05"), 10, "EUR") == D("1.37")

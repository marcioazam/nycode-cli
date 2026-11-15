from decimal import Decimal as D

from ledger.calc.allocation import split
from ledger.calc.fees import fee_for
from ledger.calc.fx import Rates, convert
from ledger.calc.interest import accrue
from ledger.calc.tax import tax_for


def test_tax_tie_rounds_up():
    assert tax_for(D("10.50"), D("0.05"), "EUR") == D("0.53")


def test_tax_refund_symmetric():
    assert tax_for(D("-10.50"), D("0.05"), "EUR") == D("-0.53")
    assert tax_for(D(25), D("0.10"), "JPY") == D(3)


def test_fx_tie_rounds_up():
    rates = Rates({("USD", "EUR"): D("0.5")})
    assert convert(D("1.25"), "USD", "EUR", rates) == D("0.63")
    assert convert(D("-1.25"), "USD", "EUR", rates) == D("-0.63")


def test_fx_kwd_three_places():
    rates = Rates({("USD", "KWD"): D("0.3")})
    assert convert(D("1.0015"), "USD", "KWD", rates) == D("0.300")


def test_interest_still_half_even():
    assert accrue(D(730), D("0.0025"), 1, "EUR") == D("0.00")
    assert accrue(D(730), D("0.0025"), 5, "EUR") == D("0.02")
    assert accrue(D(730), D("0.0025"), 7, "EUR") == D("0.04")


def test_fee_tie_stays_half_up():
    assert fee_for(D("10.00"), "EUR") == D("0.13")


def test_split_largest_remainder():
    assert split(D("100.00"), [1, 1, 1], "EUR") == [D("33.34"), D("33.33"), D("33.33")]
    assert split(D("0.05"), [1, 1, 1], "EUR") == [D("0.02"), D("0.02"), D("0.01")]


def test_split_sum_invariant_and_jpy():
    parts = split(D(100), [1, 1, 1], "JPY")
    assert parts == [D(34), D(33), D(33)] and sum(parts) == D(100)
    assert sum(split(D("1.01"), [3, 3, 1], "EUR")) == D("1.01")


def test_split_negative():
    assert split(D("-100.00"), [1, 1, 1], "EUR") == [
        D("-33.34"),
        D("-33.33"),
        D("-33.33"),
    ]

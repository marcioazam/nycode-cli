from datetime import date
from decimal import Decimal as D

import pytest
from pricing.errors import (
    CurrencyMismatchError,
    InvalidAmountError,
    InvalidRateError,
    PricingError,
    RateNotFoundError,
    UnknownCurrencyError,
)
from pricing.money import Currency, Money, RateTable, convert, get_currency
from pricing.rounding import check_precision, round_amount

D1, D2, D3 = date(2024, 1, 1), date(2024, 2, 1), date(2024, 3, 1)


def test_error_classes():
    assert issubclass(UnknownCurrencyError, PricingError)
    assert issubclass(CurrencyMismatchError, PricingError)
    assert issubclass(InvalidRateError, (PricingError, ValueError))
    assert issubclass(RateNotFoundError, PricingError)


def test_r1_table_and_rounding():
    cur = get_currency("EUR")
    assert isinstance(cur, Currency) and (cur.code, cur.exponent) == ("EUR", 2)
    assert get_currency("JPY").exponent == 0 and get_currency("KWD").exponent == 3
    assert get_currency("CHF").increment == D("0.05")
    cases = [
        ("EUR", "2.665", "2.66"),
        ("EUR", "2.675", "2.68"),
        ("USD", "2.675", "2.68"),
        ("BRL", "0.005", "0.01"),
        ("JPY", "1234.99", "1234"),
        ("JPY", "-1.9", "-1"),
        ("KWD", "1.2345", "1.235"),
        ("CHF", "10.02", "10.00"),
        ("CHF", "10.025", "10.05"),
        ("CHF", "10.07", "10.05"),
    ]
    for code, raw, want in cases:
        got = get_currency(code).round(D(raw))
        assert (
            got == D(want) and got.as_tuple().exponent == D(want).as_tuple().exponent
        ), (code, raw)


def test_r1_unknown_currency_everywhere():
    for bad in ("usd", "XXX", "", None, 5):
        with pytest.raises(UnknownCurrencyError):
            get_currency(bad)
    with pytest.raises(UnknownCurrencyError):
        Money("1", "xxx")
    with pytest.raises(UnknownCurrencyError):
        RateTable().add_rate("USD", "ZZZ", "2", D1)
    with pytest.raises(UnknownCurrencyError):
        RateTable().rate_for("ZZZ", "USD", D1)
    with pytest.raises(UnknownCurrencyError):
        round_amount(D(1), "ABC")


def test_r2_r3_rounding_and_precision():
    assert round_amount(D("2.675")) == D("2.68")
    assert round_amount(D("2.665"), "EUR") == D("2.66")
    assert str(round_amount(D("7.9"), "JPY")) == "7"
    assert str(round_amount(D(1), "KWD")) == "1.000"
    assert check_precision(D("1.234"), "KWD") == D("1.234")
    assert check_precision(D("1.10")) == D("1.10")
    with pytest.raises(InvalidAmountError):
        check_precision(D("100.5"), "JPY")
    with pytest.raises(InvalidAmountError):
        check_precision(D("1.001"))
    assert check_precision(D("1.03"), "CHF") == D("1.03")


def test_r4_money_construction():
    m = Money("1.005", "USD")
    assert m.amount == D("1.005") and m.currency == "USD"
    with pytest.raises(AttributeError):
        m.amount = D(1)
    for bad in (1.5, True):
        with pytest.raises(TypeError):
            Money(bad, "USD")
    with pytest.raises(InvalidAmountError):
        Money("abc", "USD")
    assert Money.zero("JPY") == Money(0, "JPY")
    assert Money("2.665", "EUR").rounded() == Money("2.66", "EUR")


def test_r5_arithmetic():
    a, b = Money("1.10", "EUR"), Money("2.25", "EUR")
    assert (
        a + b == Money("3.35", "EUR")
        and b - a == Money("1.15", "EUR")
        and -a == Money("-1.10", "EUR")
    )
    assert sum([a, b, a]) == Money("4.45", "EUR")
    assert (a * 3) == (3 * a) == Money("3.30", "EUR") and a * D("0.5") == Money(
        "0.55", "EUR"
    )
    with pytest.raises(CurrencyMismatchError):
        a + Money("1", "USD")
    with pytest.raises(CurrencyMismatchError):
        a - Money("1", "USD")
    with pytest.raises(TypeError):
        a + 1
    for bad in (1.5, True, a, "2"):
        with pytest.raises(TypeError):
            a * bad


def test_r6_equality_and_order():
    assert Money("1.0", "USD") == Money("1.00", "USD")
    assert hash(Money("1.0", "USD")) == hash(Money("1.00", "USD"))
    assert Money("1", "USD") != Money("1", "EUR") and Money("1", "USD") != 1
    assert Money("1", "USD") < Money("2", "USD") <= Money("2", "USD") and Money(
        "3", "USD"
    ) > Money("2", "USD")
    assert Money("2", "USD") >= Money("2", "USD")
    with pytest.raises(CurrencyMismatchError):
        Money("1", "USD") < Money("2", "EUR")  # noqa: B015
    with pytest.raises(TypeError):
        Money("1", "USD") >= 3  # noqa: B015


def test_r8_add_rate_rejections():
    t = RateTable()
    for base, quote, rate in (
        ("USD", "USD", "1"),
        ("USD", "EUR", "0"),
        ("USD", "EUR", "-2"),
    ):
        with pytest.raises(InvalidRateError):
            t.add_rate(base, quote, rate, D1)
    with pytest.raises(TypeError):
        t.add_rate("USD", "EUR", 0.9, D1)
    t.add_rate("USD", "EUR", "0.9", D1)
    t.add_rate("USD", "EUR", "0.8", D1)
    assert t.rate_for("USD", "EUR", D1) == D("0.8")


def test_r9_rate_lookup():
    t = RateTable()
    t.add_rate("USD", "BRL", "5.00", D2)
    t.add_rate("USD", "BRL", "5.50", D3)
    assert t.rate_for("USD", "USD", D1) == 1
    with pytest.raises(RateNotFoundError):
        t.rate_for("USD", "BRL", D1)
    assert t.rate_for("USD", "BRL", D2) == D("5.00")
    assert t.rate_for("USD", "BRL", date(2024, 2, 20)) == D("5.00")
    assert t.rate_for("USD", "BRL", date(2030, 1, 1)) == D("5.50")
    assert t.rate_for("BRL", "USD", D2) == D(1) / D("5.00")
    t.add_rate("BRL", "USD", "0.19", D3)
    assert t.rate_for("USD", "BRL", D3) == D(
        "5.50"
    )  # direta vence a inversa mais recente
    t.add_rate("EUR", "BRL", "6", D1)
    with pytest.raises(RateNotFoundError):
        t.rate_for("USD", "EUR", D3)  # sem triangulação


def test_r10_convert():
    t = RateTable()
    t.add_rate("USD", "JPY", "151.37", D1)
    t.add_rate("USD", "EUR", "0.9", D1)
    t.add_rate("USD", "CHF", "0.8812", D1)
    t.add_rate("USD", "KWD", "0.3071", D1)
    ten = Money("10.99", "USD")
    assert convert(ten, "JPY", t, D1) == Money("1663", "JPY")  # 1663.5163 para zero
    assert convert(Money("0.05", "USD"), "EUR", t, D1) == Money(
        "0.04", "EUR"
    )  # 0.045 meio-par
    assert convert(Money("0.15", "USD"), "EUR", t, D1) == Money(
        "0.14", "EUR"
    )  # 0.135 meio-par
    assert convert(ten, "CHF", t, D1) == Money("9.70", "CHF")  # 9.684 -> 9.70
    assert convert(ten, "KWD", t, D1) == Money("3.375", "KWD")
    back = convert(Money("100", "EUR"), "USD", t, D1)
    assert back == Money("111.11", "USD")
    same = Money("1.005", "USD")
    assert convert(same, "USD", t, D1) is same
    with pytest.raises(UnknownCurrencyError):
        convert(same, "XXX", t, D1)
    with pytest.raises(RateNotFoundError):
        convert(same, "BRL", t, D1)
    with pytest.raises(RateNotFoundError):
        convert(same, "EUR", t, date(2023, 12, 31))

import pytest
from relkit.core.money import (
    add,
    apply_rate,
    convert,
    format_money,
    parse_money,
    split_money,
    sum_money,
)
from relkit.errors import ParseError
from relkit.types import Money


def test_parse_money_formas():
    casos = {
        "USD 12.34": Money(1234, "USD"),
        "12.34 USD": Money(1234, "USD"),
        "USD 12.5": Money(1250, "USD"),
        "USD 12": Money(1200, "USD"),
        "USD -5.00": Money(-500, "USD"),
        "JPY 1,500": Money(1500, "JPY"),
        "KWD 1.5": Money(1500, "KWD"),
        "1,234,567.89 EUR": Money(123456789, "EUR"),
        "BRL 0.05": Money(5, "BRL"),
        "USD -0": Money(0, "USD"),
    }
    for texto, esperado in casos.items():
        assert parse_money(texto) == esperado, texto


def test_parse_money_erros():
    esperado = {
        "USD": "expected 'CODE amount' or 'amount CODE'",
        "USD 1 2": "expected 'CODE amount' or 'amount CODE'",
        "usd 1": "unknown currency",
        "XXX 1": "unknown currency",
        "USD 1.234": "too many decimals",
        "JPY 1.5": "too many decimals",
        "USD 1,23": "bad amount",
        "USD 1234,567": "bad amount",
        "USD 1.": "bad amount",
        "USD .5": "bad amount",
        "USD abc": "bad amount",
        "USD --1": "bad amount",
        "USD +1": "bad amount",
        "USD 1e3": "bad amount",
    }
    for texto, motivo in esperado.items():
        with pytest.raises(ParseError) as info:
            parse_money(texto)
        assert (info.value.kind, info.value.reason) == ("money", motivo), texto


def test_format_money():
    casos = [
        (Money(123450, "USD"), "USD 1,234.50"),
        (Money(-500, "USD"), "USD -5.00"),
        (Money(1500, "JPY"), "JPY 1,500"),
        (Money(5, "KWD"), "KWD 0.005"),
        (Money(0, "EUR"), "EUR 0.00"),
        (Money(-5, "BRL"), "BRL -0.05"),
        (Money(100000000, "USD"), "USD 1,000,000.00"),
        (Money(-1234567, "JPY"), "JPY -1,234,567"),
    ]
    for dinheiro, texto in casos:
        assert format_money(dinheiro) == texto
        assert parse_money(texto) == dinheiro


def test_split_money():
    assert split_money(Money(100, "USD"), [1, 1, 1]) == [
        Money(34, "USD"),
        Money(33, "USD"),
        Money(33, "USD"),
    ]
    assert split_money(Money(-100, "USD"), [1, 1, 1]) == [
        Money(-34, "USD"),
        Money(-33, "USD"),
        Money(-33, "USD"),
    ]
    assert [m.units for m in split_money(Money(10, "JPY"), [1, 2, 3, 0])] == [
        2,
        3,
        5,
        0,
    ]
    assert [m.units for m in split_money(Money(5, "USD"), [1, 1, 1, 1])] == [2, 1, 1, 1]
    assert [m.units for m in split_money(Money(7, "USD"), [0, 3, 3])] == [0, 4, 3]
    assert [m.units for m in split_money(Money(1, "USD"), [1, 3])] == [0, 1]
    assert [m.units for m in split_money(Money(0, "USD"), [1, 2])] == [0, 0]
    assert [m.units for m in split_money(Money(999, "USD"), [5])] == [999]
    for pesos in ([], [0, 0], [1, -1], [1.5], [True, 1], "12"):
        with pytest.raises(ValueError):
            split_money(Money(10, "USD"), pesos)


def test_apply_rate():
    assert apply_rate(Money(1000, "USD"), "12.5%") == Money(125, "USD")
    assert apply_rate(Money(25, "USD"), "10%") == Money(2, "USD")
    assert apply_rate(Money(25, "USD"), "10%", "half_up") == Money(3, "USD")
    assert apply_rate(Money(-25, "USD"), "10%") == Money(-2, "USD")
    assert apply_rate(Money(-25, "USD"), "10%", "half_up") == Money(-3, "USD")
    assert apply_rate(Money(35, "EUR"), "10%") == Money(4, "EUR")
    assert apply_rate(Money(15, "JPY"), "10%", "half_even") == Money(2, "JPY")
    assert apply_rate(Money(5, "JPY"), "0.5%") == Money(0, "JPY")
    assert apply_rate(Money(333, "USD"), "7.25%", "half_up") == Money(24, "USD")
    for ruim in ("10", "%", "-5%", "1.%", ".5%", "5 %", "5%%"):
        with pytest.raises(ParseError) as info:
            apply_rate(Money(1, "USD"), ruim)
        assert (info.value.kind, info.value.reason) == ("rate", "bad rate")
    with pytest.raises(ValueError):
        apply_rate(Money(1, "USD"), "5%", "floor")


def test_convert_add_e_soma():
    assert convert(Money(100, "USD"), "JPY", "150") == Money(150, "JPY")
    assert convert(Money(1000, "USD"), "EUR", "0.92") == Money(920, "EUR")
    assert convert(Money(1, "JPY"), "USD", "0.0067") == Money(1, "USD")
    assert convert(Money(1000, "USD"), "KWD", "0.3075") == Money(3075, "KWD")
    assert convert(Money(5, "USD"), "EUR", "0.5") == Money(2, "EUR")
    assert convert(Money(5, "USD"), "EUR", "0.5", "half_up") == Money(3, "EUR")
    assert convert(Money(-5, "USD"), "EUR", "0.5", "half_up") == Money(-3, "EUR")
    with pytest.raises(ValueError):
        convert(Money(5, "USD"), "USD", "1")
    with pytest.raises(ValueError):
        convert(Money(5, "USD"), "XXX", "1")
    for ruim in ("0", "0.0", "-1", "1.1234567", "abc", "1,5", ""):
        with pytest.raises(ParseError) as info:
            convert(Money(5, "USD"), "EUR", ruim)
        assert info.value.kind == "rate"
    assert add(Money(1, "USD"), Money(-3, "USD")) == Money(-2, "USD")
    with pytest.raises(ValueError, match="currency mismatch: USD vs EUR"):
        add(Money(1, "USD"), Money(1, "EUR"))
    assert sum_money([Money(1, "USD"), Money(2, "USD")], "USD") == Money(3, "USD")
    assert sum_money([], "JPY") == Money(0, "JPY")
    with pytest.raises(ValueError):
        sum_money([Money(1, "USD"), Money(1, "EUR")], "USD")
    with pytest.raises(ValueError):
        sum_money([Money(1, "EUR")], "USD")

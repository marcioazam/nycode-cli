import pytest
from money import format_money, parse_money


@pytest.mark.parametrize(
    "s,c",
    [
        ("5", 500),
        ("1234.5", 123450),
        ("1,234.56", 123456),
        ("$0.07", 7),
        ("-$3.20", -320),
        ("-3", -300),
        ("1,000,000", 100000000),
        ("0", 0),
        ("0.00", 0),
        ("$12", 1200),
    ],
)
def test_parse(s, c):
    assert parse_money(s) == c


@pytest.mark.parametrize(
    "s",
    [
        "",
        "1.234",
        "1,23,4",
        ".5",
        "5.",
        "abc",
        "--1",
        "$",
        "-",
        "1,2345",
        "1 000",
        "$-1",
        "1.2.3",
    ],
)
def test_parse_bad(s):
    with pytest.raises(ValueError):
        parse_money(s)


@pytest.mark.parametrize(
    "c,s",
    [
        (0, "$0.00"),
        (5, "$0.05"),
        (-5, "-$0.05"),
        (123456, "$1,234.56"),
        (100000000, "$1,000,000.00"),
        (99, "$0.99"),
        (-100, "-$1.00"),
    ],
)
def test_format(c, s):
    assert format_money(c) == s


def test_roundtrip():
    for c in (0, 1, 99, 100, 123456789, -42, -100000):
        assert parse_money(format_money(c)) == c

import pytest
from frac import parse_ratio, simplify


def test_simplify():
    assert simplify(6, 8) == (3, 4)
    assert simplify(-6, 8) == (-3, 4)
    assert simplify(6, -8) == (-3, 4)
    assert simplify(-6, -8) == (3, 4)
    assert simplify(0, 5) == (0, 1)
    assert simplify(0, -5) == (0, 1)
    assert simplify(7, 1) == (7, 1)


def test_simplify_zero_den():
    with pytest.raises(ZeroDivisionError):
        simplify(1, 0)


def test_parse():
    assert parse_ratio("3:6") == (1, 2)
    assert parse_ratio("3/6") == (1, 2)
    assert parse_ratio("-3/6") == (-1, 2)
    assert parse_ratio("  3 / 6 ") == (1, 2)
    assert parse_ratio("4/-8") == (-1, 2)
    assert parse_ratio("0/9") == (0, 1)


@pytest.mark.parametrize(
    "s", ["", "3", "3/", "/3", "a/b", "1.5/2", "1/0", "1//2", "1/2/3", "1 2"]
)
def test_parse_bad(s):
    with pytest.raises(ValueError):
        parse_ratio(s)

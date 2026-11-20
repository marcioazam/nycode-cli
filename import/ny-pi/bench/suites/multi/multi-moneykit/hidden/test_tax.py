import pytest
from tax import tax_cents, total_cents


@pytest.mark.parametrize(
    "amount,bps,tax",
    [
        (10000, 825, 825),
        (1000, 825, 83),  # 82.5 -> 83
        (1001, 1000, 100),  # 100.1 -> 100
        (1005, 1000, 101),  # 100.5 -> 101
        (1, 5000, 1),  # 0.5 -> 1
        (1, 4999, 0),
        (0, 1000, 0),
        (12345, 0, 0),
        (99999999999, 10000, 99999999999),
        (3, 1667, 1),  # 0.5001 -> 1
    ],
)
def test_tax(amount, bps, tax):
    assert tax_cents(amount, bps) == tax


def test_total():
    assert total_cents(1000, 825) == 1083
    assert total_cents(0, 825) == 0


def test_no_float_precision_loss():
    assert tax_cents(10**18 + 1, 10000) == 10**18 + 1


@pytest.mark.parametrize("a,r", [(-1, 100), (100, -1)])
def test_negative(a, r):
    with pytest.raises(ValueError):
        tax_cents(a, r)

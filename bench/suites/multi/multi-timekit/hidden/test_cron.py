from datetime import datetime

import pytest
from cron import matches

D = datetime(2024, 3, 15, 10, 30)  # sexta-feira


def test_basic():
    assert matches("* * * * *", D)
    assert matches("30 10 15 3 5", D)
    assert not matches("31 10 * * *", D)
    assert not matches("30 11 * * *", D)


def test_lists_ranges_steps():
    assert matches("0,30 * * * *", D)
    assert matches("25-35 * * * *", D)
    assert matches("*/10 * * * *", D)
    assert not matches("*/7 * * * *", D)
    assert matches("10-50/20 * * * *", D)
    assert not matches("11-50/20 * * * *", D)


def test_dow_sunday_zero():
    sunday = datetime(2024, 3, 17, 0, 0)
    assert matches("0 0 * * 0", sunday)
    assert not matches("0 0 * * 0", D)
    assert matches("* * * * 1-5", D)


def test_dom_and_dow_both_required():
    assert not matches("30 10 15 * 0", D)
    assert matches("30 10 15 * 5", D)


@pytest.mark.parametrize(
    "expr",
    [
        "* * * *",
        "* * * * * *",
        "60 * * * *",
        "* 24 * * *",
        "* * 0 * *",
        "* * * 13 *",
        "* * * * 7",
        "*/0 * * * *",
        "5-1 * * * *",
        "a * * * *",
        "5/2 * * * *",
    ],
)
def test_invalid(expr):
    with pytest.raises(ValueError):
        matches(expr, D)

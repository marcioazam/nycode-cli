import pytest
from stockroom.config import configure, reset_config
from stockroom.errors import ValidationError
from stockroom.orders.pricing import discount_percent, line_total, order_subtotal
from stockroom.util.money import format_cents, percent_of


def test_percent_of_exact():
    assert percent_of(2000, 5) == 100
    assert percent_of(999, 0) == 0
    assert percent_of(999, 100) == 999


def test_percent_of_rounds_half_up():
    assert percent_of(250, 5) == 13
    assert percent_of(350, 5) == 18
    assert percent_of(249, 5) == 12
    assert percent_of(1250, 5) == 63


def test_percent_of_rejects_bad_input():
    for amount, percent in ((-1, 5), (100, 101), (100, -1), (1.5, 5)):
        with pytest.raises(ValidationError):
            percent_of(amount, percent)


def test_format_cents():
    assert format_cents(1234) == "12.34"
    assert format_cents(5) == "0.05"


def test_discount_tiers():
    assert discount_percent(1) == 0
    assert discount_percent(25) == 5
    assert discount_percent(49) == 5
    assert discount_percent(60) == 10
    assert discount_percent(500) == 10


def test_discount_starts_at_ten_units():
    assert discount_percent(9) == 0
    assert discount_percent(10) == 5
    assert discount_percent(11) == 5


def test_line_total_without_discount():
    price = line_total(3, 199)
    assert (price.gross, price.discount, price.net) == (597, 0, 597)


def test_line_total_with_discount():
    price = line_total(20, 1000)
    assert (price.gross, price.discount, price.net) == (20000, 1000, 19000)


def test_line_discount_rounds_half_up():
    price = line_total(30, 75)
    assert (price.gross, price.discount, price.net) == (2250, 113, 2137)


def test_order_subtotal_two_discounted_lines():
    # o desconto é arredondado por linha: 2 x (22,50 - 1,13)
    assert line_total(30, 75).net == 2137
    assert order_subtotal([(30, 75), (30, 75)]) == 4274


def test_line_total_rejects_bad_input():
    for qty, price in ((0, 100), (1, -1), (1, 1.5)):
        with pytest.raises(ValidationError):
            line_total(qty, price)


def test_custom_discount_tiers():
    configure(discount_tiers=((5, 10),))
    try:
        assert discount_percent(4) == 0
        assert discount_percent(6) == 10
        assert line_total(6, 1000).net == 5400
    finally:
        reset_config()
    with pytest.raises(ValidationError):
        configure(discount_tiers=((5, 10), (3, 20)))
    with pytest.raises(ValidationError):
        configure(frete_gratis=1)

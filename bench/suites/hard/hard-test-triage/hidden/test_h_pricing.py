import pytest
from stockroom.catalog.products import Catalog, Product
from stockroom.config import configure, reset_config, settings
from stockroom.errors import ValidationError
from stockroom.orders.order import OrderLine
from stockroom.orders.pricing import discount_percent, line_total, order_subtotal
from stockroom.orders.shipping import shipping_cost
from stockroom.orders.totals import order_totals
from stockroom.util.money import percent_of


@pytest.mark.parametrize(
    ("amount", "percent", "expected"),
    [(250, 5, 13), (1250, 5, 63), (350, 5, 18), (450, 5, 23), (249, 5, 12), (5, 10, 1)],
)
def test_percent_of_half_up(amount, percent, expected):
    assert percent_of(amount, percent) == expected


def test_discount_tiers_are_inclusive():
    assert [discount_percent(q) for q in (1, 9, 10, 11, 49, 50, 51)] == [
        0,
        0,
        5,
        5,
        5,
        10,
        10,
    ]


def test_line_discount_is_rounded_per_line():
    price = line_total(10, 125)
    assert (price.gross, price.discount, price.net) == (1250, 63, 1187)
    assert order_subtotal([(10, 125), (10, 125)]) == 2374
    assert order_subtotal([(10, 125), (10, 125), (10, 125), (3, 100)]) == 3861


def _catalog():
    catalog = Catalog()
    catalog.add(Product("AB-100", "Motor", 2050, weight_g=100))
    catalog.add(Product("CD-200", "Pino", 125, weight_g=10))
    catalog.add(Product("EF-300", "Mola", 125, weight_g=10))
    return catalog


def test_totals_round_per_line():
    lines = [OrderLine("CD-200", 10), OrderLine("EF-300", 10)]
    totals = order_totals(lines, _catalog())
    assert (totals.gross, totals.discount, totals.subtotal) == (2500, 126, 2374)
    assert (totals.shipping, totals.total) == (1700, 4074)


def test_free_shipping_uses_subtotal_after_discount():
    totals = order_totals([OrderLine("AB-100", 10)], _catalog())
    assert (totals.gross, totals.discount, totals.subtotal) == (20500, 1025, 19475)
    assert (totals.shipping, totals.total) == (1700, 21175)
    assert shipping_cost(20000, 900) == 0
    assert shipping_cost(19999, 900) == 1700
    assert shipping_cost(19999, 2001) == 2100


def test_configuration_is_global_and_resettable():
    configure(discount_tiers=((5, 10),), free_shipping_threshold=100)
    assert discount_percent(5) == 10
    assert shipping_cost(100, 5000) == 0
    assert settings().discount_tiers == ((5, 10),)
    reset_config()
    assert discount_percent(5) == 0
    assert discount_percent(10) == 5
    assert shipping_cost(100, 5000) == 2500
    with pytest.raises(ValidationError):
        configure(desconhecida=1)

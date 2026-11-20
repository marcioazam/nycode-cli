import pytest
from stockroom.catalog.products import Catalog, Product
from stockroom.errors import NotFoundError, ValidationError
from stockroom.orders.order import OrderLine
from stockroom.orders.shipping import shipping_cost
from stockroom.orders.totals import order_totals


def make_catalog():
    catalog = Catalog()
    catalog.add(Product("AB-100", "Motor", 1700, weight_g=100))
    catalog.add(Product("CD-200", "Correia", 1000, weight_g=500))
    return catalog


def test_shipping_charges_each_started_kg():
    assert shipping_cost(5000, 0) == 1500
    assert shipping_cost(5000, 1) == 1700
    assert shipping_cost(5000, 1000) == 1700
    assert shipping_cost(5000, 1001) == 1900


def test_shipping_is_free_from_threshold():
    assert shipping_cost(19999, 3000) == 2100
    assert shipping_cost(20000, 3000) == 0
    with pytest.raises(ValidationError):
        shipping_cost(100, -1)


def test_free_shipping_for_large_order():
    # 12 x 17,00 = 204,00: passa do limite de frete grátis
    totals = order_totals([OrderLine("AB-100", 12)], make_catalog())
    assert totals.gross == 20400
    assert totals.shipping == 0
    assert totals.total == 19380


def test_totals_of_small_order():
    totals = order_totals([OrderLine("CD-200", 6)], make_catalog())
    assert (totals.gross, totals.discount, totals.subtotal) == (6000, 0, 6000)
    assert (totals.weight_g, totals.shipping, totals.total) == (3000, 2100, 8100)


def test_totals_of_mixed_order():
    lines = [OrderLine("AB-100", 2), OrderLine("CD-200", 3)]
    totals = order_totals(lines, make_catalog())
    assert (totals.gross, totals.discount, totals.subtotal) == (6400, 0, 6400)
    assert (totals.weight_g, totals.shipping, totals.total) == (1700, 1900, 8300)


def test_totals_unknown_sku():
    with pytest.raises(NotFoundError):
        order_totals([OrderLine("ZZ-999", 1)], make_catalog())

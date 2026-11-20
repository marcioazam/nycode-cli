from decimal import Decimal

import pytest
from pricing.cart import Cart
from pricing.catalog import PriceList, Product
from pricing.errors import InvalidQuantityError, UnknownProductError

WIDGET = Product("W", "Widget", "10.00")
BOLT = Product("B", "Bolt", "0.25")


def test_add_and_subtotal():
    cart = Cart()
    cart.add(WIDGET, 2)
    cart.add(BOLT, 3)
    assert [line.total for line in cart.lines] == [Decimal("20.00"), Decimal("0.75")]
    assert cart.subtotal() == Decimal("20.75")


def test_same_sku_merges_and_reprices_with_tiers():
    prices = PriceList()
    prices.set_tiers("W", [(3, "9.00")])
    cart = Cart(prices)
    cart.add(WIDGET, 2)
    line = cart.add(WIDGET, 1)
    assert line.quantity == 3
    assert line.unit_price == Decimal("9.00")
    assert cart.subtotal() == Decimal("27.00")


def test_bad_quantity_and_remove():
    cart = Cart()
    for bad in (0, -1, True, 1.5):
        with pytest.raises(InvalidQuantityError):
            cart.add(WIDGET, bad)
    assert cart.is_empty
    cart.add(WIDGET)
    cart.remove("W")
    assert cart.is_empty
    with pytest.raises(UnknownProductError):
        cart.remove("W")


def test_empty_cart_subtotal_is_zero_cents():
    assert str(Cart().subtotal()) == "0.00"

from decimal import Decimal

import pytest
from pricing.cart import Cart, compute_totals
from pricing.catalog import Catalog, Product
from pricing.discounts import PercentOff
from pricing.errors import PricingError, UnknownProductError
from pricing.orders import CheckoutService


def make_service():
    catalog = Catalog()
    catalog.add(Product("W", "Widget", "10.00"))
    catalog.add(Product("G", "Gadget", "60.00"))
    return CheckoutService(catalog)


def test_compute_totals():
    cart = Cart()
    cart.add(Product("W", "Widget", "10.00"), 2)
    totals = compute_totals(cart, "US-CA", [PercentOff(10)])
    assert totals.subtotal == Decimal("20.00")
    assert totals.discount == Decimal("2.00")
    assert totals.tax == Decimal("1.31")
    assert totals.shipping == Decimal("7.50")
    assert totals.grand_total == Decimal("26.81")


def test_quote_from_plain_mapping():
    service = make_service()
    totals = service.quote({"W": 1, "G": 2}, "TAX-FREE")
    assert totals.subtotal == Decimal("130.00")
    assert totals.shipping == Decimal("0.00")
    assert service.ledger.count() == 0
    with pytest.raises(UnknownProductError):
        service.quote({"NOPE": 1}, "TAX-FREE")


def test_checkout_numbers_orders_and_records_them():
    service = make_service()
    first = Cart()
    first.add(service.catalog.get("W"), 1)
    second = Cart()
    second.add(service.catalog.get("G"), 2)
    assert service.checkout(first, "TAX-FREE").order_id == "ORD-0001"
    assert service.checkout(second, "TAX-FREE").order_id == "ORD-0002"
    assert service.ledger.count() == 2
    assert service.ledger.total() == Decimal("137.50")


def test_checkout_rejects_empty_cart():
    with pytest.raises(PricingError):
        make_service().checkout(Cart(), "TAX-FREE")


def test_empty_ledger_total():
    assert str(make_service().ledger.total()) == "0.00"

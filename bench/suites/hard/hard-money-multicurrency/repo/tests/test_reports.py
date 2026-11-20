from decimal import Decimal

from pricing.cart import Cart
from pricing.catalog import Catalog, Product
from pricing.discounts import PercentOff
from pricing.orders import CheckoutService
from pricing.reports import format_amount, render_invoice, summarize


def place_orders():
    catalog = Catalog()
    catalog.add(Product("W", "Widget", "10.00"))
    catalog.add(Product("S", "Server", "1234.50"))
    service = CheckoutService(catalog)
    small = Cart()
    small.add(catalog.get("W"), 2)
    big = Cart()
    big.add(catalog.get("S"), 1)
    return [
        service.checkout(small, "US-CA", [PercentOff(10)]),
        service.checkout(big, "TAX-FREE"),
    ]


def test_format_amount():
    assert format_amount(Decimal("1234.5")) == "1,234.50"
    assert format_amount(Decimal(-2)) == "-2.00"


def test_invoice_text():
    small, big = place_orders()
    assert render_invoice(small) == [
        "Invoice ORD-0001",
        "2 x Widget @ 10.00 = 20.00",
        "Subtotal: 20.00",
        "Discount: -2.00",
        "Tax: 1.31",
        "Shipping: 7.50",
        "Total: 26.81",
    ]
    assert render_invoice(big) == [
        "Invoice ORD-0002",
        "1 x Server @ 1,234.50 = 1,234.50",
        "Subtotal: 1,234.50",
        "Tax: 0.00",
        "Shipping: 0.00",
        "Total: 1,234.50",
    ]


def test_summary():
    assert summarize(place_orders()) == {
        "count": 2,
        "revenue": Decimal("1261.31"),
        "tax": Decimal("1.31"),
    }
    assert summarize([]) == {
        "count": 0,
        "revenue": Decimal("0.00"),
        "tax": Decimal("0.00"),
    }

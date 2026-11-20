"""Static configuration: tax rates, shipping and exemptions."""

from decimal import Decimal

TAX_RATES = {
    "US-CA": Decimal("0.0725"),
    "US-NY": Decimal("0.08875"),
    "BR-SP": Decimal("0.18"),
    "DE": Decimal("0.19"),
    "JP": Decimal("0.10"),
    "TAX-FREE": Decimal(0),
}

EXEMPT_CUSTOMER_TYPES = frozenset({"nonprofit", "reseller"})

SHIPPING_FLAT = Decimal("7.50")
SHIPPING_FREE_ABOVE = Decimal("100.00")

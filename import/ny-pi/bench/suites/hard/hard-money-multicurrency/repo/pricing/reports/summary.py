"""Sales summary over a set of orders."""

from collections.abc import Iterable
from decimal import Decimal

from pricing.orders.order import Order


def summarize(orders: Iterable[Order]) -> dict[str, object]:
    """Order count, revenue (grand totals) and tax collected."""
    count = 0
    revenue = Decimal("0.00")
    tax = Decimal("0.00")
    for order in orders:
        count += 1
        revenue += order.totals.grand_total
        tax += order.totals.tax
    return {"count": count, "revenue": revenue, "tax": tax}

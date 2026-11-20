"""Sales summary over a set of orders."""

from collections.abc import Iterable
from decimal import Decimal

from pricing.errors import CurrencyMismatchError
from pricing.orders.order import Order
from pricing.rounding import round_amount


def _summary(orders: list[Order], currency: str) -> dict[str, object]:
    zero = round_amount(Decimal(0), currency)
    revenue = sum((o.totals.grand_total for o in orders), zero)
    tax = sum((o.totals.tax for o in orders), zero)
    return {"count": len(orders), "revenue": revenue, "tax": tax}


def summarize(orders: Iterable[Order]) -> dict[str, object]:
    """Order count, revenue (grand totals) and tax collected, in one currency."""
    orders = list(orders)
    currencies = {o.currency for o in orders}
    if len(currencies) > 1:
        raise CurrencyMismatchError(f"orders in {', '.join(sorted(currencies))}")
    return _summary(orders, currencies.pop() if currencies else "USD")


def summarize_by_currency(orders: Iterable[Order]) -> dict[str, dict[str, object]]:
    """One summary per currency, keys in ascending code order."""
    groups: dict[str, list[Order]] = {}
    for order in orders:
        groups.setdefault(order.currency, []).append(order)
    return {code: _summary(group, code) for code, group in sorted(groups.items())}

"""Plain-text invoices."""

from decimal import Decimal

from pricing import config
from pricing.money import get_currency
from pricing.orders.order import Order
from pricing.rounding import round_amount


def format_amount(amount: Decimal, currency: str | None = None) -> str:
    """Legacy `1,234.50` without a currency; `1,234.50 EUR` / `1,235 JPY` with one."""
    if currency is None:
        return f"{round_amount(amount):,.2f}"
    digits = get_currency(currency).exponent
    return f"{round_amount(amount, currency):,.{digits}f} {currency}"


def render_invoice(order: Order) -> list[str]:
    totals = order.totals
    code = None if order.currency == config.DEFAULT_CURRENCY else order.currency

    def fmt(amount: Decimal) -> str:
        return format_amount(amount, code)

    out = [f"Invoice {order.order_id}"]
    for line in order.lines:
        out.append(
            f"{line.quantity} x {line.product.name} @ {fmt(line.unit_price)}"
            f" = {fmt(line.total)}"
        )
    out.append(f"Subtotal: {fmt(totals.subtotal)}")
    if totals.discount > 0:
        out.append(f"Discount: {fmt(-totals.discount)}")
    out.append(f"Tax: {fmt(totals.tax)}")
    out.append(f"Shipping: {fmt(totals.shipping)}")
    out.append(f"Total: {fmt(totals.grand_total)}")
    return out

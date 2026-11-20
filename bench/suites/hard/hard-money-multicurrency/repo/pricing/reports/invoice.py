"""Plain-text invoices."""

from decimal import Decimal

from pricing.orders.order import Order
from pricing.rounding import round_amount


def format_amount(amount: Decimal) -> str:
    """Two decimals with thousands separators: 1,234.50."""
    return f"{round_amount(amount):,.2f}"


def render_invoice(order: Order) -> list[str]:
    totals = order.totals
    out = [f"Invoice {order.order_id}"]
    for line in order.lines:
        out.append(
            f"{line.quantity} x {line.product.name} @ {format_amount(line.unit_price)}"
            f" = {format_amount(line.total)}"
        )
    out.append(f"Subtotal: {format_amount(totals.subtotal)}")
    if totals.discount > 0:
        out.append(f"Discount: {format_amount(-totals.discount)}")
    out.append(f"Tax: {format_amount(totals.tax)}")
    out.append(f"Shipping: {format_amount(totals.shipping)}")
    out.append(f"Total: {format_amount(totals.grand_total)}")
    return out

"""Running totals used by the aggregate stage."""

from dataclasses import dataclass, field
from decimal import Decimal

from reportkit.helpers.money import HUNDRED, TENTH, ZERO, round_half_up
from reportkit.models import ProductLine, RegionSummary


@dataclass
class RegionTotals:
    orders: int = 0
    units: int = 0
    gross: Decimal = ZERO
    discount: Decimal = ZERO
    net: Decimal = ZERO
    products: dict = field(default_factory=dict)


def empty_totals():
    return RegionTotals()


def _bump(totals, order, gross, discount):
    totals.orders += 1
    totals.units += order.quantity
    totals.gross += gross
    totals.discount += discount
    totals.net += gross - discount


def add_order(totals, order):
    """Fold one order in. The discount is rounded per order, half up, to the cent."""
    gross = order.quantity * order.unit_price
    discount = round_half_up(gross * order.discount_pct / HUNDRED)
    _bump(totals, order, gross, discount)
    line = totals.products.setdefault(order.product, empty_totals())
    _bump(line, order, gross, discount)


def to_region_summary(name, totals, grand_net):
    share = (
        round_half_up(totals.net / grand_net * HUNDRED, TENTH)
        if grand_net
        else Decimal("0.0")
    )
    lines = [
        ProductLine(product, t.orders, t.units, t.gross, t.discount, t.net)
        for product, t in sorted(
            totals.products.items(), key=lambda item: (-item[1].net, item[0])
        )
    ]
    return RegionSummary(
        name,
        share,
        totals.orders,
        totals.units,
        totals.gross,
        totals.discount,
        totals.net,
        lines,
    )

"""Stage 3: validated orders -> Summary (SPEC section 4)."""

from reportkit.aggregate.monthly import aggregate_monthly
from reportkit.aggregate.totals import add_order, empty_totals, to_region_summary
from reportkit.helpers.money import ZERO, round_half_up, total
from reportkit.models import Summary

__all__ = ["aggregate", "aggregate_monthly"]


def aggregate(orders):
    """Return the Summary of a list of Order; only paid orders count."""
    orders = [order for order in orders if order.status == "paid"]
    by_region = {}
    for order in orders:
        totals = by_region.setdefault(order.region, empty_totals())
        add_order(totals, order)
    grand_net = total(t.net for t in by_region.values())
    ordered = sorted(by_region.items(), key=lambda item: (-item[1].net, item[0]))
    regions = [to_region_summary(name, t, grand_net) for name, t in ordered]
    count = sum(t.orders for t in by_region.values())
    dates = [order.date for order in orders]
    average = round_half_up(grand_net / count) if count else ZERO
    return Summary(
        first_date=min(dates) if dates else None,
        last_date=max(dates) if dates else None,
        orders=count,
        units=sum(t.units for t in by_region.values()),
        gross=total(t.gross for t in by_region.values()),
        discount=total(t.discount for t in by_region.values()),
        net=grand_net,
        average_order=average,
        regions=regions,
    )

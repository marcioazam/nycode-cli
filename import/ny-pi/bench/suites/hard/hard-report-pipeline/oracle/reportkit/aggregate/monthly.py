"""Stage 3 for the monthly report (SPEC section 9, rules R5 to R10)."""

from dataclasses import dataclass, field
from decimal import Decimal

from reportkit.aggregate.totals import RegionTotals, add_order, empty_totals
from reportkit.helpers.money import ZERO, round_half_up, total
from reportkit.models import Month, MonthlyReport, MonthRegion

_TENTHS = 1000  # 100.0% counted in tenths of a percent
_NO_SHARE = Decimal("0.0")


@dataclass
class _Cell:
    paid: RegionTotals = field(default_factory=empty_totals)
    refunded: Decimal = ZERO


def _label(key):
    return f"{key[0]:04d}-{key[1]:02d}"


def _month_range(first, last):
    year, month = first
    while (year, month) <= last:
        yield year, month
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)


def _shares(nets):
    """Largest remainder: tenths of a percent that add up to exactly 100.0."""
    whole = sum(nets)
    if not whole:
        return [_NO_SHARE for _ in nets]
    cents = [int(net * 100) for net in nets]
    base = int(whole * 100)
    floors = [value * _TENTHS // base for value in cents]
    rests = [value * _TENTHS % base for value in cents]
    # sorted() is stable, so equal remainders keep the report order.
    by_rest = sorted(range(len(nets)), key=lambda index: -rests[index])
    for index in by_rest[: _TENTHS - sum(floors)]:
        floors[index] += 1
    return [Decimal(value) / 10 for value in floors]


def _build_month(label, cells):
    # dict order is the order of first appearance; sorted() keeps it on ties.
    ordered = sorted(cells.items(), key=lambda item: -item[1].paid.net)
    shares = _shares([cell.paid.net for _, cell in ordered])
    regions = [
        MonthRegion(
            name,
            c.paid.orders,
            c.paid.units,
            c.paid.gross,
            c.paid.discount,
            c.paid.net,
            c.refunded,
            share,
        )
        for (name, c), share in zip(ordered, shares)
    ]
    return Month(
        month=label,
        orders=sum(r.orders for r in regions),
        units=sum(r.units for r in regions),
        gross=total(r.gross for r in regions),
        discount=total(r.discount for r in regions),
        net=total(r.net for r in regions),
        refunded=total(r.refunded for r in regions),
        share=sum(shares, _NO_SHARE),
        regions=regions,
    )


def aggregate_monthly(orders):
    """Return the MonthlyReport of a list of Order (cancelled orders are ignored)."""
    by_month = {}
    for order in orders:
        if order.status == "cancelled":
            continue
        cells = by_month.setdefault((order.date.year, order.date.month), {})
        cell = cells.setdefault(order.region, _Cell())
        if order.status == "paid":
            add_order(cell.paid, order)
        else:
            single = empty_totals()
            add_order(single, order)
            cell.refunded += single.net
    keys = list(_month_range(min(by_month), max(by_month))) if by_month else []
    months = [_build_month(_label(key), by_month.get(key, {})) for key in keys]
    count = sum(m.orders for m in months)
    net = total(m.net for m in months)
    return MonthlyReport(
        first_month=months[0].month if months else None,
        last_month=months[-1].month if months else None,
        orders=count,
        units=sum(m.units for m in months),
        gross=total(m.gross for m in months),
        discount=total(m.discount for m in months),
        net=net,
        refunded=total(m.refunded for m in months),
        average_order=round_half_up(net / count) if count else ZERO,
        months=months,
    )

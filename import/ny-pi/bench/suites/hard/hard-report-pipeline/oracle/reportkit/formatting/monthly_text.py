"""Text rendering of the monthly report (SPEC section 9, rules R11 to R13)."""

from reportkit.formatting.layout import percent, row
from reportkit.helpers.money import grouped

WIDTHS = (7, 6, 6, 6, 12, 12, 12, 12, 6)
HEADER = (
    "MONTH",
    "REGION",
    "ORDERS",
    "UNITS",
    "GROSS",
    "DISCOUNT",
    "NET",
    "REFUNDED",
    "SHARE",
)
LEFT = 2


def _numbers(item):
    return [
        str(item.orders),
        str(item.units),
        grouped(item.gross),
        grouped(item.discount),
        grouped(item.net),
        grouped(item.refunded),
    ]


def render_monthly(report):
    period = (
        "-"
        if report.first_month is None
        else f"{report.first_month} to {report.last_month}"
    )
    lines = ["MONTHLY REPORT", f"Period: {period}", "", row(HEADER, WIDTHS, LEFT)]
    for month in report.months:
        label = month.month
        for region in month.regions:
            lines.append(
                row(
                    [label, region.region, *_numbers(region), percent(region.share)],
                    WIDTHS,
                    LEFT,
                )
            )
            label = ""
        lines.append(
            row([label, "TOTAL", *_numbers(month), percent(month.share)], WIDTHS, LEFT)
        )
    lines.append(row(["TOTAL", "", *_numbers(report), ""], WIDTHS, LEFT))
    lines.append("")
    lines.append(f"Average order: {grouped(report.average_order)}")
    return lines

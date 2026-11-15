"""Text rendering of the summary report (SPEC section 5)."""

from reportkit.formatting.layout import percent, row
from reportkit.helpers.money import grouped
from reportkit.helpers.text import fit

WIDTHS = (22, 6, 6, 12, 12, 12, 6)
HEADER = ("REGION / PRODUCT", "ORDERS", "UNITS", "GROSS", "DISCOUNT", "NET", "SHARE")
PRODUCT_INDENT = "  "
PRODUCT_WIDTH = 20


def _numbers(item):
    return [
        str(item.orders),
        str(item.units),
        grouped(item.gross),
        grouped(item.discount),
        grouped(item.net),
    ]


def render_summary(summary):
    if summary.first_date is None:
        period = "-"
    else:
        period = f"{summary.first_date.isoformat()} to {summary.last_date.isoformat()}"
    lines = [
        "SALES REPORT",
        f"Period: {period}",
        f"Orders: {summary.orders}",
        f"Units: {summary.units}",
        f"Gross: {grouped(summary.gross)}",
        f"Discount: {grouped(summary.discount)}",
        f"Net: {grouped(summary.net)}",
        f"Average order: {grouped(summary.average_order)}",
        "",
        row(HEADER, WIDTHS),
    ]
    for region in summary.regions:
        lines.append(
            row([region.region, *_numbers(region), percent(region.share)], WIDTHS)
        )
        for line in region.products:
            name = PRODUCT_INDENT + fit(line.product, PRODUCT_WIDTH)
            lines.append(row([name, *_numbers(line), ""], WIDTHS))
    lines.append(row(["TOTAL", *_numbers(summary), ""], WIDTHS))
    return lines

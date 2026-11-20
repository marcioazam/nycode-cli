"""CSV and JSON export of the monthly report (SPEC section 9, rules R14 and R15)."""

from reportkit.export.csv_out import write_rows
from reportkit.export.json_out import dump, totals
from reportkit.helpers.money import plain

HEADER = (
    "month",
    "region",
    "orders",
    "units",
    "gross",
    "discount",
    "net",
    "refunded",
    "share",
)
ALL = "*"


def _numbers(item):
    return [
        str(item.orders),
        str(item.units),
        plain(item.gross),
        plain(item.discount),
        plain(item.net),
        plain(item.refunded),
    ]


def monthly_csv(report):
    rows = [HEADER]
    for month in report.months:
        for region in month.regions:
            rows.append(
                [month.month, region.region, *_numbers(region), plain(region.share, 1)]
            )
        rows.append([month.month, ALL, *_numbers(month), plain(month.share, 1)])
    rows.append([ALL, ALL, *_numbers(report), ""])
    return write_rows(rows)


def _totals(item):
    return {**totals(item), "refunded": plain(item.refunded)}


def monthly_json(report):
    months = []
    for month in report.months:
        regions = [
            {"region": r.region, **_totals(r), "share": plain(r.share, 1)}
            for r in month.regions
        ]
        months.append(
            {
                "month": month.month,
                **_totals(month),
                "share": plain(month.share, 1),
                "regions": regions,
            }
        )
    document = {
        "report": "monthly",
        "first_month": report.first_month,
        "last_month": report.last_month,
        **_totals(report),
        "average_order": plain(report.average_order),
        "months": months,
    }
    return dump(document)

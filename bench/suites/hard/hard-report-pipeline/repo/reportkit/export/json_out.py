"""JSON export (SPEC section 7). Money goes out as text so no float is involved."""

import json

from reportkit.helpers.money import plain


def dump(document):
    return json.dumps(document, indent=2, ensure_ascii=False) + "\n"


def totals(item):
    return {
        "orders": item.orders,
        "units": item.units,
        "gross": plain(item.gross),
        "discount": plain(item.discount),
        "net": plain(item.net),
    }


def _iso(date):
    return None if date is None else date.isoformat()


def summary_json(summary):
    regions = []
    for region in summary.regions:
        products = [
            {"product": line.product, **totals(line)} for line in region.products
        ]
        regions.append(
            {
                "region": region.region,
                "share": plain(region.share, 1),
                **totals(region),
                "products": products,
            }
        )
    document = {
        "report": "summary",
        "first_date": _iso(summary.first_date),
        "last_date": _iso(summary.last_date),
        **totals(summary),
        "average_order": plain(summary.average_order),
        "regions": regions,
    }
    return dump(document)

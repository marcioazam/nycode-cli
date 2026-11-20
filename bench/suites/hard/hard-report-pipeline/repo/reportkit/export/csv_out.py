"""CSV export (SPEC section 6)."""

from reportkit.helpers.money import plain

LINE_END = "\r\n"
_NEEDS_QUOTES = (",", '"', "\r", "\n")
HEADER = ("region", "product", "orders", "units", "gross", "discount", "net", "share")


def quote_field(text):
    """Quote only when needed: separator, quote, line break or blank at either end."""
    if any(char in text for char in _NEEDS_QUOTES) or text != text.strip(" "):
        return '"' + text.replace('"', '""') + '"'
    return text


def write_rows(rows):
    return "".join(
        ",".join(quote_field(cell) for cell in cells) + LINE_END for cells in rows
    )


def _numbers(item):
    return [
        str(item.orders),
        str(item.units),
        plain(item.gross),
        plain(item.discount),
        plain(item.net),
    ]


def summary_csv(summary):
    rows = [HEADER]
    for region in summary.regions:
        rows.append([region.region, "", *_numbers(region), plain(region.share, 1)])
        for line in region.products:
            rows.append([region.region, line.product, *_numbers(line), ""])
    rows.append(["TOTAL", "", *_numbers(summary), ""])
    return write_rows(rows)

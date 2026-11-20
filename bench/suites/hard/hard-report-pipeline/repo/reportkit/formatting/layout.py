"""Fixed-width table cells (SPEC section 5)."""

from reportkit.helpers.money import plain

SEPARATOR = "  "


def row(cells, widths, left=1):
    """Join cells: the first `left` ones left-aligned, the others right-aligned.

    Trailing blanks are removed; a cell wider than its column is not cut.
    """
    parts = []
    for index, (cell, width) in enumerate(zip(cells, widths)):
        parts.append(cell.ljust(width) if index < left else cell.rjust(width))
    return SEPARATOR.join(parts).rstrip()


def percent(value):
    return f"{plain(value, 1)}%"

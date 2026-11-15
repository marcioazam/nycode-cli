"""Tabelas de texto alinhadas por largura de exibição."""

from relkit.util.text import display_width, pad, truncate


def _cell(value, limit):
    text = "" if value is None else str(value)
    for ch in "\r\n\t":
        text = text.replace(ch, " ")
    if limit is not None and display_width(text) > limit:
        text = truncate(text, limit)
    return text


def render_table(headers, rows, aligns: str = "", max_widths=None) -> str:
    count = len(headers)
    if count == 0:
        raise ValueError("headers must not be empty")
    aligns = aligns or "l" * count
    if len(aligns) != count or any(a not in "lrc" for a in aligns):
        raise ValueError("bad aligns")
    limits = list(max_widths) if max_widths is not None else [None] * count
    if len(limits) != count:
        raise ValueError("bad max_widths")
    grid = [[_cell(h, limits[i]) for i, h in enumerate(headers)]]
    for number, row in enumerate(rows, 1):
        if len(row) != count:
            raise ValueError(f"row {number} has {len(row)} cells, expected {count}")
        grid.append([_cell(v, limits[i]) for i, v in enumerate(row)])
    widths = [max(1, *(display_width(line[i]) for line in grid)) for i in range(count)]

    def line(cells):
        return " | ".join(
            pad(c, widths[i], aligns[i]) for i, c in enumerate(cells)
        ).rstrip()

    out = [line(grid[0]), "-+-".join("-" * w for w in widths)]
    out.extend(line(cells) for cells in grid[1:])
    return "\n".join(out)

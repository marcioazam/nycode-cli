"""Header handling: which position holds which known column."""

from reportkit.errors import ReadError
from reportkit.helpers.columns import COLUMNS


def resolve_header(names, line):
    """Map each header position to a known column name, or None when ignored."""
    seen = set()
    layout = []
    for name in names:
        if name not in COLUMNS:
            layout.append(None)
            continue
        if name in seen:
            raise ReadError(f"line {line}: duplicate column '{name}'")
        seen.add(name)
        layout.append(name)
    for name in COLUMNS:
        if name not in seen:
            raise ReadError(f"line {line}: missing column '{name}'")
    return layout

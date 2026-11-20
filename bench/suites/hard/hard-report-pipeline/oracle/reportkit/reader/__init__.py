"""Stage 1: split CSV text into raw rows (SPEC section 2)."""

from reportkit.errors import ReadError
from reportkit.models import RawRow
from reportkit.reader.header import resolve_header
from reportkit.reader.tokenizer import tokenize

__all__ = ["read_rows"]


def read_rows(text):
    """Return the data records of `text` as a list of RawRow.

    `fields` holds the required columns plus the optional ones the header has.
    """
    records = tokenize(text)
    try:
        line, header = next(records)
    except StopIteration:
        raise ReadError("missing header") from None
    layout = resolve_header([field.value for field in header], line)
    rows = []
    for line, fields in records:
        if len(fields) != len(layout):
            raise ReadError(
                f"line {line}: expected {len(layout)} fields, got {len(fields)}"
            )
        values = {
            name: field.value for name, field in zip(layout, fields) if name is not None
        }
        rows.append(RawRow(line=line, fields=values))
    return rows

"""Stage 2: raw rows -> Order objects (SPEC section 3)."""

from reportkit.errors import ValidationError
from reportkit.models import Order
from reportkit.validate import fields
from reportkit.validate.fields import FieldError

__all__ = ["validate_rows"]

# Checked in this order; order_id is handled apart because it needs the ids seen so far.
_PARSERS = (
    ("date", fields.parse_date),
    ("region", fields.parse_region),
    ("product", fields.parse_product),
    ("quantity", fields.parse_quantity),
    ("unit_price", fields.parse_unit_price),
    ("discount_pct", fields.parse_discount_pct),
)


def validate_rows(rows):
    """Return the list of Order, or raise ValidationError with every message."""
    orders = []
    errors = []
    seen = {}
    for row in rows:
        values, problems = _check_row(row, seen)
        if problems:
            errors.extend(f"line {row.line}: {problem}" for problem in problems)
        else:
            orders.append(Order(line=row.line, **values))
    if errors:
        raise ValidationError(errors)
    return orders


def _check_row(row, seen):
    values = {"order_id": row.fields["order_id"]}
    problems = []
    order_id = values["order_id"]
    if order_id == "":
        problems.append("order_id: empty")
    elif order_id in seen:
        problems.append(f"order_id: duplicate of line {seen[order_id]}")
    else:
        # Registered even when the rest of the row turns out to be invalid.
        seen[order_id] = row.line
    for column, parser in _PARSERS:
        try:
            values[column] = parser(row.fields[column])
        except FieldError as exc:
            problems.append(f"{column}: {exc}")
    return values, problems

"""Datas ISO estritas (AAAA-MM-DD)."""

import re
from datetime import date

from helpdesk.errors import ValidationError

_ISO = re.compile(r"\d{4}-\d{2}-\d{2}")


def parse_date(value, field="created"):
    if not isinstance(value, str) or not _ISO.fullmatch(value):
        raise ValidationError(f"{field} must be YYYY-MM-DD", field)
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise ValidationError(f"{field} is not a real date", field) from None

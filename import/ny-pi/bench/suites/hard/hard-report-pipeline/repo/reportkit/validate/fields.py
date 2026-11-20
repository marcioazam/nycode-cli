"""Per-column parsers (SPEC section 3). Each one raises FieldError with the reason."""

import datetime
import re
from decimal import Decimal

from reportkit.helpers.columns import REGIONS
from reportkit.helpers.money import HUNDRED, ZERO

_DATE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")
_DIGITS = re.compile(r"[0-9]+")
_AMOUNT = re.compile(r"[0-9]+(\.[0-9]{1,2})?")


class FieldError(ValueError):
    """The text of one field is not acceptable; str() is the reason."""


def parse_date(text):
    if _DATE.fullmatch(text):
        try:
            return datetime.date.fromisoformat(text)
        except ValueError:
            pass
    raise FieldError(f"invalid date '{text}'")


def parse_region(text):
    region = text.upper()
    if region not in REGIONS:
        raise FieldError(f"unknown region '{text}'")
    return region


def parse_product(text):
    if text == "":
        raise FieldError("empty")
    return text


def parse_quantity(text):
    if not _DIGITS.fullmatch(text) or int(text) == 0:
        raise FieldError(f"invalid quantity '{text}'")
    return int(text)


def parse_unit_price(text):
    if not _AMOUNT.fullmatch(text):
        raise FieldError(f"invalid amount '{text}'")
    return Decimal(text)


def parse_discount_pct(text):
    if text == "":
        return ZERO
    if not _AMOUNT.fullmatch(text) or Decimal(text) > HUNDRED:
        raise FieldError(f"invalid percentage '{text}'")
    return Decimal(text)

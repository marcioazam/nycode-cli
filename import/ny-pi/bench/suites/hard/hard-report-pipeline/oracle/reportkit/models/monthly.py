from dataclasses import dataclass
from decimal import Decimal


@dataclass(frozen=True)
class MonthRegion:
    """Totals of one region inside one month."""

    region: str
    orders: int
    units: int
    gross: Decimal
    discount: Decimal
    net: Decimal
    refunded: Decimal
    share: Decimal


@dataclass(frozen=True)
class Month:
    """Subtotal of one month plus its region rows, in report order."""

    month: str
    orders: int
    units: int
    gross: Decimal
    discount: Decimal
    net: Decimal
    refunded: Decimal
    share: Decimal
    regions: list


@dataclass(frozen=True)
class MonthlyReport:
    first_month: str | None
    last_month: str | None
    orders: int
    units: int
    gross: Decimal
    discount: Decimal
    net: Decimal
    refunded: Decimal
    average_order: Decimal
    months: list

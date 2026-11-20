import datetime
from dataclasses import dataclass
from decimal import Decimal


@dataclass(frozen=True)
class ProductLine:
    """Totals of one product inside one region."""

    product: str
    orders: int
    units: int
    gross: Decimal
    discount: Decimal
    net: Decimal


@dataclass(frozen=True)
class RegionSummary:
    """Totals of one region plus its product lines, in report order."""

    region: str
    share: Decimal
    orders: int
    units: int
    gross: Decimal
    discount: Decimal
    net: Decimal
    products: list


@dataclass(frozen=True)
class Summary:
    """Everything the formatting and export stages need."""

    first_date: datetime.date | None
    last_date: datetime.date | None
    orders: int
    units: int
    gross: Decimal
    discount: Decimal
    net: Decimal
    average_order: Decimal
    regions: list

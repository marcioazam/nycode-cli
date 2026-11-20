import datetime
from dataclasses import dataclass
from decimal import Decimal


@dataclass(frozen=True)
class Order:
    """One validated order row."""

    line: int
    order_id: str
    date: datetime.date
    region: str
    product: str
    quantity: int
    unit_price: Decimal
    discount_pct: Decimal

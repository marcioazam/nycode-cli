"""Product value object."""

from dataclasses import dataclass
from decimal import Decimal

from pricing.errors import InvalidAmountError
from pricing.rounding import check_precision, to_decimal


@dataclass(frozen=True)
class Product:
    sku: str
    name: str
    unit_price: Decimal
    category: str = "general"

    def __post_init__(self) -> None:
        price = to_decimal(self.unit_price)
        if price < 0:
            raise InvalidAmountError(f"negative price for {self.sku}")
        object.__setattr__(self, "unit_price", check_precision(price))

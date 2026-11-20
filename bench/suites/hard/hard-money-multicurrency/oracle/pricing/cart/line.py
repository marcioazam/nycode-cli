"""One cart line: a product, a quantity and the unit price charged."""

from dataclasses import dataclass
from decimal import Decimal

from pricing.catalog.product import Product
from pricing.rounding import round_amount


@dataclass(frozen=True)
class CartLine:
    product: Product
    quantity: int
    unit_price: Decimal
    currency: str = "USD"

    @property
    def total(self) -> Decimal:
        return round_amount(self.unit_price * self.quantity, self.currency)

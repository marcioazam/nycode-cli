"""Quantity tiers: a cheaper unit price from a minimum quantity on.

Tier prices are expressed in the currency of the product they belong to.
"""

from decimal import Decimal

from pricing.catalog.product import Product
from pricing.errors import InvalidAmountError, InvalidQuantityError
from pricing.rounding import to_decimal


class PriceList:
    def __init__(self) -> None:
        self._tiers: dict[str, list[tuple[int, Decimal]]] = {}

    def set_tiers(self, sku: str, tiers: list[tuple[int, object]]) -> None:
        parsed = []
        for min_qty, price in tiers:
            if isinstance(min_qty, bool) or not isinstance(min_qty, int) or min_qty < 1:
                raise InvalidQuantityError(f"bad tier quantity: {min_qty!r}")
            amount = to_decimal(price)
            if amount < 0:
                raise InvalidAmountError(f"negative tier price for {sku}")
            parsed.append((min_qty, amount))
        self._tiers[sku] = sorted(parsed)

    def unit_price(self, product: Product, quantity: int) -> Decimal:
        """Price of the highest tier reached, else the product's own price."""
        price = product.unit_price
        for min_qty, tier_price in self._tiers.get(product.sku, []):
            if quantity >= min_qty:
                price = tier_price
        return price

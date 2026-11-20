"""Shopping cart: lines keyed by SKU, in insertion order."""

from decimal import Decimal

from pricing.cart.line import CartLine
from pricing.catalog.pricelist import PriceList
from pricing.catalog.product import Product
from pricing.errors import InvalidQuantityError, UnknownProductError


class Cart:
    def __init__(self, pricelist: PriceList | None = None) -> None:
        self._pricelist = pricelist
        self._lines: dict[str, CartLine] = {}

    def add(self, product: Product, quantity: int = 1) -> CartLine:
        """Add a product; adding the same SKU again merges the quantities."""
        if isinstance(quantity, bool) or not isinstance(quantity, int) or quantity < 1:
            raise InvalidQuantityError(f"bad quantity: {quantity!r}")
        previous = self._lines.get(product.sku)
        if previous is not None:
            quantity += previous.quantity
        line = CartLine(product, quantity, self._unit_price(product, quantity))
        self._lines[product.sku] = line
        return line

    def remove(self, sku: str) -> None:
        if sku not in self._lines:
            raise UnknownProductError(sku)
        del self._lines[sku]

    def _unit_price(self, product: Product, quantity: int) -> Decimal:
        if self._pricelist is None:
            return product.unit_price
        return self._pricelist.unit_price(product, quantity)

    @property
    def lines(self) -> tuple[CartLine, ...]:
        return tuple(self._lines.values())

    @property
    def is_empty(self) -> bool:
        return not self._lines

    def subtotal(self) -> Decimal:
        return sum((line.total for line in self._lines.values()), Decimal("0.00"))

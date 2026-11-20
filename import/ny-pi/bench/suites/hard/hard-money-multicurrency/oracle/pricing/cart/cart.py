"""Shopping cart: lines keyed by SKU, in insertion order, in one currency."""

from datetime import date
from decimal import Decimal

from pricing.cart.line import CartLine
from pricing.catalog.pricelist import PriceList
from pricing.catalog.product import Product
from pricing.errors import (
    CurrencyMismatchError,
    InvalidQuantityError,
    UnknownProductError,
)
from pricing.money import Money, RateTable, convert, get_currency
from pricing.rounding import round_amount


class Cart:
    def __init__(
        self,
        pricelist: PriceList | None = None,
        *,
        currency: str = "USD",
        rates: RateTable | None = None,
        on: date | None = None,
    ) -> None:
        get_currency(currency)
        if (rates is None) != (on is None):
            raise ValueError("rates and on must be given together")
        self._pricelist = pricelist
        self.currency = currency
        self._rates = rates
        self._on = on
        self._lines: dict[str, CartLine] = {}

    def add(self, product: Product, quantity: int = 1) -> CartLine:
        """Add a product; adding the same SKU again merges the quantities."""
        if isinstance(quantity, bool) or not isinstance(quantity, int) or quantity < 1:
            raise InvalidQuantityError(f"bad quantity: {quantity!r}")
        if product.currency != self.currency and self._rates is None:
            raise CurrencyMismatchError(
                f"{product.currency} product in {self.currency} cart"
            )
        previous = self._lines.get(product.sku)
        if previous is not None:
            quantity += previous.quantity
        line = CartLine(
            product, quantity, self._unit_price(product, quantity), self.currency
        )
        self._lines[product.sku] = line
        return line

    def remove(self, sku: str) -> None:
        if sku not in self._lines:
            raise UnknownProductError(sku)
        del self._lines[sku]

    def _unit_price(self, product: Product, quantity: int) -> Decimal:
        price = product.unit_price
        if self._pricelist is not None:
            price = self._pricelist.unit_price(product, quantity)
        if product.currency == self.currency:
            return price
        money = Money(price, product.currency)
        return convert(money, self.currency, self._rates, self._on).amount

    @property
    def lines(self) -> tuple[CartLine, ...]:
        return tuple(self._lines.values())

    @property
    def is_empty(self) -> bool:
        return not self._lines

    def subtotal(self) -> Decimal:
        zero = round_amount(Decimal(0), self.currency)
        return sum((line.total for line in self._lines.values()), zero)

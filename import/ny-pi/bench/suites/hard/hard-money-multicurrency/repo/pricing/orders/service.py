"""Checkout facade: quotes and order placement."""

from collections.abc import Iterable, Mapping

from pricing.cart.cart import Cart
from pricing.cart.totals import Totals, compute_totals
from pricing.catalog.pricelist import PriceList
from pricing.catalog.repository import Catalog
from pricing.discounts.base import Discount
from pricing.errors import PricingError
from pricing.orders.ledger import Ledger
from pricing.orders.order import Order


class CheckoutService:
    def __init__(
        self,
        catalog: Catalog,
        ledger: Ledger | None = None,
        pricelist: PriceList | None = None,
    ) -> None:
        self.catalog = catalog
        self.ledger = ledger if ledger is not None else Ledger()
        self._pricelist = pricelist
        self._next_id = 1

    def quote(
        self,
        items: Mapping[str, int],
        region: str,
        discounts: Iterable[Discount] = (),
        customer_type: str | None = None,
    ) -> Totals:
        """Totals for {sku: quantity} without placing an order."""
        cart = Cart(self._pricelist)
        for sku, quantity in items.items():
            cart.add(self.catalog.get(sku), quantity)
        return compute_totals(cart, region, discounts, customer_type)

    def checkout(
        self,
        cart: Cart,
        region: str,
        discounts: Iterable[Discount] = (),
        customer_type: str | None = None,
    ) -> Order:
        """Place an order for the cart and record it in the ledger."""
        if cart.is_empty:
            raise PricingError("cannot check out an empty cart")
        totals = compute_totals(cart, region, discounts, customer_type)
        order = Order(f"ORD-{self._next_id:04d}", cart.lines, totals, region)
        self._next_id += 1
        self.ledger.record(order)
        return order

"""Totals of a cart: subtotal, discount, tax and shipping."""

from collections.abc import Iterable
from dataclasses import dataclass
from decimal import Decimal

from pricing.cart.cart import Cart
from pricing.discounts.base import Discount
from pricing.discounts.engine import total_discount
from pricing.money import Money
from pricing.shipping.rules import shipping_cost
from pricing.tax.calculator import compute_tax


@dataclass(frozen=True)
class Totals:
    subtotal: Decimal
    discount: Decimal
    tax: Decimal
    shipping: Decimal
    currency: str = "USD"

    @property
    def grand_total(self) -> Decimal:
        return self.subtotal - self.discount + self.tax + self.shipping

    @property
    def grand_total_money(self) -> Money:
        return Money(self.grand_total, self.currency)


def compute_totals(
    cart: Cart,
    region: str,
    discounts: Iterable[Discount] = (),
    customer_type: str | None = None,
) -> Totals:
    """Discounts first, then tax and shipping on the discounted amount."""
    currency = cart.currency
    subtotal = cart.subtotal()
    discount = total_discount(subtotal, discounts, currency)
    net = subtotal - discount
    tax = compute_tax(net, region, customer_type, currency)
    shipping = shipping_cost(net, currency)
    return Totals(subtotal, discount, tax, shipping, currency)

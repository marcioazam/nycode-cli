"""Totais de um pedido (SPEC 8 e 9)."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass

from stockroom.catalog.products import Catalog
from stockroom.orders.order import OrderLine
from stockroom.orders.pricing import line_total
from stockroom.orders.shipping import shipping_cost


@dataclass(frozen=True)
class Totals:
    gross: int
    discount: int
    subtotal: int
    weight_g: int
    shipping: int
    total: int


def order_totals(lines: Iterable[OrderLine], catalog: Catalog) -> Totals:
    gross = discount = weight = 0
    for line in lines:
        product = catalog.get(line.sku)
        price = line_total(line.qty, product.price)
        gross += price.gross
        discount += price.discount
        weight += line.qty * product.weight_g
    subtotal = gross - discount
    shipping = shipping_cost(subtotal, weight)
    return Totals(gross, discount, subtotal, weight, shipping, subtotal + shipping)

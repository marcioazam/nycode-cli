"""Preço de linha e desconto por quantidade (SPEC 8)."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass

from stockroom.config import settings
from stockroom.inventory.ledger import check_qty
from stockroom.util.money import check_cents, percent_of


@dataclass(frozen=True)
class LinePrice:
    gross: int
    discount: int
    net: int


def discount_percent(qty: int) -> int:
    """Percentual de desconto para compras acima de cada faixa de quantidade."""
    check_qty(qty)
    percent = 0
    for min_qty, tier_percent in settings().discount_tiers:
        if qty >= min_qty:
            percent = tier_percent
    return percent


def line_total(qty: int, unit_price: int) -> LinePrice:
    check_cents(unit_price, "preço")
    gross = check_qty(qty) * unit_price
    discount = percent_of(gross, discount_percent(qty))
    return LinePrice(gross, discount, gross - discount)


def order_subtotal(lines: Iterable[tuple[int, int]]) -> int:
    """Subtotal de pares (quantidade, preço unitário)."""
    return sum(line_total(qty, price).net for qty, price in lines)

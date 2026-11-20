"""Valor do estoque a custo (SPEC 13)."""

from __future__ import annotations

from dataclasses import dataclass

from stockroom.catalog.products import Catalog
from stockroom.inventory.warehouse import Warehouse


@dataclass(frozen=True)
class ValuationRow:
    sku: str
    on_hand: int
    cost: int
    value: int


def valuation(catalog: Catalog, warehouse: Warehouse) -> tuple[list[ValuationRow], int]:
    """(linhas em ordem de SKU com saldo > 0, valor total em centavos)."""
    rows = []
    for product in catalog.all():
        on_hand = warehouse.on_hand(product.sku)
        if on_hand > 0:
            rows.append(
                ValuationRow(product.sku, on_hand, product.cost, on_hand * product.cost)
            )
    return rows, sum(row.value for row in rows)

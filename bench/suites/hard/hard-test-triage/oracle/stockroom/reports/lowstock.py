"""Relatório de reposição (SPEC 13)."""

from __future__ import annotations

from dataclasses import dataclass

from stockroom.catalog.products import Catalog
from stockroom.inventory.reorder import needs_reorder, suggested_quantity
from stockroom.inventory.warehouse import Warehouse


@dataclass(frozen=True)
class LowStockRow:
    sku: str
    name: str
    available: int
    reorder_point: int
    suggested: int


def low_stock(catalog: Catalog, warehouse: Warehouse) -> list[LowStockRow]:
    rows = []
    for product in catalog.all():
        available = warehouse.available(product.sku)
        if needs_reorder(product, available):
            suggested = suggested_quantity(product, available)
            rows.append(
                LowStockRow(
                    product.sku,
                    product.name,
                    available,
                    product.reorder_point,
                    suggested,
                )
            )
    return sorted(rows, key=lambda row: (row.available, row.sku))

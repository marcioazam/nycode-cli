"""Ponto de reposição (SPEC 7)."""

from __future__ import annotations

from stockroom.catalog.products import Product
from stockroom.catalog.units import packs_needed, to_units


def needs_reorder(product: Product, available: int) -> bool:
    if product.reorder_point == 0:
        return False
    return available <= product.reorder_point


def suggested_quantity(product: Product, available: int) -> int:
    """Unidades a comprar para chegar a pelo menos o dobro do ponto de reposição."""
    if not needs_reorder(product, available):
        return 0
    deficit = 2 * product.reorder_point - max(available, 0)
    return to_units(packs_needed(deficit, product.pack_size), product.pack_size)

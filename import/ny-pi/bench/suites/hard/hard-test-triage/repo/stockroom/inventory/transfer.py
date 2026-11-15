"""Transferência entre depósitos (SPEC 6)."""

from __future__ import annotations

from stockroom.errors import ValidationError
from stockroom.inventory.lots import Pick
from stockroom.inventory.warehouse import Warehouse


def transfer(source: Warehouse, target: Warehouse, sku: str, qty: int) -> list[Pick]:
    """Move `qty` do disponível da origem para o destino, mantendo as validades."""
    if source is target:
        raise ValidationError("origem e destino são o mesmo depósito")
    picks = source.ship(sku, qty)  # valida tudo antes de mexer em qualquer saldo
    for pick in picks:
        target.receive(sku, pick.qty, pick.expiry)
    return picks

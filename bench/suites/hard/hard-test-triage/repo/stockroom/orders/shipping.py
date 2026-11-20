"""Frete (SPEC 9)."""

from __future__ import annotations

from stockroom.config import settings
from stockroom.errors import ValidationError
from stockroom.util.money import check_cents


def shipping_cost(subtotal: int, weight_g: int) -> int:
    """Frete para um subtotal (já com desconto) e um peso total em gramas."""
    check_cents(subtotal, "subtotal")
    if isinstance(weight_g, bool) or not isinstance(weight_g, int) or weight_g < 0:
        raise ValidationError("peso deve ser inteiro >= 0")
    cfg = settings()
    if subtotal >= cfg.free_shipping_threshold:
        return 0
    started_kg = -(-weight_g // 1000)
    return cfg.shipping_base + cfg.shipping_per_kg * started_kg

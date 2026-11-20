"""Normalização de SKU (SPEC 1)."""

from __future__ import annotations

import re

from stockroom.errors import ValidationError

_SKU = re.compile(r"[A-Z]{2,4}-[0-9]{3,6}")


def normalize_sku(raw: object) -> str:
    if not isinstance(raw, str):
        raise ValidationError("SKU deve ser texto")
    sku = raw.strip().upper()
    if not _SKU.fullmatch(sku):
        raise ValidationError(f"SKU inválido: {raw!r}")
    return sku

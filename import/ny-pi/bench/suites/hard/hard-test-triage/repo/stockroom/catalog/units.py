"""Conversão entre embalagens e unidades (SPEC 2)."""

from __future__ import annotations

from stockroom.errors import ValidationError


def _check(value: int, minimum: int, what: str) -> None:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise ValidationError(f"{what} deve ser inteiro >= {minimum}")


def to_units(packs: int, pack_size: int) -> int:
    _check(packs, 0, "embalagens")
    _check(pack_size, 1, "pack_size")
    return packs * pack_size


def to_packs(units: int, pack_size: int) -> tuple[int, int]:
    """(embalagens completas, unidades avulsas)."""
    _check(units, 0, "unidades")
    _check(pack_size, 1, "pack_size")
    return divmod(units, pack_size)


def packs_needed(units: int, pack_size: int) -> int:
    """Menor número de embalagens que cobre `units`."""
    full, loose = to_packs(units, pack_size)
    return full + (1 if loose else 0)

"""Identificadores sequenciais do processo (SPEC 11)."""

from __future__ import annotations

from stockroom.errors import ValidationError

_counters: dict[str, int] = {}


def next_id(prefix: str) -> str:
    """Próximo id do prefixo: ORD-000001, ORD-000002, ..."""
    if not prefix.isalpha() or not prefix.isupper():
        raise ValidationError("prefixo deve ter só letras maiúsculas")
    _counters[prefix] = _counters.get(prefix, 0) + 1
    return f"{prefix}-{_counters[prefix]:06d}"


def reset_ids() -> None:
    _counters.clear()

"""Configuração do processo (SPEC 12): um único conjunto de valores, global."""

from __future__ import annotations

from dataclasses import dataclass, fields, replace

from stockroom.errors import ValidationError


@dataclass(frozen=True)
class Settings:
    # (quantidade mínima, percentual), em ordem crescente de quantidade
    discount_tiers: tuple[tuple[int, int], ...] = ((10, 5), (50, 10))
    free_shipping_threshold: int = 20000
    shipping_base: int = 1500
    shipping_per_kg: int = 200


_DEFAULT = Settings()
_current = _DEFAULT
_KNOWN = {f.name for f in fields(Settings)}


def settings() -> Settings:
    return _current


def configure(**changes: object) -> Settings:
    """Troca valores da configuração global; chave desconhecida é erro."""
    global _current
    unknown = sorted(set(changes) - _KNOWN)
    if unknown:
        raise ValidationError(f"configuração desconhecida: {', '.join(unknown)}")
    tiers = changes.get("discount_tiers")
    if tiers is not None:
        changes["discount_tiers"] = _check_tiers(tiers)
    for key in _KNOWN - {"discount_tiers"}:
        value = changes.get(key)
        if key in changes and (not isinstance(value, int) or value < 0):
            raise ValidationError(f"{key} deve ser inteiro >= 0")
    _current = replace(_current, **changes)
    return _current


def reset_config() -> None:
    global _current
    _current = _DEFAULT


def _check_tiers(tiers: object) -> tuple[tuple[int, int], ...]:
    try:
        out = tuple((int(q), int(p)) for q, p in tiers)  # type: ignore[union-attr]
    except (TypeError, ValueError) as exc:
        raise ValidationError("discount_tiers inválido") from exc
    if any(q < 1 or not 0 <= p <= 100 for q, p in out):
        raise ValidationError("discount_tiers fora da faixa")
    if list(out) != sorted(set(out)) or len({q for q, _ in out}) != len(out):
        raise ValidationError("discount_tiers deve estar em ordem crescente")
    return out

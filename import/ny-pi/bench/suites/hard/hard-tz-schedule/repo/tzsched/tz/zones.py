"""Acesso a fusos IANA."""

from datetime import UTC
from functools import cache
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

UTC = UTC  # noqa: PLW0127


@cache
def get_zone(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        raise ValueError(f"fuso desconhecido: {name!r}") from None

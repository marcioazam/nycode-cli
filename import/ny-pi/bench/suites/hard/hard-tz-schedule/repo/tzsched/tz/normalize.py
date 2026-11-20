"""Normalização: horário de parede local → instante UTC."""

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from tzsched.model.series import Series
from tzsched.tz.zones import UTC, get_zone


def resolve_local(naive: datetime, zone: ZoneInfo) -> datetime:
    """Converte um horário de parede em `zone` para UTC (ver docs/SPEC.md, regras 3 e 4)."""
    first = naive.replace(tzinfo=zone, fold=0)
    second = naive.replace(tzinfo=zone, fold=1)
    before, after = first.utcoffset(), second.utcoffset()
    if before == after:
        chosen = first
    elif before > after:
        chosen = second
    else:
        chosen = first
    return chosen.astimezone(UTC)


def occurrence_start(series: Series, n: int) -> datetime:
    """Início UTC da n-ésima ocorrência (n começa em 0)."""
    zone = get_zone(series.zone)
    first = resolve_local(series.start_local, zone)
    return first + timedelta(days=series.every_days * n)

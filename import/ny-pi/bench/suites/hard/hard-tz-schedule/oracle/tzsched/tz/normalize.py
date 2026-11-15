"""Normalização: horário de parede local → instante UTC."""

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from tzsched.model.series import Series
from tzsched.tz.zones import UTC, get_zone


def resolve_local(naive: datetime, zone: ZoneInfo) -> datetime:
    """Converte um horário de parede em `zone` para UTC (ver docs/SPEC.md, regras 3 e 4).

    fold=0 dá a primeira ocorrência de um horário ambíguo e, num salto, adia pelo tamanho dele.
    """
    return naive.replace(tzinfo=zone, fold=0).astimezone(UTC)


def occurrence_start(series: Series, n: int) -> datetime:
    """Início UTC da n-ésima ocorrência (n começa em 0), normalizada a partir da data local."""
    zone = get_zone(series.zone)
    local = series.start_local + timedelta(days=series.every_days * n)
    return resolve_local(local, zone)

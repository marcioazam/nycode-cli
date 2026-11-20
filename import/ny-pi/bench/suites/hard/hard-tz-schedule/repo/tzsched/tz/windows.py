"""Janelas de tempo em UTC derivadas de datas locais."""

from datetime import date, datetime, time, timedelta

from tzsched.tz.normalize import resolve_local
from tzsched.tz.zones import get_zone


def local_day_start(day: date, zone_name: str) -> datetime:
    return resolve_local(datetime.combine(day, time(0, 0)), get_zone(zone_name))


def week_bounds(monday: date, zone_name: str) -> tuple[datetime, datetime]:
    """[segunda 00:00 local, próxima segunda 00:00 local) em UTC."""
    if monday.weekday() != 0:
        raise ValueError("a semana começa numa segunda-feira")
    return local_day_start(monday, zone_name), local_day_start(
        monday + timedelta(days=7), zone_name
    )

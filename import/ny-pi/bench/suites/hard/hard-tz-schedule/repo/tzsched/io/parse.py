"""Converte registros (dict) em séries."""

from datetime import date, datetime

from tzsched.model.series import Series
from tzsched.tz.zones import get_zone


def series_from_dict(d: dict) -> Series:
    get_zone(d["zone"])
    start = datetime.fromisoformat(d["start"])
    until = date.fromisoformat(d["until"]) if d.get("until") else None
    return Series(
        id=d["id"],
        title=d["title"],
        zone=d["zone"],
        start_local=start,
        every_days=d.get("every_days", 7),
        count=d.get("count"),
        until=until,
        duration_min=d.get("duration_min", 60),
        attendees=tuple(d.get("attendees", ())),
    )

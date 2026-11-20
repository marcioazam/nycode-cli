"""Relatório semanal no fuso de quem visualiza."""

from dataclasses import dataclass
from datetime import date, datetime, timedelta

from tzsched.model.calendar import Calendar
from tzsched.recur.expand import occurrences
from tzsched.report.conflicts import conflicting_ids
from tzsched.report.totals import day_total, minutes
from tzsched.tz.windows import week_bounds
from tzsched.tz.zones import get_zone


@dataclass(frozen=True)
class Entry:
    series_id: str
    title: str
    local_start: datetime
    start_utc: datetime
    minutes: int
    conflict: bool


@dataclass(frozen=True)
class DayReport:
    day: date
    entries: list[Entry]
    total_min: int


def weekly_report(calendar: Calendar, zone_name: str, monday: date) -> list[DayReport]:
    zone = get_zone(zone_name)
    start, end = week_bounds(monday, zone_name)
    found = [o for s in calendar.series() for o in occurrences(s, start, end)]
    flagged = conflicting_ids(found)
    days = {monday + timedelta(days=i): [] for i in range(7)}
    for o in found:
        local = o.start_utc.astimezone(zone)
        days[local.date()].append((local, o))
    report = []
    for day, items in days.items():
        items.sort(key=lambda p: (p[1].start_utc, p[1].series_id))
        entries = [
            Entry(
                o.series_id,
                o.title,
                local,
                o.start_utc,
                minutes(o),
                (o.series_id, o.start_utc) in flagged,
            )
            for local, o in items
        ]
        report.append(DayReport(day, entries, day_total([o for _, o in items])))
    return report

from datetime import datetime, timedelta

from tzsched.io.parse import series_from_dict
from tzsched.recur.expand import occurrences
from tzsched.tz.windows import week_bounds
from tzsched.tz.zones import UTC


def S(**kw):
    base = {
        "id": "s1",
        "title": "Sync",
        "zone": "Europe/Berlin",
        "start": "2024-01-08T09:00",
    }
    base.update(kw)
    return series_from_dict(base)


W0, W1 = datetime(2024, 1, 1, tzinfo=UTC), datetime(2024, 3, 1, tzinfo=UTC)


def test_weekly_winter_instants():
    occ = occurrences(S(), W0, W1)
    assert occ[0].start_utc == datetime(2024, 1, 8, 8, tzinfo=UTC)
    assert occ[1].start_utc - occ[0].start_utc == timedelta(days=7)


def test_count_and_until():
    assert len(occurrences(S(count=3), W0, W1)) == 3
    assert len(occurrences(S(until="2024-01-22"), W0, W1)) == 3


def test_window_half_open():
    occ = occurrences(
        S(), datetime(2024, 1, 8, 8, tzinfo=UTC), datetime(2024, 1, 15, 8, tzinfo=UTC)
    )
    assert [o.start_utc.day for o in occ] == [8]


def test_every_days_and_duration():
    occ = occurrences(
        S(every_days=2, duration_min=90), W0, datetime(2024, 1, 14, tzinfo=UTC)
    )
    assert [o.start_utc.day for o in occ] == [8, 10, 12]
    assert occ[0].end_utc - occ[0].start_utc == timedelta(minutes=90)


def test_week_bounds_winter_and_monday_check():
    s, e = week_bounds(datetime(2024, 1, 8).date(), "Europe/Berlin")
    assert e - s == timedelta(days=7)

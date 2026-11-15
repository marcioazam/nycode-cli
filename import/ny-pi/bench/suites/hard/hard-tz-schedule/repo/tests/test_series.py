from datetime import date, datetime

import pytest
from tzsched.io.parse import series_from_dict
from tzsched.model.calendar import Calendar
from tzsched.model.series import Series


def rec(**kw):
    base = {
        "id": "s1",
        "title": "Sync",
        "zone": "Europe/Berlin",
        "start": "2024-01-08T09:00",
    }
    base.update(kw)
    return base


def test_parse_defaults():
    s = series_from_dict(rec())
    assert (
        s.every_days == 7
        and s.duration_min == 60
        and s.start_local == datetime(2024, 1, 8, 9)
    )


def test_parse_until():
    assert series_from_dict(rec(until="2024-02-01")).until == date(2024, 2, 1)


def test_unknown_zone():
    with pytest.raises(ValueError):
        series_from_dict(rec(zone="Mars/Olympus"))


def test_aware_start_rejected():
    with pytest.raises(ValueError):
        series_from_dict(rec(start="2024-01-08T09:00+01:00"))


def test_duplicate_series():
    cal = Calendar()
    cal.add(series_from_dict(rec()))
    with pytest.raises(ValueError):
        cal.add(series_from_dict(rec()))


def test_invalid_numbers():
    with pytest.raises(ValueError):
        Series("a", "t", "UTC", datetime(2024, 1, 1), every_days=0)

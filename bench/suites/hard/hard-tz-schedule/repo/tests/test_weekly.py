from datetime import date

import pytest
from tzsched.app import week_text
from tzsched.io.store import load_calendar
from tzsched.report.weekly import weekly_report

BERLIN = {"zone": "Europe/Berlin", "start": "2024-01-08T09:00"}


def rec(i, **kw):
    return {"id": i, "title": i.upper(), **BERLIN, **kw}


def test_report_days_and_entries():
    cal = load_calendar([rec("a"), rec("b", start="2024-01-09T10:00", duration_min=30)])
    days = weekly_report(cal, "Europe/Berlin", date(2024, 1, 8))
    assert [len(d.entries) for d in days] == [1, 1, 0, 0, 0, 0, 0]
    assert days[1].total_min == 30


def test_other_viewer_zone_changes_day():
    cal = load_calendar([rec("late", start="2024-01-08T23:30")])
    days = weekly_report(cal, "Asia/Tokyo", date(2024, 1, 8))
    assert days[1].entries[0].local_start.day == 9


def test_conflicts_and_touching():
    cal = load_calendar(
        [
            rec("a"),
            rec("b", start="2024-01-08T09:30"),
            rec("c", start="2024-01-08T10:30"),
        ]
    )
    flags = [
        e.conflict
        for e in weekly_report(cal, "Europe/Berlin", date(2024, 1, 8))[0].entries
    ]
    assert flags == [True, True, False]


def test_week_must_start_monday():
    with pytest.raises(ValueError):
        weekly_report(load_calendar([rec("a")]), "UTC", date(2024, 1, 9))


def test_text():
    text = week_text([rec("a")], "Europe/Berlin", date(2024, 1, 8))
    assert text.splitlines()[0] == "Mon 2024-01-08 total=60m"
    assert text.splitlines()[1] == "  09:00 A 60m"

from datetime import date, datetime, timedelta

from tzsched.app import week_text
from tzsched.io.parse import series_from_dict
from tzsched.io.store import load_calendar
from tzsched.recur.expand import occurrences
from tzsched.report.weekly import weekly_report
from tzsched.tz.normalize import resolve_local
from tzsched.tz.windows import week_bounds
from tzsched.tz.zones import UTC, get_zone

NY, BER, SYD, TOK = (
    "America/New_York",
    "Europe/Berlin",
    "Australia/Sydney",
    "Asia/Tokyo",
)
W0, W1 = datetime(2024, 1, 1, tzinfo=UTC), datetime(2025, 1, 1, tzinfo=UTC)


def rec(i="s", zone=NY, start="2024-03-04T09:00", **kw):
    return {"id": i, "title": i.upper(), "zone": zone, "start": start, **kw}


def utc(*a):
    return datetime(*a, tzinfo=UTC)


def starts(r):
    return [o.start_utc for o in occurrences(series_from_dict(r), W0, W1)]


def test_us_dst_keeps_wall_time():
    assert starts(rec(count=3)) == [
        utc(2024, 3, 4, 14),
        utc(2024, 3, 11, 13),
        utc(2024, 3, 18, 13),
    ]


def test_eu_dst_keeps_wall_time():
    assert starts(rec(zone=BER, start="2024-03-25T09:00", count=2)) == [
        utc(2024, 3, 25, 8),
        utc(2024, 4, 1, 7),
    ]


def test_southern_hemisphere_dst_end():
    r = rec(zone=SYD, start="2024-03-30T10:00", count=3)
    assert starts(r) == [utc(2024, 3, 29, 23), utc(2024, 4, 5, 23), utc(2024, 4, 13, 0)]


def test_every_days_across_dst():
    r = rec(start="2024-03-08T09:00", every_days=2, count=3)
    assert starts(r) == [
        utc(2024, 3, 8, 14),
        utc(2024, 3, 10, 13),
        utc(2024, 3, 12, 13),
    ]


def test_report_shows_same_local_time_after_dst():
    cal = load_calendar([rec(count=4)])
    day = weekly_report(cal, NY, date(2024, 3, 11))[0]
    assert [e.local_start.strftime("%H:%M") for e in day.entries] == ["09:00"]
    assert day.entries[0].start_utc == utc(2024, 3, 11, 13)


def test_late_sunday_event_stays_in_its_week():
    cal = load_calendar([rec("late", start="2024-03-03T23:30")])
    week = weekly_report(cal, NY, date(2024, 3, 4))
    assert [e.local_start.strftime("%a %H:%M") for e in week[6].entries] == [
        "Sun 23:30"
    ]
    nxt = weekly_report(cal, NY, date(2024, 3, 11))
    assert (
        all(not d.entries for d in nxt[:1]) and nxt[6].entries[0].local_start.day == 17
    )


def test_other_viewer_zone_after_dst():
    cal = load_calendar([rec(count=4)])
    entry = weekly_report(cal, TOK, date(2024, 3, 18))[0].entries[0]
    assert entry.local_start.strftime("%H:%M") == "22:00"


def test_berlin_autumn_report():
    cal = load_calendar([rec(zone=BER, start="2024-10-14T09:00")])
    entry = weekly_report(cal, BER, date(2024, 10, 28))[0].entries[0]
    assert entry.local_start.strftime("%H:%M") == "09:00" and entry.start_utc == utc(
        2024, 10, 28, 8
    )


def test_gap_is_pushed_forward():
    assert resolve_local(datetime(2024, 3, 10, 2, 30), get_zone(NY)) == utc(
        2024, 3, 10, 7, 30
    )
    assert resolve_local(datetime(2024, 3, 31, 2, 30), get_zone(BER)) == utc(
        2024, 3, 31, 1, 30
    )
    assert resolve_local(datetime(2024, 10, 6, 2, 30), get_zone(SYD)) == utc(
        2024, 10, 5, 16, 30
    )


def test_daily_series_through_the_gap():
    r = rec(start="2024-03-09T02:30", every_days=1, count=3)
    assert starts(r) == [
        utc(2024, 3, 9, 7, 30),
        utc(2024, 3, 10, 7, 30),
        utc(2024, 3, 11, 6, 30),
    ]


def test_ambiguous_uses_first_occurrence():
    assert resolve_local(datetime(2024, 11, 3, 1, 30), get_zone(NY)) == utc(
        2024, 11, 3, 5, 30
    )
    assert resolve_local(datetime(2024, 10, 27, 2, 30), get_zone(BER)) == utc(
        2024, 10, 27, 0, 30
    )


def test_daily_series_through_the_fold():
    r = rec(start="2024-11-02T01:30", every_days=1, count=3)
    assert starts(r) == [
        utc(2024, 11, 2, 5, 30),
        utc(2024, 11, 3, 5, 30),
        utc(2024, 11, 4, 6, 30),
    ]


def test_ambiguous_event_seen_from_tokyo():
    cal = load_calendar([rec(start="2024-11-03T01:30")])
    entry = weekly_report(cal, TOK, date(2024, 10, 28))[6].entries[0]
    assert entry.local_start.strftime("%H:%M") == "14:30"


def test_duration_is_elapsed_time():
    fold = occurrences(
        series_from_dict(rec(start="2024-11-03T00:30", duration_min=180)), W0, W1
    )[0]
    assert (fold.start_utc, fold.end_utc) == (
        utc(2024, 11, 3, 4, 30),
        utc(2024, 11, 3, 7, 30),
    )
    gap = occurrences(
        series_from_dict(rec(start="2024-03-10T01:00", duration_min=120)), W0, W1
    )[0]
    assert (
        gap.end_utc == utc(2024, 3, 10, 8)
        and gap.end_utc.astimezone(get_zone(NY)).hour == 4
    )
    day = weekly_report(
        load_calendar([rec(start="2024-03-10T01:00", duration_min=120)]),
        NY,
        date(2024, 3, 4),
    )[6]
    assert day.total_min == 120


def test_week_lengths_167_and_169_hours():
    s, e = week_bounds(date(2024, 3, 4), NY)
    assert e - s == timedelta(hours=167)
    s, e = week_bounds(date(2024, 10, 28), NY)
    assert e - s == timedelta(hours=169)


def test_limits_across_dst():
    assert len(starts(rec(until="2024-03-18"))) == 3
    assert len(starts(rec(until="2024-03-18", count=2))) == 2


def test_touching_events_do_not_conflict_after_dst():
    cal = load_calendar([rec("a"), rec("b", zone=BER, start="2024-03-04T15:00")])
    first = weekly_report(cal, NY, date(2024, 3, 4))[0]
    assert [e.conflict for e in first.entries] == [True, True]
    second = weekly_report(cal, NY, date(2024, 3, 11))[0]
    assert [e.conflict for e in second.entries] == [False, False]


def test_same_instant_sorted_by_series_id():
    cal = load_calendar(
        [rec("z", start="2024-03-11T09:00"), rec("a", start="2024-03-11T09:00")]
    )
    ids = [e.series_id for e in weekly_report(cal, NY, date(2024, 3, 11))[0].entries]
    assert ids == ["a", "z"]


def test_text_after_dst():
    text = week_text([rec("a", count=3, duration_min=30)], NY, date(2024, 3, 11))
    cab, entrada = text.splitlines()[:2]
    assert cab.split()[1:] == [
        "2024-03-11",
        "total=30m",
    ]  # o nome do dia não é fixado pela regra 14
    assert entrada.split() == ["09:00", "A", "30m"]

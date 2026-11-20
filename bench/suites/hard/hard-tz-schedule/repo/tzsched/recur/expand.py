"""Materializa ocorrências de uma série numa janela UTC [início, fim)."""

from datetime import datetime, timedelta

from tzsched.model.occurrence import Occurrence
from tzsched.model.series import Series
from tzsched.recur.limits import within_limits
from tzsched.tz.normalize import occurrence_start


def occurrences(
    series: Series, window_start: datetime, window_end: datetime
) -> list[Occurrence]:
    found = []
    n = 0
    while within_limits(series, n):
        start = occurrence_start(series, n)
        if start >= window_end:
            break
        if start >= window_start:
            end = start + timedelta(minutes=series.duration_min)
            found.append(Occurrence(series.id, series.title, start, end))
        n += 1
    return found

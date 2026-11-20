"""Datas."""

from datetime import date, timedelta


def monday_of(day: date) -> date:
    return day - timedelta(days=day.weekday())

from helpers import clamp, days_between


def days_left(today, due):
    return clamp(days_between(today, due), 0, 365)

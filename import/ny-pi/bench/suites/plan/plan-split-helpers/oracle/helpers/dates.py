from datetime import date


def parse_iso(s):
    return date.fromisoformat(s)


def days_between(a, b):
    return (parse_iso(b) - parse_iso(a)).days

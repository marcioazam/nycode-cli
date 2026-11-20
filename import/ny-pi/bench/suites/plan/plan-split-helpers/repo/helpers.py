import re
from datetime import date


def slugify(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def titlecase(s):
    return " ".join(w.capitalize() for w in s.split())


def clamp(x, lo, hi):
    if lo > hi:
        raise ValueError("lo > hi")
    return max(lo, min(hi, x))


def mean(xs):
    xs = list(xs)
    if not xs:
        raise ValueError("empty")
    return sum(xs) / len(xs)


def parse_iso(s):
    return date.fromisoformat(s)


def days_between(a, b):
    return (parse_iso(b) - parse_iso(a)).days
